/**
 * 功能性遍历审计 —— 以「外部 Agent」身份经真实 relay 遍历调用全部 27 个工具
 *
 * 与 e2e.acceptance.test.ts 的区别：
 *  - 不写「主干剧情」，而是**逐个工具**跑一遍，追求覆盖面而非深度；
 *  - relay 以**非 --dev** 启动 —— 必须走真实的「预览 → confirm_preview 取票 → 执行」，
 *    不允许靠 dev 自动附票抄近路（这正是真实 Agent 的处境）；
 *  - 每个用例独立记录 结果/耗时/失败原因，最后汇总成表，**不因单个失败中断**；
 *  - 额外比对运行期 tools/list 的 inputSchema 与静态快照 mcp-tools.json 的差异。
 *
 * 定位：审计/排查用探针，不是回归门禁用例（失败即代表被测面存在缺陷，属预期产出）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { settingsRepo } from '@/repositories'
import { DEFAULT_SETTINGS } from '@/db/types'
import { agentBridge } from '../bridge'
import {
  installWebSocketGlobal,
  startRelay,
  connectBridge,
  McpClient,
  type RelayProcess,
  type ReadEnvelope,
} from './e2e.harness'

type Row = { tool: string; phase: string; ok: boolean; ms: number; detail: string }

type EdgeRow = { label: string; ok: boolean; ms: number; detail: string }

const results: Row[] = []
const edge: EdgeRow[] = []
const schemaDiffs: string[] = []
const ctx: Record<string, string> = {}

let relay: RelayProcess
let mcp: McpClient
let staticSnap: Map<string, Record<string, unknown>>

function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

/** 取前置数据的 id；缺失即抛错（会在用例里被记为失败，而不是静默跳过） */
function g(key: string): string {
  const v = ctx[key]
  if (!v) throw new Error(`前置数据缺失：${key}（上游步骤失败导致）`)
  return v
}

/** 从任意层级挖出 confirmToken（不假设 relay 返回结构） */
function findToken(x: unknown): string | undefined {
  if (!x || typeof x !== 'object') return undefined
  const o = x as Record<string, unknown>
  if (typeof o.confirmToken === 'string') return o.confirmToken
  for (const v of Object.values(o)) {
    const t = findToken(v)
    if (t) return t
  }
  return undefined
}

type InvokeResult = { ok: boolean; phase: string; text: string; data: unknown }

/** 标准 Agent 行为：低风险直达；中/高风险先预览 → confirm_preview 取票 → 带票重试 */
async function invoke(tool: string, args: Record<string, unknown>): Promise<InvokeResult> {
  const first = await mcp.callTool(tool, args)
  const d = first.data as { preview?: boolean; confirmHint?: { args: Record<string, unknown> } } | undefined
  if (!first.ok) return { ok: false, phase: 'call', text: first.text, data: first.data }
  if (!d?.preview) return { ok: true, phase: 'direct', text: first.text, data: first.data }
  if (!d.confirmHint?.args) return { ok: false, phase: 'preview', text: '预览未给出 confirmHint.args', data: first.data }
  const ticket = await mcp.callTool('confirm_preview', d.confirmHint.args)
  const token = findToken(ticket.data)
  if (!token) return { ok: false, phase: 'ticket', text: `取票失败：${ticket.text}`, data: ticket.data }
  const second = await mcp.callTool(tool, args, token)
  return { ok: second.ok, phase: 'confirmed', text: second.text, data: second.data }
}

/** 跑一个用例：记录结果，不抛出（保证遍历跑完） */
async function kase(
  tool: string,
  args: Record<string, unknown> | (() => Record<string, unknown>),
  verify?: (r: InvokeResult) => void,
): Promise<void> {
  const t0 = Date.now()
  let phase = 'init'
  try {
    const a = typeof args === 'function' ? args() : args
    const r = await invoke(tool, a)
    phase = r.phase
    const problems: string[] = []
    if (!r.ok) problems.push(r.text.slice(0, 200).replace(/\s+/g, ' '))
    if (verify) {
      try {
        verify(r)
      } catch (e) {
        problems.push((e as Error).message)
      }
    }
    results.push({
      tool,
      phase,
      ok: problems.length === 0,
      ms: Date.now() - t0,
      detail: problems.join(' | ') || 'OK',
    })
  } catch (e) {
    results.push({ tool, phase, ok: false, ms: Date.now() - t0, detail: `异常：${(e as Error).message}` })
  }
}

/** 边界探针：断言「应该被拒」或「应该成功」，记录实际表现 */
async function probe(
  tool: string,
  label: string,
  args: Record<string, unknown>,
  expectKind: 'error' | 'ok',
): Promise<void> {
  const t0 = Date.now()
  const clean = (s: string) => s.replace(/\s+/g, ' ').slice(0, 130)
  try {
    const r = await invoke(tool, args)
    const pass = expectKind === 'error' ? r.ok === false : r.ok === true
    edge.push({
      label,
      ok: pass,
      ms: Date.now() - t0,
      detail: pass
        ? expectKind === 'error'
          ? `已拒绝：${clean(r.text)}`
          : '成功'
        : `期望${expectKind === 'error' ? '被拒' : '成功'}，实际${r.ok ? '成功' : '失败'}：${clean(r.text)}`,
    })
  } catch (e) {
    edge.push({ label, ok: false, ms: Date.now() - t0, detail: `异常：${(e as Error).message}` })
  }
}

beforeAll(async () => {
  installWebSocketGlobal()
  const snap = JSON.parse(readFileSync('docs/skills/mcp-tools.json', 'utf8')) as {
    tools: { name: string; inputSchema: Record<string, unknown> }[]
  }
  staticSnap = new Map(snap.tools.map((t) => [t.name, t.inputSchema]))

  // 非 --dev：真实 Agent 拿不到自动附票，必须自己走 confirm_preview
  relay = await startRelay({})
  await relay.ready
  const bridgeUrl = `ws://127.0.0.1:${relay.port}`
  await settingsRepo.save({
    ai: { ...DEFAULT_SETTINGS.ai, bridgeEnabled: true, bridgeToken: relay.token, bridgeUrl },
  })
  await connectBridge(relay, agentBridge)
  mcp = await McpClient.open(bridgeUrl)
  await mcp.initialize(relay.token)
}, 30_000)

afterAll(async () => {
  mcp?.close()
  agentBridge.disconnect()
  await relay?.stop()
})

describe('Agent 功能性遍历（27 个工具）', () => {
  it('① 运行期 tools/list 与静态快照 mcp-tools.json 的内容一致性', async () => {
    const all = await mcp.listTools()
    const tools = all.filter((t) => t.name !== 'confirm_preview')
    need(tools.length === 27, `期望下发 27 个业务工具，实际 ${tools.length}`)
    for (const t of tools) {
      const snapshot = staticSnap.get(t.name)
      if (!snapshot) {
        schemaDiffs.push(`${t.name}：静态快照中缺失`)
        continue
      }
      const live = JSON.stringify(t.inputSchema)
      const stat = JSON.stringify(snapshot)
      if (live !== stat) {
        schemaDiffs.push(`【${t.name}】运行期 ≠ 静态快照\n      运行期  ${live}\n      静态    ${stat}`)
      }
    }
    expect(tools.length).toBe(27)
  })

  it('② 逐个调用 27 个工具（低风险直达 / 中高风险走取票）', async () => {
    /* ---------------- 一、前置数据（本身也算用例） ---------------- */
    await kase('note_createFolder', { name: '远山资料' }, (r) => {
      const d = r.data as { folderId?: string }
      need(d?.folderId, '未返回 folderId')
      ctx.folderId = d.folderId
    })

    await kase('fin_createLedger', { name: '默认账本', isDefault: true }, (r) => {
      const d = r.data as { ledgerId?: string }
      need(d?.ledgerId, '未返回 ledgerId')
      ctx.ledgerId = d.ledgerId
    })

    await kase('crm_createCustomer', { name: '王五', company: '深蓝科技' }, (r) => {
      const d = r.data as { customerId?: string }
      need(d?.customerId, '未返回 customerId')
      ctx.customerId = d.customerId
    })

    await kase('crm_createCustomer', { name: '赵六', company: '远山设计' }, (r) => {
      const d = r.data as { customerId?: string }
      need(d?.customerId, '未返回 customerId')
      ctx.customer2Id = d.customerId
    })

    await kase('project_createProject', { name: '远山年度视觉' }, (r) => {
      const d = r.data as { projectId?: string }
      need(d?.projectId, '未返回 projectId')
      ctx.projectId = d.projectId
    })

    await kase('note_createNote', { title: '远山需求要点', markdown: '# 要点' }, (r) => {
      const d = r.data as { noteId?: string }
      need(d?.noteId, '未返回 noteId')
      ctx.noteId = d.noteId
    })

    await kase('todo_createTodo', () => ({ title: '周五回访王五', customerId: g('customerId'), priority: 'high' }), (r) => {
      const d = r.data as { todoId?: string }
      need(d?.todoId, '未返回 todoId')
      ctx.todoId = d.todoId
    })

    /* 习惯无「创建」工具，按 UI 同等口径直接落库 */
    await db.habits.put({
      id: 'habit-sweep',
      name: '晨跑',
      icon: 'directions_run',
      color: '#111111',
      category: '健康',
      schedule: '每日',
      targetMinutes: 0,
      motivationNote: '',
      crossModuleSync: false,
      createdAt: Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as never)
    ctx.habitId = 'habit-sweep'

    /* 另外两条待办：一条用于完成、一条用于删除，避免互相干扰断言 */
    for (const [id, title] of [
      ['td-sweep-done', '整理周报'],
      ['td-sweep-del', '临时想法'],
    ] as const) {
      await db.todos.put({
        id,
        title,
        desc: '',
        priority: 'mid',
        status: 'todo',
        createdAt: Date.now(),
        updatedAt: 0,
        deleted: 0,
        rev: 0,
      } as never)
    }

    /* ---------------- 二、写工具（含事件与落库校验） ---------------- */
    await kase(
      'fin_recordTransaction',
      () => ({ ledgerId: g('ledgerId'), summary: '王五 设备采购', amount: 2000, type: 'expense', customerId: g('customerId') }),
      (r) => {
        const d = r.data as { transactionId?: string }
        need(d?.transactionId, '未返回 transactionId')
        ctx.transactionId = d.transactionId
      },
    )

    await kase(
      'crm_addInteraction',
      () => ({ customerId: g('customerId'), content: '电话沟通采购需求', type: '电话' }),
      () => undefined,
    )

    await kase(
      'crm_addRelation',
      () => ({ customerId: g('customerId'), targetId: g('customer2Id'), label: '同一公司' }),
      () => undefined,
    )

    await kase(
      'crm_updateCustomer',
      () => ({ customerId: g('customerId'), tier: 'S', intimacyLevel: 'T2' }),
      async (r) => {
        void r
      },
    )

    await kase(
      'project_updateProject',
      () => ({ projectId: g('projectId'), status: 'archived' }),
      () => undefined,
    )

    await kase(
      'note_updateNote',
      () => ({ noteId: g('noteId'), title: '远山需求要点（终稿）' }),
      () => undefined,
    )

    await kase('todo_updateTodo', () => ({ todoId: g('todoId'), priority: 'low' }), () => undefined)

    await kase('todo_completeTodo', { todoId: 'td-sweep-done' }, async () => {
      const row = await db.todos.get('td-sweep-done')
      need(row?.status === 'done', `期望 status=done，实际 ${row?.status}`)
    })

    await kase('todo_deleteTodo', { todoId: 'td-sweep-del' }, async () => {
      const row = await db.todos.get('td-sweep-del')
      need(row?.deleted === 1, `期望 deleted=1，实际 ${row?.deleted}`)
    })

    /* 打卡：先真实打卡，再重复一次验幂等（外部 Agent 重试安全） */
    await kase('habit_checkin', () => ({ habitId: g('habitId'), date: '2026-09-12' }), (r) => {
      const d = r.data as { created?: boolean }
      need(d?.created === true, `首次打卡期望 created=true，实际 ${String(d?.created)}`)
    })
    await kase('habit_checkin', () => ({ habitId: g('habitId'), date: '2026-09-12' }), (r) => {
      const d = r.data as { created?: boolean }
      need(d?.created === false, `重复打卡期望 created=false（幂等），实际 ${String(d?.created)}`)
    })

    /* ---------------- 三、读工具（投影 / 限幅 / 内容正确性） ---------------- */
    await kase('resolveEntity', { query: '王五', type: 'customer' }, (r) => {
      const d = r.data as { status?: string; id?: string }
      need(d?.status === 'resolved', `期望 status=resolved，实际 ${String(d?.status)}`)
      need(d?.id === ctx.customerId, `期望消解到 ${ctx.customerId}，实际 ${String(d?.id)}`)
    })

    await kase('searchEntities', { q: '王五' }, (r) => {
      const d = r.data as ReadEnvelope<{ id: string }>
      need(d.items?.some((i) => i.id === ctx.customerId), '搜索结果未包含刚建的客户')
      need(d.count <= 20, `searchEntities 超出上限 20：${d.count}`)
    })

    await kase('getCustomer', () => ({ id: g('customerId') }), (r) => {
      const d = r.data as ReadEnvelope<Record<string, unknown>>
      need(d.items?.length === 1, `期望 1 条，实际 ${d.items?.length}`)
      need(d.items[0].name === '王五', `name 期望王五，实际 ${String(d.items[0].name)}`)
      need(!('relations' in d.items[0]), '投影不应含 relations 全量')
    })

    await kase('listTransactions', () => ({ customerId: g('customerId') }), (r) => {
      const d = r.data as ReadEnvelope<Record<string, unknown>>
      need(d.items?.length >= 1, `期望至少 1 条流水，实际 ${d.items?.length}`)
      const row = d.items.find((i) => i.id === ctx.transactionId)
      need(row, '未查到刚记的流水')
      need(row?.amount === 2000, `金额期望 2000，实际 ${String(row?.amount)}`)
      need(!('attachments' in (row ?? {})), '投影不应含 attachments')
    })

    await kase('listTodos', () => ({ customerId: g('customerId') }), (r) => {
      const d = r.data as ReadEnvelope<{ id: string }>
      need(d.items?.some((i) => i.id === ctx.todoId), '未查到关联该客户的待办')
    })

    await kase('listLedgers', {}, (r) => {
      const d = r.data as ReadEnvelope<{ id: string }>
      need(d.items?.some((i) => i.id === ctx.ledgerId), '未查到刚建的账本')
    })

    await kase('listHabits', {}, (r) => {
      const d = r.data as ReadEnvelope<{ id: string }>
      need(d.items?.some((i) => i.id === ctx.habitId), '未查到习惯')
    })

    await kase('listProjects', { status: 'archived' }, (r) => {
      const d = r.data as ReadEnvelope<{ id: string }>
      need(d.items?.some((i) => i.id === ctx.projectId), '按 archived 过滤未查到刚归档的项目')
    })

    await kase('listNotes', {}, (r) => {
      const d = r.data as ReadEnvelope<Record<string, unknown>>
      need(d.items?.some((i) => i.id === ctx.noteId), '未查到笔记')
      need(d.items.every((i) => i.markdown === undefined), 'listNotes 投影不应下发 markdown 正文')
    })

    await kase('listNoteFolders', {}, (r) => {
      const d = r.data as ReadEnvelope<{ id: string }>
      need(d.items?.some((i) => i.id === ctx.folderId), '未查到笔记文件夹')
    })

    /* ---------------- 四、删除类殿后（避免影响上面读断言） ---------------- */
    await kase('habit_deleteHabit', () => ({ habitId: g('habitId') }), async (r) => {
      void r
      const row = await db.habits.get('habit-sweep')
      need(row?.deleted === 1, `期望习惯已软删，实际 deleted=${row?.deleted}`)
    })

    /* ---------------- 汇总 ---------------- */
    const fails = results.filter((r) => !r.ok)
    const lines = results.map(
      (r) =>
        `${r.ok ? 'PASS' : 'FAIL'}  ${r.tool.padEnd(22)} ${r.phase.padEnd(10)} ${String(r.ms).padStart(5)}ms  ${r.detail}`,
    )
    console.log(
      `\n===== 工具遍历结果：共 ${results.length} 条，失败 ${fails.length} =====\n${lines.join('\n')}`,
    )
    if (schemaDiffs.length) {
      console.log(`\n===== 运行期 schema 与静态快照差异（${schemaDiffs.length}） =====\n${schemaDiffs.join('\n')}`)
    }
    expect(fails.map((f) => `${f.tool}: ${f.detail}`)).toEqual([])
  }, 90_000)

  it('③ 边界与异常（幽灵记录 / 悬挂引用 / 参数边界 / 歧义 / 限幅 / 票据重放）', async () => {
    const L = ctx.ledgerId ?? 'ldg-missing'
    const C = ctx.customerId ?? 'cus-missing'

    /* A. 幽灵记录：指向不存在记录的写操作必须被拒（"成功"是最危险的假阳性） */
    await probe('fin_recordTransaction', 'A1 记账→账本不存在', { ledgerId: 'ldg-not-exist', summary: 'x', amount: 1 }, 'error')
    await probe('crm_addInteraction', 'A2 记沟通→客户不存在', { customerId: 'cus-not-exist', content: 'x' }, 'error')
    await probe('crm_updateCustomer', 'A3 改客户→客户不存在', { customerId: 'cus-not-exist', tier: 'S' }, 'error')
    await probe('todo_updateTodo', 'A4 改待办→待办不存在', { todoId: 'td-not-exist', priority: 'low' }, 'error')
    await probe('todo_deleteTodo', 'A5 删待办→待办不存在', { todoId: 'td-not-exist' }, 'error')
    await probe('note_updateNote', 'A6 改笔记→笔记不存在', { noteId: 'nt-not-exist', title: 'x' }, 'error')
    await probe('project_updateProject', 'A7 改项目→项目不存在', { projectId: 'prj-not-exist', name: 'x' }, 'error')
    await probe('habit_checkin', 'A8 打卡→习惯不存在', { habitId: 'habit-not-exist', date: '2026-09-12' }, 'error')
    await probe('habit_deleteHabit', 'A9 删习惯→习惯不存在', { habitId: 'habit-not-exist' }, 'error')

    /* B. 悬挂引用：关联到不存在的目标必须被拒（图里不该出现指向已删节点的边） */
    await probe('todo_createTodo', 'B1 建待办→挂不存在客户', { title: 'x', customerId: 'cus-not-exist' }, 'error')
    await probe('note_createNote', 'B2 建笔记→放不存在文件夹', { title: 'x', folderId: 'nf-not-exist' }, 'error')
    await probe('project_createProject', 'B3 建项目→挂不存在客户', { name: 'x', customerId: 'cus-not-exist' }, 'error')
    await probe('crm_addRelation', 'B4 建关系→目标不存在', { customerId: C, targetId: 'cus-not-exist', label: '同事' }, 'error')
    await probe('todo_createTodo', 'B5 建待办→挂不存在项目', { title: 'x', projectId: 'prj-not-exist' }, 'error')
    await probe('todo_updateTodo', 'B6 改待办→换成不存在客户', { todoId: ctx.todoId ?? 'td-missing', customerId: 'cus-not-exist' }, 'error')
    await probe('note_createNote', 'B7 建笔记→挂不存在项目', { title: 'x', projectId: 'prj-not-exist' }, 'error')

    /* C. 参数边界 */
    await probe('fin_recordTransaction', 'C1 记账→负数金额', { ledgerId: L, summary: 'x', amount: -100 }, 'error')
    await probe('fin_recordTransaction', 'C2 记账→金额超上限', { ledgerId: L, summary: 'x', amount: 99999999999999 }, 'error')
    await probe('fin_recordTransaction', 'C3 记账→1900 年日期', { ledgerId: L, summary: 'x', amount: 1, occurredAt: '1900-01-01' }, 'error')
    await probe('fin_createLedger', 'C4 建账本→空名称', { name: '' }, 'error')
    await probe('todo_createTodo', 'C5 建待办→标题与正文皆空', { title: '', desc: '' }, 'error')
    await probe('crm_createCustomer', 'C6 建客户→空名称', { name: '' }, 'error')

    /* D. 消解歧义：同名两人必须反问，不许猜 id */
    await db.customers.bulkPut([
      { id: 'cus-dup-1', name: '李四', company: '甲公司', title: '', decisionLevel: '决策人', tier: 'A', tags: [], phone: '', wechat: '', email: '', address: '', relations: [], intimacy: 0, lastContactAt: Date.now(), createdAt: Date.now(), updatedAt: 0, deleted: 0, rev: 1 },
      { id: 'cus-dup-2', name: '李四', company: '乙公司', title: '', decisionLevel: '决策人', tier: 'A', tags: [], phone: '', wechat: '', email: '', address: '', relations: [], intimacy: 0, lastContactAt: Date.now(), createdAt: Date.now(), updatedAt: 0, deleted: 0, rev: 1 },
    ] as never)
    {
      const r = await invoke('resolveEntity', { query: '李四', type: 'customer' })
      const d = r.data as { status?: string; candidates?: unknown[] }
      const pass = d?.status === 'ambiguous'
      edge.push({
        label: 'D1 消解→同名两人',
        ok: pass,
        ms: 0,
        detail: pass ? `正确反问，候选 ${d.candidates?.length} 条` : `期望 ambiguous，实际 ${String(d?.status)}`,
      })
    }
    await probe('resolveEntity', 'D2 消解→空查询', { query: '', type: 'customer' }, 'error')

    /* E. 读工具限幅：超出上限必须截断并置 truncated */
    await db.transactions.bulkPut(
      Array.from({ length: 60 }, (_, i) => ({
        id: `txn-bulk-${i}`,
        ledgerId: L,
        type: 'expense',
        amount: 1,
        status: '待对账',
        occurredAt: Date.now(),
        summary: `批量 ${i}`,
        tags: [],
        createdAt: Date.now(),
        updatedAt: 0,
        deleted: 0,
        rev: 1,
      })) as never,
    )
    {
      const r = await invoke('listTransactions', {})
      const d = r.data as ReadEnvelope<unknown>
      const pass = d?.truncated === true && d.count <= 50
      edge.push({
        label: 'E1 读→超 50 条应截断',
        ok: pass,
        ms: 0,
        detail: pass
          ? `truncated=true, count=${d.count}`
          : `期望 truncated=true 且 count<=50，实际 truncated=${String(d?.truncated)}, count=${String(d?.count)}`,
      })
    }

    /* F. 确认票据一次性：同一 token 二次使用必须被拒（防重放） */
    {
      const args = { name: '重放测试客户' }
      const p = await mcp.callTool('crm_createCustomer', args)
      const hint = (p.data as { confirmHint?: { args: Record<string, unknown> } }).confirmHint?.args
      const token = hint ? findToken((await mcp.callTool('confirm_preview', hint)).data) : undefined
      if (!token) {
        edge.push({ label: 'F1 票据→重放应被拒', ok: false, ms: 0, detail: '未能取得 confirmToken，无法验证' })
      } else {
        const first = await mcp.callTool('crm_createCustomer', args, token)
        const second = await mcp.callTool('crm_createCustomer', args, token)
        const pass = first.ok === true && second.ok === false
        edge.push({
          label: 'F1 票据→重放应被拒',
          ok: pass,
          ms: 0,
          detail: pass
            ? `首次成功，二次被拒：${second.text.replace(/\s+/g, ' ').slice(0, 70)}`
            : `期望 首次成功/二次被拒，实际 首次=${first.ok} 二次=${second.ok}`,
        })
      }
    }

    const fails = edge.filter((e) => !e.ok)
    console.log(
      `\n===== 边界用例：共 ${edge.length} 条，失败 ${fails.length} =====\n` +
        edge.map((e) => `${e.ok ? 'PASS' : 'FAIL'}  ${e.label.padEnd(30)} ${e.detail}`).join('\n'),
    )
    expect(fails.map((f) => f.label)).toEqual([])
  }, 90_000)
})

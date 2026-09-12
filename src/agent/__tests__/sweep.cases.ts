/**
 * agentOps 工具遍历用例库 —— 本地 / 线上**共用同一套**用例与断言
 *
 * 为什么抽成模块：本地探针与线上探针若各写一份用例，那「线上再测一遍」就退化成第二套实现 ——
 * 而本仓库刚吃过一模一样的亏（生成器内联拷贝与运行期 schema 漂移，见
 * `docs/审查报告-agentOps功能遍历-20260912.md` 的 P1-2）。用例、参数、断言必须同源。
 *
 * 断言口径：**默认一律走「读工具回读」**，因为线上环境拿不到本地 db。
 * 本地探针可注入 `deps.records`（fake-indexeddb 实例）额外做落库级核对；
 * 线上不注入时，相关断言自动降级为读工具口径（而不是静默跳过）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { McpClient, ReadEnvelope } from './e2e.harness'

export type SweepRow = { tool: string; phase: string; ok: boolean; ms: number; detail: string }
export type SweepEdge = { label: string; ok: boolean; ms: number; detail: string }

export type SweepResult = {
  rows: SweepRow[]
  edges: SweepEdge[]
  schemaDiffs: string[]
  ctx: Record<string, string>
}

export type SweepDeps = {
  /** 落库级核对（本地 fake-indexeddb）。线上不传 → 用读工具回读代替 */
  records?: {
    todo(id: string): Promise<{ deleted?: 0 | 1; status?: string } | undefined>
    habit(id: string): Promise<{ deleted?: 0 | 1 } | undefined>
  }
  /** 直接造库（限幅用例需要 60 条流水）。线上不传 → 该用例标记为跳过 */
  bulkSeedTransactions?: (ledgerId: string, n: number) => Promise<void>
  /** mcp-tools.json 路径（默认仓库内 docs/skills/mcp-tools.json） */
  snapshotPath?: string
}

function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
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

export type InvokeResult = { ok: boolean; phase: string; text: string; data: unknown }

/**
 * 标准 Agent 调用行为：低风险直达；中/高风险先预览 → `confirm_preview` 取票 → 带票重试。
 *
 * 导出原因：演示数据播种脚本也要按同样方式调工具。取票逻辑若再抄一份，就是第三处实现 ——
 * 本仓库刚因「生成器抄了一份拷贝」吃过亏，不再重复。
 */
export function makeInvoker(mcp: McpClient) {
  return async (tool: string, args: Record<string, unknown> = {}): Promise<InvokeResult> => {
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
}

/**
 * 主入口：跑完整遍历（27 工具正向 + 边界用例），返回结构化结果，**不抛错**。
 * 调用方负责打印与断言（本地/线上各自的入口测试）。
 */
export async function runToolSweep(mcp: McpClient, deps: SweepDeps = {}): Promise<SweepResult> {
  const rows: SweepRow[] = []
  const edges: SweepEdge[] = []
  const schemaDiffs: string[] = []
  const ctx: Record<string, string> = {}

  const g = (key: string): string => {
    const v = ctx[key]
    if (!v) throw new Error(`前置数据缺失：${key}（上游步骤失败导致）`)
    return v
  }

  const invoke = makeInvoker(mcp)

  /** 跑一个正向用例：记录结果，不抛出（保证遍历跑完） */
  async function kase(
    tool: string,
    args: Record<string, unknown> | (() => Record<string, unknown>),
    verify?: (r: InvokeResult) => void | Promise<void>,
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
          await verify(r)
        } catch (e) {
          problems.push((e as Error).message)
        }
      }
      rows.push({ tool, phase, ok: problems.length === 0, ms: Date.now() - t0, detail: problems.join(' | ') || 'OK' })
    } catch (e) {
      rows.push({ tool, phase, ok: false, ms: Date.now() - t0, detail: `异常：${(e as Error).message}` })
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
      edges.push({
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
      edges.push({ label, ok: false, ms: Date.now() - t0, detail: `异常：${(e as Error).message}` })
    }
  }

  /* ==================== ① 运行期 tools/list 与静态快照一致性 ==================== */
  const snapshotPath = deps.snapshotPath ?? path.resolve(__dirname, '../../../docs/skills/mcp-tools.json')
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
    tools: { name: string; inputSchema: Record<string, unknown> }[]
  }
  {
    const all = await mcp.listTools()
    const tools = all.filter((t) => t.name !== 'confirm_preview')
    if (tools.length !== 27) schemaDiffs.push(`下发业务工具数 ${tools.length}，期望 27`)
    const snapMap = new Map(snapshot.tools.map((t) => [t.name, t.inputSchema]))
    for (const t of tools) {
      const snap = snapMap.get(t.name)
      if (!snap) {
        schemaDiffs.push(`${t.name}：静态快照中缺失`)
        continue
      }
      const live = JSON.stringify(t.inputSchema)
      const stat = JSON.stringify(snap)
      if (live !== stat) {
        schemaDiffs.push(`【${t.name}】运行期 ≠ 静态快照\n      运行期  ${live}\n      静态    ${stat}`)
      }
    }
  }

  /* ==================== ② 正向遍历（27 个工具） ==================== */

  // 每次运行用**唯一的客户名**：线上/本地环境反复跑会累积同名实体，
  // 固定名字会让 resolveEntity 从 resolved 退化成 ambiguous —— 看起来像缺陷，实际是数据累积
  const RUN_ID = Math.random().toString(36).slice(2, 7)
  const CUSTOMER_NAME = `王五-${RUN_ID}`
  const CUSTOMER2_NAME = `赵六-${RUN_ID}`

  // —— 前置数据 ——
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

  await kase('crm_createCustomer', { name: CUSTOMER_NAME, company: '深蓝科技' }, (r) => {
    const d = r.data as { customerId?: string }
    need(d?.customerId, '未返回 customerId')
    ctx.customerId = d.customerId
    ctx.customerName = CUSTOMER_NAME
  })

  await kase('crm_createCustomer', { name: CUSTOMER2_NAME, company: '远山设计' }, (r) => {
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

  // 习惯域没有「创建习惯」工具、`resolveEntity` 也不含 habit（观察项）：
  // 本地由测试预置固定 id；线上从 `listHabits` 取一个已有习惯（取不到则相关用例如实标注跳过）
  if (deps.records) {
    ctx.habitId = 'habit-sweep'
  } else {
    const h = await invoke('listHabits', {})
    const d = h.data as ReadEnvelope<{ id: string }>
    if (d.items?.length) ctx.habitId = d.items[0].id
  }

  // —— 写工具 ——
  await kase(
    'fin_recordTransaction',
    () => ({ ledgerId: g('ledgerId'), summary: '王五 设备采购', amount: 2000, type: 'expense', customerId: g('customerId') }),
    (r) => {
      const d = r.data as { transactionId?: string }
      need(d?.transactionId, '未返回 transactionId')
      ctx.transactionId = d.transactionId
    },
  )

  await kase('crm_addInteraction', () => ({ customerId: g('customerId'), content: '电话沟通采购需求', type: '电话' }))

  await kase('crm_addRelation', () => ({ customerId: g('customerId'), targetId: g('customer2Id'), label: '同一公司' }))

  await kase('crm_updateCustomer', () => ({ customerId: g('customerId'), tier: 'S', intimacyLevel: 'T2' }), async () => {
    const c = await invoke('getCustomer', { id: g('customerId') })
    const d = c.data as ReadEnvelope<Record<string, unknown>>
    need(d.items?.[0]?.tier === 'S', `tier 期望 S，实际 ${String(d.items?.[0]?.tier)}`)
  })

  await kase('project_updateProject', () => ({ projectId: g('projectId'), status: 'archived' }), async () => {
    const p = await invoke('listProjects', { status: 'archived' })
    const d = p.data as ReadEnvelope<{ id: string }>
    need(d.items?.some((i) => i.id === g('projectId')), '归档后 listProjects 未查到')
  })

  await kase('note_updateNote', () => ({ noteId: g('noteId'), title: '远山需求要点（终稿）' }), async () => {
    const n = await invoke('listNotes', {})
    const d = n.data as ReadEnvelope<{ id: string; title: string }>
    need(d.items?.find((i) => i.id === g('noteId'))?.title === '远山需求要点（终稿）', '标题未更新')
  })

  await kase('todo_updateTodo', () => ({ todoId: g('todoId'), priority: 'low' }))

  await kase('todo_completeTodo', () => ({ todoId: g('todoId') }), async () => {
    if (deps.records) {
      const row = await deps.records.todo(g('todoId'))
      need(row?.status === 'done', `落库 status 期望 done，实际 ${String(row?.status)}`)
    } else {
      const t = await invoke('listTodos', { status: 'done' })
      const d = t.data as ReadEnvelope<{ id: string }>
      need(d.items?.some((i) => i.id === g('todoId')), '完成后 listTodos(status=done) 未查到')
    }
  })

  // 打卡（含幂等复测）—— 需要环境中存在习惯；没有则**如实标注跳过**，不伪装成通过
  if (ctx.habitId) {
    // 线上沿用的是「已有习惯」，它今天可能已经打过卡 —— 先取消，确保从「未打卡」态出发，
    // 否则首次打卡会返回 created=false，看起来像缺陷，实际是用例前提没对齐
    const day = new Date().toLocaleDateString('sv-SE')
    await invoke('habit_checkin', { habitId: ctx.habitId, date: day, undo: true })
    await kase('habit_checkin', () => ({ habitId: g('habitId'), date: day }), (r) => {
      const d = r.data as { created?: boolean }
      need(d?.created === true, `首次打卡期望 created=true，实际 ${String(d?.created)}`)
    })
    await kase('habit_checkin', () => ({ habitId: g('habitId'), date: day }), (r) => {
      const d = r.data as { created?: boolean }
      need(d?.created === false, `重复打卡期望 created=false（幂等），实际 ${String(d?.created)}`)
    })
  } else {
    rows.push({
      tool: 'habit_checkin',
      phase: 'skip',
      ok: true,
      ms: 0,
      detail: '跳过：环境中没有可用习惯（habit 域无「创建习惯」工具，无法自造）',
    })
  }

  // —— 读工具 ——
  await kase('resolveEntity', () => ({ query: g('customerName'), type: 'customer' }), (r) => {
    const d = r.data as { status?: string; id?: string }
    need(d?.status === 'resolved', `期望 status=resolved，实际 ${String(d?.status)}`)
    need(d?.id === ctx.customerId, `期望消解到 ${ctx.customerId}，实际 ${String(d?.id)}`)
  })

  await kase('searchEntities', () => ({ q: g('customerName') }), (r) => {
    const d = r.data as ReadEnvelope<{ id: string }>
    need(d.items?.some((i) => i.id === ctx.customerId), '搜索结果未包含刚建的客户')
    need(d.count <= 20, `searchEntities 超出上限 20：${d.count}`)
  })

  await kase('getCustomer', () => ({ id: g('customerId') }), (r) => {
    const d = r.data as ReadEnvelope<Record<string, unknown>>
    need(d.items?.length === 1, `期望 1 条，实际 ${d.items?.length}`)
    need(d.items[0].name === ctx.customerName, `name 期望 ${ctx.customerName}，实际 ${String(d.items[0].name)}`)
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
    need(Array.isArray(d.items), 'listHabits 未返回 items 数组')
    if (deps.records) {
      need(d.items.some((i) => i.id === ctx.habitId), `未查到本地预置习惯 ${ctx.habitId}`)
    }
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

  // 删除类殿后（避免影响上面的读断言）
  await kase('todo_deleteTodo', () => ({ todoId: g('todoId') }), async () => {
    if (deps.records) {
      const row = await deps.records.todo(g('todoId'))
      need(row?.deleted === 1, `期望待办已软删，实际 deleted=${row?.deleted}`)
    } else {
      const t = await invoke('listTodos', { customerId: g('customerId') })
      const d = t.data as ReadEnvelope<{ id: string }>
      need(!d.items?.some((i) => i.id === ctx.todoId), '删除后 listTodos 仍能查到')
    }
  })

  if (ctx.habitId) {
    await kase('habit_deleteHabit', () => ({ habitId: g('habitId') }), async () => {
      if (deps.records) {
        const row = await deps.records.habit(g('habitId'))
        need(row?.deleted === 1, `期望习惯已软删，实际 deleted=${row?.deleted}`)
      } else {
        const h = await invoke('listHabits', {})
        const d = h.data as ReadEnvelope<{ id: string }>
        need(!d.items?.some((i) => i.id === ctx.habitId), '删除后 listHabits 仍能查到')
      }
    })
  } else {
    rows.push({
      tool: 'habit_deleteHabit',
      phase: 'skip',
      ok: true,
      ms: 0,
      detail: '跳过：环境中没有可用习惯（habit 域无「创建习惯」工具，无法自造）',
    })
  }

  /* ==================== ③ 边界与异常 ==================== */
  const L = ctx.ledgerId ?? 'ldg-missing'
  const C = ctx.customerId ?? 'cus-missing'

  // A. 幽灵记录
  await probe('fin_recordTransaction', 'A1 记账→账本不存在', { ledgerId: 'ldg-not-exist', summary: 'x', amount: 1 }, 'error')
  await probe('crm_addInteraction', 'A2 记沟通→客户不存在', { customerId: 'cus-not-exist', content: 'x' }, 'error')
  await probe('crm_updateCustomer', 'A3 改客户→客户不存在', { customerId: 'cus-not-exist', tier: 'S' }, 'error')
  await probe('todo_updateTodo', 'A4 改待办→待办不存在', { todoId: 'td-not-exist', priority: 'low' }, 'error')
  await probe('todo_deleteTodo', 'A5 删待办→待办不存在', { todoId: 'td-not-exist' }, 'error')
  await probe('note_updateNote', 'A6 改笔记→笔记不存在', { noteId: 'nt-not-exist', title: 'x' }, 'error')
  await probe('project_updateProject', 'A7 改项目→项目不存在', { projectId: 'prj-not-exist', name: 'x' }, 'error')
  await probe('habit_checkin', 'A8 打卡→习惯不存在', { habitId: 'habit-not-exist', date: '2026-09-12' }, 'error')
  await probe('habit_deleteHabit', 'A9 删习惯→习惯不存在', { habitId: 'habit-not-exist' }, 'error')

  // B. 悬挂引用（P1-1 修复的回归点）
  await probe('todo_createTodo', 'B1 建待办→挂不存在客户', { title: 'x', customerId: 'cus-not-exist' }, 'error')
  await probe('note_createNote', 'B2 建笔记→放不存在文件夹', { title: 'x', folderId: 'nf-not-exist' }, 'error')
  await probe('project_createProject', 'B3 建项目→挂不存在客户', { name: 'x', customerId: 'cus-not-exist' }, 'error')
  await probe('crm_addRelation', 'B4 建关系→目标不存在', { customerId: C, targetId: 'cus-not-exist', label: '同事' }, 'error')
  await probe('todo_createTodo', 'B5 建待办→挂不存在项目', { title: 'x', projectId: 'prj-not-exist' }, 'error')
  await probe('todo_updateTodo', 'B6 改待办→换成不存在客户', { todoId: ctx.todoId ?? 'td-missing', customerId: 'cus-not-exist' }, 'error')
  await probe('note_createNote', 'B7 建笔记→挂不存在项目', { title: 'x', projectId: 'prj-not-exist' }, 'error')

  // C. 参数边界
  await probe('fin_recordTransaction', 'C1 记账→负数金额', { ledgerId: L, summary: 'x', amount: -100 }, 'error')
  await probe('fin_recordTransaction', 'C2 记账→金额超上限', { ledgerId: L, summary: 'x', amount: 99999999999999 }, 'error')
  await probe('fin_recordTransaction', 'C3 记账→1900 年日期', { ledgerId: L, summary: 'x', amount: 1, occurredAt: '1900-01-01' }, 'error')
  await probe('fin_createLedger', 'C4 建账本→空名称', { name: '' }, 'error')
  await probe('todo_createTodo', 'C5 建待办→标题与正文皆空', { title: '', desc: '' }, 'error')
  await probe('crm_createCustomer', 'C6 建客户→空名称', { name: '' }, 'error')

  // D. 消解歧义（经工具造同名两人，线上同样可行）
  await kase('crm_createCustomer', { name: '李四', company: '甲公司' })
  await kase('crm_createCustomer', { name: '李四', company: '乙公司' })
  {
    const r = await invoke('resolveEntity', { query: '李四', type: 'customer' })
    const d = r.data as { status?: string; candidates?: unknown[] }
    const pass = d?.status === 'ambiguous'
    edges.push({
      label: 'D1 消解→同名两人',
      ok: pass,
      ms: 0,
      detail: pass ? `正确反问，候选 ${d.candidates?.length} 条` : `期望 ambiguous，实际 ${String(d?.status)}`,
    })
  }
  await probe('resolveEntity', 'D2 消解→空查询', { query: '', type: 'customer' }, 'error')

  // E. 读限幅（需要直接造 60 条流水；线上无此能力 → 跳过）
  if (deps.bulkSeedTransactions) {
    await deps.bulkSeedTransactions(L, 60)
    const r = await invoke('listTransactions', {})
    const d = r.data as ReadEnvelope<unknown>
    const pass = d?.truncated === true && d.count <= 50
    edges.push({
      label: 'E1 读→超 50 条应截断',
      ok: pass,
      ms: 0,
      detail: pass
        ? `truncated=true, count=${d.count}`
        : `期望 truncated=true 且 count<=50，实际 truncated=${String(d?.truncated)}, count=${String(d?.count)}`,
    })
  } else {
    edges.push({ label: 'E1 读→超 50 条应截断', ok: true, ms: 0, detail: '跳过（当前环境不便直接造 60 条流水）' })
  }

  // F. 确认票据一次性（防重放）
  {
    const args = { name: '重放测试客户' }
    const p = await mcp.callTool('crm_createCustomer', args)
    const hint = (p.data as { confirmHint?: { args: Record<string, unknown> } }).confirmHint?.args
    const token = hint ? findToken((await mcp.callTool('confirm_preview', hint)).data) : undefined
    if (!token) {
      edges.push({ label: 'F1 票据→重放应被拒', ok: false, ms: 0, detail: '未能取得 confirmToken，无法验证' })
    } else {
      const first = await mcp.callTool('crm_createCustomer', args, token)
      const second = await mcp.callTool('crm_createCustomer', args, token)
      const pass = first.ok === true && second.ok === false
      edges.push({
        label: 'F1 票据→重放应被拒',
        ok: pass,
        ms: 0,
        detail: pass
          ? `首次成功，二次被拒：${second.text.replace(/\s+/g, ' ').slice(0, 70)}`
          : `期望 首次成功/二次被拒，实际 首次=${first.ok} 二次=${second.ok}`,
      })
    }
  }

  return { rows, edges, schemaDiffs, ctx }
}

/** 统一的结果打印（两个入口测试共用，避免报告格式漂移） */
export function formatSweepReport(r: SweepResult, title: string): string {
  const rowFails = r.rows.filter((x) => !x.ok)
  const edgeFails = r.edges.filter((x) => !x.ok)
  const lines: string[] = []
  lines.push(`\n===== ${title}：正向 ${r.rows.length} 条 / 失败 ${rowFails.length} =====`)
  lines.push(
    ...r.rows.map(
      (x) => `${x.ok ? 'PASS' : 'FAIL'}  ${x.tool.padEnd(22)} ${x.phase.padEnd(10)} ${String(x.ms).padStart(5)}ms  ${x.detail}`,
    ),
  )
  lines.push(`\n----- 边界用例 ${r.edges.length} 条 / 失败 ${edgeFails.length} -----`)
  lines.push(...r.edges.map((x) => `${x.ok ? 'PASS' : 'FAIL'}  ${x.label.padEnd(30)} ${x.detail}`))
  if (r.schemaDiffs.length) {
    lines.push(`\n----- 运行期 schema 与静态快照差异（${r.schemaDiffs.length}）-----`)
    lines.push(...r.schemaDiffs)
  }
  return lines.join('\n')
}

export function failuresOf(r: SweepResult): string[] {
  return [
    ...r.rows.filter((x) => !x.ok).map((x) => `${x.tool}: ${x.detail}`),
    ...r.edges.filter((x) => !x.ok).map((x) => `${x.label}: ${x.detail}`),
  ]
}

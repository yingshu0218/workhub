/**
 * P1 第 7 步 · E2E 主干验收（方案 §9.8，含四条补强断言）
 *
 * 链路：MCP 客户端（真 WS）→ relay 子进程（真 RFC6455 + 真 MCP 路由）→ 页面内 AgentBridge（原样复用）
 *       → agentOps（schema 校验 + 白名单 + 风险分级 + 事件声明）→ repositories → Dexie(fake-indexeddb)。
 *
 * 场景（§9.8）：加客户「深蓝科技·王五」→ 给王五记一笔 2000 支出（账本走缺省、status=待对账）
 *              → 读回该客户账目与沟通记录 → 建待办「周五回访王五」→ 查待办确认存在。
 * 补强断言：① relay vs 手工 emit 载荷逐字段一致；② 编辑流水不再触发 created；
 *          ③ 读工具条数/字段不超白名单；④ 无 token 被拒 + 白名单关闭的域不出现在 tools 清单。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { eventBus, type AppEvent } from '@/shared/eventBus'
import {
  settingsRepo,
  saveTransactionWithAttachments,
  saveInteractionAndTouchCustomer,
  createCustomerWithInit,
} from '@/repositories'
import { DEFAULT_SETTINGS, type Customer, type Settings } from '@/db/types'
import { agentBridge } from '../bridge'
import { READ_LIMITS } from '../reads'
import { MCP_PROTOCOL_VERSION } from '@relay/mcp-relay.mjs'
import {
  installWebSocketGlobal,
  startRelay,
  connectBridge,
  McpClient,
  waitFor,
  type RelayProcess,
  type ReadEnvelope,
} from './e2e.harness'
import type { ResolveResult } from '../resolver'

/* ------------------------------- 事件捕获 ------------------------------- */
let captured: { event: keyof AppEvent; payload: unknown }[] = []
const origEmit = eventBus.emit.bind(eventBus)

beforeAll(() => {
  eventBus.emit = (event: keyof AppEvent, payload: unknown) => {
    captured.push({ event, payload })
    ;(origEmit as unknown as (e: keyof AppEvent, p: unknown) => void)(event, payload)
  }
})
afterAll(() => {
  eventBus.emit = origEmit
})
beforeEach(() => {
  captured = []
})

/* ------------------------------- 桥 + relay ------------------------------- */
let relay: RelayProcess
let mcp: McpClient
let bridgeUrl: string

/** 造一条最小可用客户（createCustomerWithInit 只接受完整 Customer 记录） */
function newCustomer(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name,
    company: '',
    title: '',
    decisionLevel: '决策人',
    tier: 'A',
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    relations: [],
    intimacy: 0,
    lastContactAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: 0,
    deleted: 0 as const,
    rev: 1,
    ...over,
  }
}

/** 造一个默认账本（记账前置）。注：`ledgerId` 自本轮起**可缺省**（缺省走领域层
 *  isDefault → 唯一账本 → 反问），本 harness 仍显式传入以固定测试数据形态。 */
async function ensureLedger(id = 'ldg-e2e'): Promise<string> {
  const existing = await db.ledgers.get(id)
  if (!existing || existing.deleted) {
    await db.ledgers.put({
      id,
      name: '默认账本',
      currency: 'CNY',
      openingBalance: 0,
      closingCycle: '月结',
      isDefault: true,
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 1,
    } as never)
  }
  return id
}

/** 取默认账本（isDefault 全局唯一纪律与 UI 一致；无默认则取第一个活账本） */
/** 白名单在用例内可改：桥每次调用都会重新读 settings，改库即生效 */
async function setDomains(domains: Settings['ai']['domains']): Promise<void> {
  await settingsRepo.save({
    ai: { ...DEFAULT_SETTINGS.ai, bridgeEnabled: true, bridgeToken: relay.token, bridgeUrl, domains },
  })
}

/**
 * 取中风险预览后的 confirmToken。
 * preview 与 execute 是同一工具的两次调用：第一次不带 token 回预览材料，第二次携带 token 执行。
 * relay 侧 ConfirmTokenStore 负责签发/核销（一次性、5min、防重放）。
 */
function previewToken(res: { data?: unknown }): string | undefined {
  const d = res.data as { confirmToken?: string } | undefined
  return d?.confirmToken
}

describe('P1 第 7 步 E2E 主干验收（§9.8）', () => {
  beforeAll(async () => {
    installWebSocketGlobal()
    // relay 以 --dev 起：预览响应自动附一次性 confirmToken，供自动化跑通「预览→确认→执行」
    relay = await startRelay({ dev: true })
    await relay.ready
    bridgeUrl = 'ws://127.0.0.1:' + relay.port
    // 等价于「打开应用 + 设置页启用 AI 桥」（settings ai 段是桥的唯一开关）
    await settingsRepo.save({
      ai: { ...DEFAULT_SETTINGS.ai, bridgeEnabled: true, bridgeToken: relay.token, bridgeUrl },
    })
    await connectBridge(relay, agentBridge)

    // MCP Agent 接入（标准 MCP over WS，携带 relay 启动时生成/注入的 token）
    mcp = await McpClient.open(bridgeUrl)
    const init = await mcp.initialize(relay.token)
    expect(init.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(init.serverInfo.name).toBe('workhub-agentops-relay')
  }, 30_000)

  afterAll(async () => {
    mcp?.close()
    agentBridge.disconnect()
    await relay?.stop()
  })

  /* ======================= 补强断言 ④：安全边界 / 门控 ======================= */

  it('④-1 无 token：未 initialize 的会话被拒，token 错误无法完成 initialize', async () => {
    const spy = await McpClient.open(bridgeUrl)
    await expect(spy.listTools()).rejects.toThrow(/未鉴权/)
    await expect(spy.initialize('wrong-token')).rejects.toThrow(/token 无效/)
    spy.close()
  })

  it('④-2 白名单：关闭 fin 域后 tools 清单里不再出现 fin_ 工具，且调用被拒', async () => {
    await setDomains({ fin: false })
    const tools = await mcp.listTools()
    expect(tools.length).toBeGreaterThan(0)
    // 关闭的域不是「调用时拒绝」，而是清单里根本不出现（§四.3 硬边界）
    expect(tools.some((t) => t.name.startsWith('fin_'))).toBe(false)
    // 读域不受影响
    expect(tools.map((t) => t.name)).toContain('resolveEntity')
    // 且即使点名调用也过不去闸门（闸门不区分调用来源）。
    // 注意调用顺序：中风险工具在「无 confirmToken」时先被预览层拦下（返回预览材料、ok=true），
    // 带上票据后才真正走到白名单闸门 —— 这里显式带上票据，验的是闸门本身。
    const preview = await mcp.callTool('fin_recordTransaction', { ledgerId: 'x', summary: 'y', amount: 1 })
    expect((preview.data as { preview?: boolean }).preview).toBe(true)
    const gate = await mcp.callTool(
      'fin_recordTransaction',
      { ledgerId: 'x', summary: 'y', amount: 1 },
      previewToken(preview),
    )
    expect(gate.ok).toBe(false)
    expect(gate.text).toContain('白名单')

    await setDomains({})
    const restored = await mcp.listTools()
    expect(restored.some((t) => t.name.startsWith('fin_'))).toBe(true)
  })

  /* ===================== 补强断言 ③：读工具投影与限幅 ===================== */

  it('③ 读工具：tools/list 下发 inputSchema，读返回条数/字段不超白名单', async () => {
    const tools = await mcp.listTools()
    const fin = tools.find((t) => t.name === 'fin_recordTransaction')
    expect(fin?.inputSchema).toBeTruthy()
    expect(fin?.annotations?.risk).toBe('medium')
    expect(fin?.annotations?.domain).toBe('fin')

    const txs = await mcp.callTool('listTransactions', {})
    const env = txs.data as ReadEnvelope
    expect(env.count).toBeLessThanOrEqual(READ_LIMITS.listTransactions)
    for (const row of env.items) {
      expect(row).not.toHaveProperty('attachments')
      expect(Object.keys(row).length).toBeLessThanOrEqual(10)
    }
  })

  /* ============================ §9.8 主干场景 ============================ */

  it('主干：加客户「王五」→ 记一笔 2000 支出 → 读回账目与沟通 → 建待办 → 查待办', async () => {
    /* 1. resolveEntity 首查：不存在 → 零候选（不硬造，走创建） */
    const probe = await mcp.callTool('resolveEntity', { query: '王五', type: 'customer' })
    const probeRes = probe.data as ResolveResult
    expect(probeRes.status).toBe('ambiguous')
    expect(probeRes.candidates).toHaveLength(0)

    /* 2. 建客户（中风险：无 confirmToken 只回预览材料，不落库） */
    const preview = await mcp.callTool('crm_createCustomer', { name: '王五', company: '深蓝科技' })
    expect(preview.ok).toBe(true)
    expect((preview.data as { preview?: boolean }).preview).toBe(true)
    expect(await db.customers.count()).toBe(0)

    /* 3. 确认后执行（携带 relay 签发的一次性 confirmToken） */
    const created = await mcp.callTool(
      'crm_createCustomer',
      { name: '王五', company: '深蓝科技' },
      previewToken(preview),
    )
    expect(created.ok, created.text).toBe(true)
    const customerId = (created.data as { customerId: string }).customerId
    expect(customerId).toBeTruthy()

    /* 4. 再次 resolveEntity：唯一命中 → 静默消解（判 id 不判 label） */
    const found = await mcp.callTool('resolveEntity', { query: '王五', type: 'customer' })
    const foundRes = found.data as ResolveResult
    expect(foundRes.status).toBe('resolved')
    expect(foundRes.id).toBe(customerId)

    /* 5. 账本：Agent 先 listLedgers 发现，无账本时按 skill 指引先建默认账本
          （记账工具 ledgerId 可缺省，缺省走 isDefault → 唯一账本 → 反问；这里走显式路径） */
    const empty = await mcp.callTool('listLedgers', {})
    expect((empty.data as ReadEnvelope).count).toBe(0)
    const createdLedger = await mcp.callTool('fin_createLedger', { name: '默认账本', isDefault: true })
    expect(createdLedger.ok, createdLedger.text).toBe(true)
    const ledgers = await mcp.callTool('listLedgers', {})
    const ledgerItems = (ledgers.data as ReadEnvelope<{ id: string; isDefault?: boolean }>).items
    expect(ledgerItems.length).toBeGreaterThan(0)
    const ledgerId = (ledgerItems.find((l) => l.isDefault) ?? ledgerItems[0]).id

    /* 6. 记一笔 2000 支出（中风险：先预览再执行） */
    const txnArgs = { ledgerId, summary: '王五 设备采购', amount: 2000, type: 'expense', customerId }
    const txnPreview = await mcp.callTool('fin_recordTransaction', txnArgs)
    expect((txnPreview.data as { preview?: boolean }).preview).toBe(true)
    const txnRes = await mcp.callTool('fin_recordTransaction', txnArgs, previewToken(txnPreview))
    expect(txnRes.ok, txnRes.text).toBe(true)
    const transactionId = (txnRes.data as { transactionId: string }).transactionId

    /* 7. 读回该客户账目 */
    const byCustomer = await mcp.callTool('listTransactions', { customerId })
    // Issue #140：投影改为数组字段 customerIds（单值入参自动包数组，外部 Agent 契约零改动）
    const txnEnv = byCustomer.data as ReadEnvelope<{ id: string; amount: number; status: string; customerIds?: string[] }>
    expect(txnEnv.items).toHaveLength(1)
    expect(txnEnv.items[0].id).toBe(transactionId)
    expect(txnEnv.items[0].amount).toBe(2000)
    expect(txnEnv.items[0].status).toBe('待对账')
    expect(txnEnv.items[0].customerIds).toEqual([customerId])

    /* 8. 记一条沟通日志（中风险）并读回客户档案 + 沟通记录 */
    const logPreview = await mcp.callTool('crm_addInteraction', {
      customerId,
      content: '电话沟通采购需求',
      type: '电话',
    })
    expect((logPreview.data as { preview?: boolean }).preview).toBe(true)
    const logRes = await mcp.callTool(
      'crm_addInteraction',
      { customerId, content: '电话沟通采购需求', type: '电话' },
      previewToken(logPreview),
    )
    expect(logRes.ok).toBe(true)

    const customer = await mcp.callTool('getCustomer', { id: customerId })
    const custEnv = customer.data as ReadEnvelope<{ id: string; name: string }>
    expect(custEnv.items).toHaveLength(1)
    expect(custEnv.items[0].name).toBe('王五')
    expect(custEnv.items[0]).not.toHaveProperty('relations')
    const interactions = await db.interactions.where('customerId').equals(customerId).toArray()
    expect(interactions.filter((i) => !i.deleted)).toHaveLength(1)

    /* 9. 建待办「周五回访王五」（低风险，直达执行；关联该客户） */
    const todoRes = await mcp.callTool('todo_createTodo', {
      title: '周五回访王五',
      customerId,
      priority: 'high',
    })
    expect(todoRes.ok, todoRes.text).toBe(true)
    const todoId = (todoRes.data as { todoId: string }).todoId

    /* 10. 查待办列表确认存在 */
    const todos = await mcp.callTool('listTodos', { customerId })
    const todoEnv = todos.data as ReadEnvelope<{ id: string; title: string }>
    expect(todoEnv.items.map((t) => t.id)).toContain(todoId)
    expect(todoEnv.items.find((t) => t.id === todoId)?.title).toBe('周五回访王五')
  }, 40_000)

  /* ================= 补强断言 ①：relay 路径 vs 手工路径 ================= */

  it('① 经 relay 记一笔 vs 手工记账：事件载荷键集一致，完成域行为无差异', async () => {
    const ledgerId = await ensureLedger()

    captured = []
    const aiPreview = await mcp.callTool('fin_recordTransaction', {
      ledgerId,
      summary: 'AI 记账',
      amount: 88,
      type: 'expense',
    })
    await mcp.callTool(
      'fin_recordTransaction',
      { ledgerId, summary: 'AI 记账', amount: 88, type: 'expense' },
      previewToken(aiPreview),
    )
    await waitFor(
      () => captured.some((e) => e.event === 'transaction:created'),
      3000,
      'AI 路径未发出 transaction:created',
    )
    const aiEvent = captured.find((e) => e.event === 'transaction:created')!

    captured = []
    await saveTransactionWithAttachments(
      {
        id: 'txn-manual-e2e',
        ledgerId,
        summary: '手工记账',
        amount: 88,
        type: 'expense',
        status: '待对账',
        occurredAt: Date.now(),
        tags: [],
      } as never,
      [],
    )
    const manualEvent = captured.find((e) => e.event === 'transaction:created')
    expect(manualEvent).toBeTruthy()

    expect(aiEvent.event).toBe(manualEvent!.event)
    expect(Object.keys(aiEvent.payload as object).sort()).toEqual(
      Object.keys(manualEvent!.payload as object).sort(),
    )
    const aiTxn = await db.transactions.get((aiEvent.payload as { transactionId: string }).transactionId)
    expect(aiTxn?.amount).toBe(88)
    expect(aiTxn?.summary).toBe('AI 记账')
  }, 30_000)

  it('①-b 经 relay 记沟通 vs 手工记沟通：customer:contacted 载荷键集一致', async () => {
    const customerId = 'cus-payload-e2e'
    await createCustomerWithInit(newCustomer(customerId, '载荷对照客户') as unknown as Customer, {})

    captured = []
    const preview = await mcp.callTool('crm_addInteraction', { customerId, content: 'AI 沟通' })
    await mcp.callTool('crm_addInteraction', { customerId, content: 'AI 沟通' }, previewToken(preview))
    await waitFor(
      () => captured.some((e) => e.event === 'customer:contacted'),
      3000,
      'AI 路径未发出 customer:contacted',
    )
    const aiEvent = captured.find((e) => e.event === 'customer:contacted')!

    captured = []
    await saveInteractionAndTouchCustomer(
      { id: 'itx-manual-e2e', customerId, content: '手工沟通', type: '电话', at: Date.now() } as never,
      customerId,
    )
    const manualEvent = captured.find((e) => e.event === 'customer:contacted')!

    expect(Object.keys(aiEvent.payload as object).sort()).toEqual(
      Object.keys(manualEvent.payload as object).sort(),
    )
    expect((aiEvent.payload as { customerId: string }).customerId).toBe(customerId)
  }, 30_000)

  /* ================= 补强断言 ②：编辑不得再触发 created ================= */

  it('② 编辑既有流水不再触发 transaction:created 且不新增记录', async () => {
    const ledgerId = await ensureLedger()
    const id = 'txn-edit-gate'
    await saveTransactionWithAttachments(
      {
        id,
        ledgerId,
        summary: '原始',
        amount: 10,
        type: 'expense',
        status: '待对账',
        occurredAt: Date.now(),
        tags: [],
      } as never,
      [],
    )
    const before = await db.transactions.count()

    captured = []
    await saveTransactionWithAttachments(
      {
        id,
        ledgerId,
        summary: '改后',
        amount: 20,
        type: 'expense',
        status: '已结算',
        occurredAt: Date.now(),
        tags: [],
      } as never,
      [],
    )
    expect(captured.filter((e) => e.event === 'transaction:created')).toHaveLength(0)
    expect(await db.transactions.count()).toBe(before)
    expect((await db.transactions.get(id))?.amount).toBe(20)
  })

  /* ============ 补强断言 ③-b：幂等语义可被 Agent 观察到 ============ */

  /* ========== 补强断言 ⑤：P2 动作扩面经真实 relay 全链路可达 ========== */

  it('⑤ P2 扩面动作经 relay 全链路可跑通（改档位 → 归档项目 → 记/改笔记 → 删待办）', async () => {
    /* 建客户（中风险，走 preview → confirm → execute） */
    const createArgs = { name: '赵六', company: '远山设计', tier: 'B' as const }
    const createPreview = await mcp.callTool('crm_createCustomer', createArgs)
    expect((createPreview.data as { preview?: boolean }).preview).toBe(true)
    const created = await mcp.callTool('crm_createCustomer', createArgs, previewToken(createPreview))
    expect(created.ok, created.text).toBe(true)
    const customerId = (created.data as { customerId: string }).customerId

    /* 编辑客户档案 + 设置健康分档位（medium） */
    const upArgs = { customerId, tier: 'S' as const, intimacyLevel: 'T2' as const }
    const upPreview = await mcp.callTool('crm_updateCustomer', upArgs)
    expect((upPreview.data as { preview?: boolean }).preview).toBe(true)
    const up = await mcp.callTool('crm_updateCustomer', upArgs, previewToken(upPreview))
    expect(up.ok, up.text).toBe(true)
    const after = await db.customers.get(customerId)
    expect(after!.tier).toBe('S')
    expect(after!.intimacy?.level).toBe('T2')

    /* 建项目（low，免预览）→ 挂到客户 → 归档 */
    const prj = await mcp.callTool('project_createProject', { name: '远山年度视觉', customerId })
    expect(prj.ok, prj.text).toBe(true)
    const projectId = (prj.data as { projectId: string }).projectId
    const archArgs = { projectId, status: 'archived' as const }
    const archPreview = await mcp.callTool('project_updateProject', archArgs)
    expect((archPreview.data as { preview?: boolean }).preview).toBe(true)
    const arch = await mcp.callTool('project_updateProject', archArgs, previewToken(archPreview))
    expect(arch.ok, arch.text).toBe(true)
    expect((await db.projects.get(projectId))!.status).toBe('archived')

    /* 建文件夹 → 建笔记 → 改归属（folderId: null 移出） */
    const folder = await mcp.callTool('note_createFolder', { name: '远山资料' })
    expect(folder.ok, folder.text).toBe(true)
    const folderId = (folder.data as { folderId: string }).folderId
    const noteArgs = { title: '远山需求要点', markdown: '# 要点', folderId, projectId }
    const note = await mcp.callTool('note_createNote', noteArgs)
    expect(note.ok, note.text).toBe(true)
    const noteId = (note.data as { noteId: string }).noteId
    const noteUpArgs = { noteId, folderId: null, title: '远山需求要点（终稿）' }
    const noteUpPreview = await mcp.callTool('note_updateNote', noteUpArgs)
    expect((noteUpPreview.data as { preview?: boolean }).preview).toBe(true)
    const noteUp = await mcp.callTool('note_updateNote', noteUpArgs, previewToken(noteUpPreview))
    expect(noteUp.ok, noteUp.text).toBe(true)
    const noteRow = await db.notes.get(noteId)
    expect(noteRow!.folderId).toBeUndefined()
    expect(noteRow!.title).toBe('远山需求要点（终稿）')

    /* 读工具：listNotes 不下发正文；listProjects 能查到归档项目 */
    const notes = await mcp.callTool('listNotes', {})
    expect(notes.ok, notes.text).toBe(true)
    const noteItems = (notes.data as ReadEnvelope<{ markdown?: string; markdownLength?: number }>).items
    expect(noteItems.every((n) => n.markdown === undefined)).toBe(true)
    const projects = await mcp.callTool('listProjects', { status: 'archived' })
    expect((projects.data as ReadEnvelope<{ id: string }>).items.some((p) => p.id === projectId)).toBe(true)

    /* 删除待办（high 风险：预览须标 irreversible，且未确认不落库） */
    const tid = 'td-e2e-del'
    await db.todos.put({
      id: tid,
      title: '临时想法',
      desc: '',
      priority: 'mid',
      status: 'todo',
      createdAt: Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as never)
    const delPreview = await mcp.callTool('todo_deleteTodo', { todoId: tid })
    const delData = delPreview.data as { preview?: boolean; irreversible?: boolean }
    expect(delData.preview).toBe(true)
    expect(delData.irreversible).toBe(true)
    expect((await db.todos.get(tid))!.deleted).toBe(0)
    const del = await mcp.callTool('todo_deleteTodo', { todoId: tid }, previewToken(delPreview))
    expect(del.ok, del.text).toBe(true)
    expect((await db.todos.get(tid))!.deleted).toBe(1)
  }, 60_000)

  it('③-b habit_checkin 幂等：重复调用 created=false 且不重复 emit', async () => {
    const habitId = 'habit-e2e'
    await db.habits.put({
      id: habitId,
      name: '晨跑',
      icon: 'directions_run',
      color: '#111',
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

    captured = []
    const first = await mcp.callTool('habit_checkin', { habitId, date: '2026-09-10' })
    const second = await mcp.callTool('habit_checkin', { habitId, date: '2026-09-10' })
    expect(first.ok, first.text).toBe(true)
    expect(second.ok, second.text).toBe(true)
    expect((first.data as { created: boolean }).created).toBe(true)
    expect((second.data as { created: boolean }).created).toBe(false)
    expect(first.data).toMatchObject({ habitId, date: '2026-09-10', checked: true })
    expect(captured.filter((e) => e.event === 'habit:checked')).toHaveLength(1)
  }, 30_000)
})

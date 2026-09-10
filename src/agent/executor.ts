import dayjs from 'dayjs'
import { z } from 'zod'
import { db } from '@/db/db'
import { newId } from '@/repositories'
import { eventBus } from '@/shared/eventBus'
import {
  saveTransactionWithAttachments,
  saveInteractionAndTouchCustomer,
  createCustomerWithInit,
  todoRepo,
  ledgerRepo,
} from '@/repositories'
import { toggleTodoDone } from '@/modules/todo/toggle'
import type { PutInput } from '@/repositories/repository'
import type { Ledger, Todo, Transaction, Customer } from '@/db/types'
import {
  recordTransactionSchema,
  createCustomerSchema,
  addInteractionSchema,
  createTodoSchema,
  completeTodoSchema,
  createLedgerSchema,
  addRelationSchema,
  TOOL_RISK,
  TOOL_EVENTS,
  SUNK_EVENTS,
  type AgentEventDeclaration,
} from './schema'

/**
 * agentOps 执行器 —— P1 第 1 步（方案 §9.7 第 1 步 / §2.1 事件声明表）
 *
 * 写操作单点收口：zod 校验 → 风险分级 → 落库（repositories 复合/原子函数）→
 * 事务 commit 后按事件声明表统一 emit。事件在此一处出口，与 UI 内联 emit 行为逐事件对齐。
 */

/** 执行结果 */
export interface AgentOpResult {
  ok: boolean
  /** 业务产物（新建/变更记录 id 等），供后续工具链与断言使用 */
  data?: Record<string, unknown>
  /** 可操作错误信息（如「请先创建账本」），禁止静默失败 */
  error?: string
}

type Ok = { ok: true; data: Record<string, unknown> }
const ok = (data: Record<string, unknown>): Ok => ({ ok: true, data })
const err = (error: string): AgentOpResult => ({ ok: false, error })

/** 解析失败 → 可操作错误（收集全部 issue，供 Agent 转述） */
function parseOrError<S extends z.ZodTypeAny>(schema: S, input: unknown):
  { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const r = schema.safeParse(input)
  if (r.success) return { ok: true, data: r.data }
  const msgs = r.error.issues.map((i) => i.message || `${i.path.join('.')}: 校验失败`)
  return { ok: false, error: msgs.join('；') }
}

/**
 * agentOps 层事务外统一事件出口（硬规则：永不在事务体内 emit）。
 *
 * 事件名**从 TOOL_EVENTS 声明表推导**，payload 由调用方构造：
 * 声明表是唯一事实源，若某工具在 TOOL_EVENTS 里没声明事件，这里一个都不会发；
 * 声明了但调用方没给对应 payload，则抛错（防「声明表与实际 emit 两条独立路径」的漂移）。
 *
 * **第 2 步下沉后**：已下沉 repositories 的事件（`SUNK_EVENTS`）不在本层发出——
 * 若调用方仍试图在此 emit，直接抛错（防双发漂移）。当前 P1 全部两个领域事件
 * （`transaction:created` / `customer:contacted`）均已下沉，故本函数在写工具路径上应零调用；
 * 保留它是为「未来新增的、未下沉的 agent 层事件」留出口，并持续做声明表校验。
 */
export function emitDeclared(tool: string, payloads: Record<string, AgentEventDeclaration['payload']>): void {
  const declared = TOOL_EVENTS[tool] ?? []
  for (const event of declared) {
    if (SUNK_EVENTS.has(event)) {
      throw new Error(`emitDeclared: 事件 ${event} 已下沉 repositories 层，agentOps 不得重复 emit`)
    }
    const payload = payloads[event]
    if (payload === undefined) {
      throw new Error(`emitDeclared: 工具 ${tool} 声明了事件 ${event} 但未提供 payload`)
    }
    eventBus.emit(event, payload)
  }
  // 调用方多给了未声明事件的 payload → 同样视为漂移，直接拒绝
  for (const event of Object.keys(payloads)) {
    if (!declared.includes(event as (typeof declared)[number])) {
      throw new Error(`emitDeclared: 工具 ${tool} 未声明事件 ${event}，禁止越表 emit`)
    }
  }
}

/** fin_recordTransaction：记一笔（§9.4 口径：status 默认待对账，channel 可缺省） */
export async function fin_recordTransaction(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(recordTransactionSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data

  // 账本必须真实存在（§9.3 D7：无账本/账本不存在 → 可操作错误，不静默落库）
  const ledger = await db.ledgers.get(d.ledgerId)
  if (!ledger || ledger.deleted) {
    return err('请先创建账本')
  }

  const id = newId('txn')
  const record: PutInput<Transaction> = {
    id,
    ledgerId: d.ledgerId,
    type: d.type,
    amount: d.amount,
    summary: d.summary,
    channel: d.channel ?? '',
    // 仅日期录入：统一落当天 00:00，与 UI 完全一致
    occurredAt: dayjs(d.occurredAt ?? dayjs().format('YYYY-MM-DD')).startOf('day').valueOf(),
    tags: d.tags,
    note: d.note,
    customerId: d.customerId,
    todoId: d.todoId,
    projectId: d.projectId,
    status: d.status,
  }
  // agentOps 首版不含 Blob 附件通道（外部 Agent 无法构造 Blob），附件走 UI 路径。
  // `transaction:created` 已下沉 saveTransactionWithAttachments（事务外、create 门控），此处不再 emit。
  const { created } = await saveTransactionWithAttachments(record, [])
  return ok({ transactionId: id, status: d.status, eventEmitted: created })
}

/** crm_createCustomer：建客户（含首联初始化，走下沉后的复合函数） */
export async function crm_createCustomer(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(createCustomerSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data

  const record: Customer = {
    id: newId('cus'),
    name: d.name,
    company: d.company ?? '',
    title: d.title ?? '',
    decisionLevel: d.decisionLevel,
    tier: d.tier,
    tags: d.tags,
    phone: d.phone ?? '',
    wechat: d.wechat ?? '',
    email: d.email ?? '',
    address: d.address ?? '',
    lastContactAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
  await createCustomerWithInit(record, {
    openingLog: d.openingLog,
    linkTransactionId: d.linkTransactionId,
  })
  return ok({ customerId: record.id })
}

/**
 * crm_addInteraction：记沟通日志（原子双写刷新 lastContactAt）。
 *
 * lastContactAt 口径（对齐 UI 现状，§9.4 同源原则）：
 * `saveInteractionAndTouchCustomer` 是**无条件** `lastContactAt = interaction.at`（非 max），
 * 而 UI 两个入口（CustomerDetailPage / ProjectDetailPage）都传 `Date.now()`，碰不到「打回过去」。
 * 外部 Agent 补录历史沟通时若传过去时间，会把 `lastContactAt` 打回过去 ——
 * 直接让「客户久未跟进提醒」（notifications.customerStaleAlert）永久静默。
 * 故工具层显式对齐 UI：**日志时间可回溯（at 原样落库），但不允许把 lastContactAt 拉回过去**。
 * 具体做法：at 早于当前 lastContactAt 时，客户侧仍用当前值（不倒退），日志本身保留真实时间。
 */
export async function crm_addInteraction(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(addInteractionSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data

  // 目标客户必须是消解后的真实 id（拒绝字符串关联的运行时兜底校验）
  const customer = await db.customers.get(d.customerId)
  if (!customer || customer.deleted) {
    return err(`客户不存在：${d.customerId}，请先 resolveEntity 消解`)
  }

  const at = d.at ?? Date.now()
  // 不让 lastContactAt 倒退：补录历史日志时保持客户最近联系时间不后退
  const touchAt = Math.max(customer.lastContactAt ?? 0, at)

  const id = newId('itx')
  await saveInteractionAndTouchCustomer(
    {
      id,
      customerId: d.customerId,
      type: d.type,
      content: d.content,
      at,
      projectId: d.projectId,
    },
    d.customerId,
    touchAt,
  )
  // `customer:contacted` 已下沉 saveInteractionAndTouchCustomer（事务外），此处不再 emit。
  return ok({ interactionId: id, at, lastContactAt: touchAt })
}

/** crm_addRelation：双向落两侧（v0.2 裁决：A/B 两侧 relations[] 各写一条） */
export async function crm_addRelation(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(addRelationSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data
  if (d.customerId === d.targetId) return err('不能与自身建立关系')

  const [a, b] = await Promise.all([
    db.customers.get(d.customerId),
    db.customers.get(d.targetId),
  ])
  if (!a || a.deleted) return err(`客户不存在：${d.customerId}`)
  if (!b || b.deleted) return err(`目标客户不存在：${d.targetId}`)

  const now = Date.now()
  const relId = newId('rel')
  // 同 目标+语义 判重（UI 同款纪律，Issue #39）
  const aRels = a.relations ?? []
  if (aRels.some((r) => r.targetId === d.targetId && r.label === d.label)) {
    return ok({ relationId: aRels.find((r) => r.targetId === d.targetId && r.label === d.label)!.id, deduped: true })
  }

  const bRels = b.relations ?? []
  await db.transaction('rw', [db.customers, db.syncQueue], async () => {
    // A 侧：正向语义（张三是李四的转介绍人 → A 的 relations 写「李四 / 转介绍人」）
    await db.customers.update(a.id, {
      relations: [...aRels, { id: relId, targetId: d.targetId, label: d.label, ...(d.category ? { category: d.category } : {}) }],
      updatedAt: now,
      rev: a.rev + 1,
    })
    await db.syncQueue.add({ table: 'customers', recordId: a.id, op: 'upsert', createdAt: now })
    // B 侧：双向落两侧，B 侧也可见该关系
    await db.customers.update(b.id, {
      relations: [...bRels, { id: newId('rel'), targetId: a.id, label: d.label, ...(d.category ? { category: d.category } : {}) }],
      updatedAt: now,
      rev: b.rev + 1,
    })
    await db.syncQueue.add({ table: 'customers', recordId: b.id, op: 'upsert', createdAt: now })
  })
  return ok({ relationId: relId })
}

/** todo_createTodo：建待办 */
export async function todo_createTodo(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(createTodoSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data

  const id = newId('td')
  const record: Todo = {
    id,
    title: d.title,
    desc: d.desc,
    priority: d.priority,
    status: 'todo',
    dueAt: d.dueAt,
    customerId: d.customerId,
    listId: d.listId,
    projectId: d.projectId,
    createdAt: Date.now(),
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
  await todoRepo.put(record)
  return ok({ todoId: id })
}

/**
 * todo_completeTodo：完成态切换，唯一落库入口 toggleTodoDone（§9.3 D6，status + completedAt 成对写）。
 *
 * 幂等口径（P1 复审 ⑥）：**入参态已等于目标态时直接返回，不落库**。
 * - 不幂等会推进 `completedAt`（「今日已完成」统计与 CRM 时间轴的唯一依据）并多入一条同步队列；
 * - 外部 Agent 重试同一请求（超时重发、链路重放）是常态，必须挡住；
 * - UI 侧 `toggle(t)` 传列表里的实时记录，语义是「点一下切换」，与工具层「声明目标态」不同：
 *   工具层是**目标态语义**（done=true 即要求它处于已完成），已达态即无操作。
 */
export async function todo_completeTodo(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(completeTodoSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data

  const todo = await db.todos.get(d.todoId)
  if (!todo || todo.deleted) return err(`待办不存在：${d.todoId}`)

  // 转换当前态 → 目标态；已完成态（含 completedAt 已盖）保持不动
  const targetStatus = d.done ? 'done' : 'todo'
  const already = todo.status === targetStatus
  if (already) {
    return ok({ todoId: d.todoId, status: todo.status, changed: false })
  }
  // toggleTodoDone 从「入参记录的当前态」取反，故把入参摆到目标态的反面，toggle 后恰为目标态
  const asInput: Todo = {
    ...todo,
    status: d.done ? 'todo' : 'done',
    completedAt: d.done ? undefined : todo.completedAt,
  }
  const next = await toggleTodoDone(asInput)
  return ok({ todoId: d.todoId, status: next.status, changed: true })
}

/** fin_createLedger：建账本（isDefault 全局唯一纪律与 UI 一致） */
export async function fin_createLedger(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(createLedgerSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data

  const id = newId('ldg')
  if (d.isDefault) {
    const others = (await db.ledgers.toArray()).filter((l) => !l.deleted && l.isDefault)
    for (const l of others) {
      const { isDefault: _drop, ...rest } = l
      await ledgerRepo.put({ ...rest })
    }
  }
  const record: PutInput<Ledger> = {
    id,
    name: d.name,
    currency: d.currency,
    openingBalance: d.openingBalance,
    closingCycle: d.closingCycle,
    sortOrder: (await db.ledgers.toArray()).filter((l) => !l.deleted).length,
    createdAt: Date.now(),
    ...(d.isDefault ? { isDefault: true } : {}),
  }
  await ledgerRepo.put(record)
  return ok({ ledgerId: id })
}

/** 工具注册表：桥与测试统一从这里取（域前缀命名，§2.3） */
export const AGENT_TOOLS = {
  'fin_recordTransaction': { risk: TOOL_RISK['fin_recordTransaction'], schema: recordTransactionSchema, run: fin_recordTransaction },
  'crm_createCustomer': { risk: TOOL_RISK['crm_createCustomer'], schema: createCustomerSchema, run: crm_createCustomer },
  'crm_addInteraction': { risk: TOOL_RISK['crm_addInteraction'], schema: addInteractionSchema, run: crm_addInteraction },
  'crm_addRelation': { risk: TOOL_RISK['crm_addRelation'], schema: addRelationSchema, run: crm_addRelation },
  'todo_createTodo': { risk: TOOL_RISK['todo_createTodo'], schema: createTodoSchema, run: todo_createTodo },
  'todo_completeTodo': { risk: TOOL_RISK['todo_completeTodo'], schema: completeTodoSchema, run: todo_completeTodo },
  'fin_createLedger': { risk: TOOL_RISK['fin_createLedger'], schema: createLedgerSchema, run: fin_createLedger },
} as const

// 防再犯断言（P1 复审 ①）：注册表每项 risk 必须是 low/medium 字面量。
// 若哪次改动又把整张 TOOL_RISK map 当 risk 赋值，这里会立刻在类型/运行时炸出来。
for (const [name, tool] of Object.entries(AGENT_TOOLS)) {
  if (tool.risk !== 'low' && tool.risk !== 'medium') {
    throw new Error(`AGENT_TOOLS['${name}'].risk 非法：${String(tool.risk)}（必须是 low/medium 字面量，检查是否误把 TOOL_RISK 整表当 risk）`)
  }
}

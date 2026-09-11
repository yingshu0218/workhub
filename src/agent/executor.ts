import dayjs from 'dayjs'
import { z } from 'zod'
import { db } from '@/db/db'
import { newId } from '@/repositories'
import { eventBus } from '@/shared/eventBus'
import {
  saveInteractionAndTouchCustomer,
  createCustomerWithInit,
  checkinHabit,
  uncheckHabit,
  deleteHabitCascade,
  addCustomerRelation,
  todoRepo,
} from '@/repositories'
import { toggleTodoDone } from '@/modules/todo/toggle'
import { splitTodoText } from '@/modules/todo/title'
import { deleteTodoCascade } from '@/modules/todo/hooks'
import type { Customer, Habit, Note, NoteFolder, Project, Todo } from '@/db/types'

/** 行类型别名（mustExist 泛型绑定用；与 db/types 定义同源，不做二次建模） */
type ProjectRow = Project
type NoteRow = Note
type FolderRow = NoteFolder
type HabitRow = Habit
import { resolveEntity, type ResolveResult } from './resolver'
import { createLedger, recordTransaction } from '@/domain'
import {
  checkinHabitSchema,
  recordTransactionSchema,
  resolveEntitySchema,
  TOOL_DOMAIN,
  DEFAULT_AI_DOMAINS,
  createCustomerSchema,
  addInteractionSchema,
  createTodoSchema,
  completeTodoSchema,
  createLedgerSchema,
  addRelationSchema,
  updateTodoSchema,
  deleteTodoSchema,
  updateCustomerSchema,
  createProjectSchema,
  updateProjectSchema,
  createNoteSchema,
  updateNoteSchema,
  createFolderSchema,
  deleteHabitSchema,
  TOOL_RISK,
  TOOL_EVENTS,
  type RiskLevel,
  SUNK_EVENTS,
  type AgentEventDeclaration,
} from './schema'
import {
  listTransactions,
  getCustomer,
  listTodos,
  listLedgers,
  listHabits,
  listProjects,
  listNotes,
  listNoteFolders,
  searchEntities,
  listTransactionsSchema,
  getCustomerSchema,
  listTodosSchema,
  listLedgersSchema,
  listHabitsSchema,
  listProjectsSchema,
  listNotesSchema,
  listNoteFoldersSchema,
  searchEntitiesSchema,
  type ReadResult,
} from './reads'

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

/**
 * fin_recordTransaction：记一笔（§9.4 口径：status 默认待对账，channel 可缺省）。
 *
 * 落库经**领域命令层** `@/domain` 的 `recordTransaction`——与 UI `TransactionFormDrawer.save()`
 * 共用同一份「记账时间口径（落当天 00:00）/ 缺省账本策略 / 字段归一」，杜绝 UI 与 AI 两份内联漂移。
 * 事件 `transaction:created` 仍由 `saveTransactionWithAttachments` 在事务 commit 后、仅新建时发出。
 * agentOps 首版不含 Blob 附件通道（外部 Agent 无法构造 Blob），附件走 UI 路径。
 */
/** 关联字段归一：单值 + 数组 + 旧键别名 → 去重非空数组（Issue #140） */
function linkIds(arr: unknown, legacy: unknown): string[] {
  const norm = (v: unknown): string[] => {
    if (typeof v === 'string') return v ? [v] : []
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && !!x)
    return []
  }
  return [...new Set([...norm(arr), ...norm(legacy)])]
}

export async function fin_recordTransaction(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(recordTransactionSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data
  // schema 的兼容别名（旧键名 customerId…）不在 z.infer 的显式类型里，单独取原始对象读
  const rec = d as unknown as Record<string, unknown>

  const r = await recordTransaction({
    summary: d.summary,
    amount: d.amount,
    type: d.type,
    ledgerId: d.ledgerId,
    occurredAt: d.occurredAt,
    channel: d.channel,
    status: d.status,
    tags: d.tags,
    note: d.note,
    // 多关联归一（Issue #140）：单值/数组/旧键别名都收，去重后落库
    customerIds: linkIds(rec.customerIds, rec.customerId),
    todoIds: linkIds(rec.todoIds, rec.todoId),
    projectIds: linkIds(rec.projectIds, rec.projectId),
  })
  if (!r.ok) return err(r.error)
  return ok({
    transactionId: r.transactionId,
    status: d.status,
    ledgerId: r.ledgerId,
    occurredAt: r.occurredAt,
    eventEmitted: r.created,
  })
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

  // 收口到 repositories 领域函数（单一来源）——此前本函数手写 update + syncQueue.add，
  // 与 UI 的 customerRepo.put 形成两套盖章/入队实现，且**漏了 syncEngine.requestSync()**，
  // 只能等 30s 心跳才推送。现在 UI 与 agentOps 走同一实现。
  try {
    const { relationId, deduped } = await addCustomerRelation(
      d.customerId,
      d.targetId,
      d.label,
      d.category,
    )
    return ok({ relationId, deduped })
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('不能与自身')) return err('不能与自身建立关系')
    if (msg.includes('not found')) return err('客户不存在：请先用 resolveEntity 确认双方客户')
    throw e
  }
}

/**
 * todo_createTodo：建待办。
 *
 * 正文口径（Issue #148 后续）：schema 已把 `content` / `title` / `desc` 折成单一正文并
 * 走 `splitTodoText` 推导标题 —— 与 UI 表单、速记转待办共用同一实现，
 * 保证「谁建的待办」都满足 `title = 正文首行` 这条隐含约束（消除 UI 打开保存被静默归一化）。
 */
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

  // 建账本经领域命令层：与 UI LedgerFormDrawer 共用「默认账本全局唯一 + 排序位」口径
  const id = await createLedger({
    name: d.name,
    currency: d.currency,
    openingBalance: d.openingBalance,
    closingCycle: d.closingCycle,
    isDefault: d.isDefault,
  })
  return ok({ ledgerId: id })
}

/**
 * habit_checkin：习惯打卡 / 取消（§9.6.1 收口后的领域命令）。
 *
 * 幂等口径：`checkinHabit` 只在**实际新建**时才 emit `habit:checked`（已下沉 repositories，事务 commit 后）；
 * 重复调用返回 `{ created: false }`，外部 Agent 重试安全。`undo: true` 走 `uncheckHabit`（软删、不 emit）。
 */
export async function habit_checkin(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(checkinHabitSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data

  const habit = await db.habits.get(d.habitId)
  if (!habit || habit.deleted) {
    return err(`习惯不存在：${d.habitId}，请先 resolveEntity 消解`)
  }
  const date = d.date ?? dayjs().format('YYYY-MM-DD')
  if (d.undo) {
    await uncheckHabit(d.habitId, date)
    return ok({ habitId: d.habitId, date, checked: false })
  }
  const { created } = await checkinHabit(d.habitId, date)
  return ok({ habitId: d.habitId, date, checked: true, created })
}

/* ─────────────── P2 动作扩面：编辑 / 删除 / 项目 / 笔记 ─────────────── *
 * 纪律（与 P1 写工具同源）：
 * - 落库一律走已有 repository / 级联函数，不新增删除逻辑；
 * - 不新增领域事件（UI 同入口也不发）；
 * - 目标记录不存在 / 已删 → 可操作错误，不静默成功；
 * - delete 类为 `high` 风险：返回 `sideEffects` 清单（受影响记录数），供 Agent 转述用户。
 * ----------------------------------------------------------------------- */

/** 目标记录存在性兜底：不存在/已删一律可操作错误（禁止对幽灵记录"成功"） */
async function mustExist<T extends { id: string; deleted?: 0 | 1 }>(
  table: { get(id: string): Promise<T | undefined> },
  id: string,
  what: string,
): Promise<{ ok: true; record: NonNullable<Awaited<ReturnType<typeof table.get>>> } | { ok: false; error: string }> {
  const record = await table.get(id)
  if (!record || record.deleted) return { ok: false, error: `${what}不存在：${id}，请先 resolveEntity 消解` }
  return { ok: true, record: record as NonNullable<Awaited<ReturnType<typeof table.get>>> }
}

/** 把 nullable 入参折算成「未传 / 传 null（清空） / 传值（设置）」三态 */
function triState<T>(v: T | null | undefined): { touched: boolean; value: T | undefined } {
  if (v === undefined) return { touched: false, value: undefined }
  return { touched: true, value: v === null ? undefined : v }
}

/**
 * todo_updateTodo 的正文补丁计算（Issue #148 后续 · 标题/正文口径收口）。
 *
 * 返回 `undefined` 表示本次不动正文；返回对象里的字段才会进 patch
 * （`title` 单独传时不动 `desc`，`desc` 单独传时不动 `title`）。
 */
function subjectPatch(d: {
  content?: string
  title?: string
  desc?: string
}): { title?: string; desc?: string } | undefined {
  if (d.content !== undefined) return splitTodoText(d.content)
  if (d.title !== undefined && d.desc !== undefined) return splitTodoText(`${d.title}\n${d.desc}`)
  if (d.title !== undefined) return { title: d.title }
  if (d.desc !== undefined) return { desc: d.desc }
  return undefined
}

/** todo_updateTodo：编辑待办（不含完成态，完成态唯一入口仍是 todo_completeTodo） */
export async function todo_updateTodo(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(updateTodoSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data
  const found = await mustExist<Todo>(db.todos, d.todoId, '待办')
  if (!found.ok) return err(found.error)
  const prev = found.record

  const patch: Partial<Todo> = {}
  // 正文口径（Issue #148 后续）：与 UI 表单同源。
  // - 传 `content` = 整体替换正文，标题由首行推导（把旧 title/desc 都覆盖掉）；
  // - 只传 `title` = 只改标题（备注保持）；
  // - 只传 `desc` = 只改备注（标题保持）；
  // - `title` + `desc` 同时传 = 整体替换（合并后重新推导，与 create 同口径）。
  const subject = subjectPatch(d)
  if (subject) {
    if (subject.title !== undefined) patch.title = subject.title
    if (subject.desc !== undefined) patch.desc = subject.desc
  }
  if (d.priority !== undefined) patch.priority = d.priority
  const dueAt = triState(d.dueAt)
  if (dueAt.touched) patch.dueAt = dueAt.value
  const customerId = triState(d.customerId)
  if (customerId.touched) patch.customerId = customerId.value
  const projectId = triState(d.projectId)
  if (projectId.touched) patch.projectId = projectId.value
  const listId = triState(d.listId)
  if (listId.touched) patch.listId = listId.value

  // 弱引用校验：关联对象必须存在（拒绝挂到已删客户/项目上，避免图里出现悬挂边）
  if (patch.customerId) {
    const c = await mustExist<Customer>(db.customers, patch.customerId, '客户')
    if (!c.ok) return err(c.error)
  }
  if (patch.projectId) {
    const p = await mustExist<ProjectRow>(db.projects, patch.projectId, '项目')
    if (!p.ok) return err(p.error)
  }

  await todoRepo.put({ ...prev, ...patch })
  return ok({ todoId: d.todoId, updated: Object.keys(patch) })
}

/**
 * todo_deleteTodo：删除待办。
 *
 * 级联口径（Issue #148 后续 · #140 审计留档项收口）：走 `deleteTodoCascade`
 * （= UI 删除入口同一实现），软删待办的同时解绑 `transactions.todoIds` 的悬挂引用。
 * 此前只软删待办、悬挂 id 靠读取端过滤兜底 —— 界面不炸，但按 todoIds 直查的路径
 * （导出/统计/Agent 读投影）会命中幽灵引用。解绑条数经 `sideEffects.unlinked` 回传，
 * 供 Agent 向用户如实转述副作用。
 */
export async function todo_deleteTodo(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(deleteTodoSchema, input)
  if (!parsed.ok) return parsed
  const found = await mustExist<Todo>(db.todos, parsed.data.todoId, '待办')
  if (!found.ok) return err(found.error)
  const unlinked = await deleteTodoCascade(parsed.data.todoId)
  return ok({
    todoId: parsed.data.todoId,
    deleted: true,
    // 待办本身不级联删除别的实体（不做软删扩散），只解绑流水上的弱引用
    sideEffects: { cascaded: 0, unlinked },
  })
}

/** crm_updateCustomer：编辑客户档案（含关系档位；relations 仍走 crm_addRelation） */
export async function crm_updateCustomer(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(updateCustomerSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data
  const found = await mustExist<Customer>(db.customers, d.customerId, '客户')
  if (!found.ok) return err(found.error)
  const prev = found.record

  const patch: Partial<Customer> = {}
  for (const k of ['name', 'company', 'title', 'decisionLevel', 'tier', 'tags', 'phone', 'wechat', 'email', 'address'] as const) {
    if (d[k] !== undefined) (patch as Record<string, unknown>)[k] = d[k]
  }
  // 关系档位：显式 null = 清除手动档位（交算法兜底，Issue #108 单一来源口径）
  if (d.intimacyLevel !== undefined) {
    patch.intimacy =
      d.intimacyLevel === null
        ? undefined
        : { level: d.intimacyLevel, updatedAt: Date.now() }
  }

  const { customerRepo } = await import('@/repositories')
  const { intimacy: _dropIntimacy, ...rest } = prev
  await customerRepo.put({
    ...rest,
    ...patch,
    ...(patch.intimacy ? { intimacy: patch.intimacy } : {}),
  } as Customer)
  return ok({ customerId: d.customerId, updated: Object.keys(patch) })
}

/** project_createProject：建项目（默认 active） */
export async function project_createProject(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(createProjectSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data
  if (d.customerId) {
    const c = await mustExist<Customer>(db.customers, d.customerId, '客户')
    if (!c.ok) return err(c.error)
  }
  const { projectRepo, newId } = await import('@/repositories')
  const id = newId('prj')
  await projectRepo.put({
    id,
    name: d.name,
    color: d.color ?? '#004AC6',
    status: d.status,
    customerId: d.customerId,
    budget: d.budget,
    note: d.note,
    createdAt: Date.now(),
  })
  return ok({ projectId: id, status: d.status })
}

/** project_updateProject：编辑项目（归档 / 搁置 / 改名 / 换挂靠客户） */
export async function project_updateProject(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(updateProjectSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data
  const found = await mustExist<ProjectRow>(db.projects, d.projectId, '项目')
  if (!found.ok) return err(found.error)
  const prev = found.record

  const patch: Record<string, unknown> = {}
  for (const k of ['name', 'status', 'color', 'note'] as const) {
    if (d[k] !== undefined) patch[k] = d[k]
  }
  const customerId = triState(d.customerId)
  if (customerId.touched) {
    if (customerId.value) {
      const c = await mustExist<Customer>(db.customers, customerId.value, '客户')
      if (!c.ok) return err(c.error)
    }
    patch.customerId = customerId.value
  }
  const budget = triState(d.budget)
  if (budget.touched) patch.budget = budget.value

  const { projectRepo } = await import('@/repositories')
  await projectRepo.put({ ...prev, ...patch })
  return ok({ projectId: d.projectId, updated: Object.keys(patch) })
}

/** note_createNote：建笔记 */
export async function note_createNote(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(createNoteSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data
  if (d.folderId) {
    const f = await mustExist<FolderRow>(db.noteFolders, d.folderId, '笔记文件夹')
    if (!f.ok) return err(f.error)
  }
  if (d.projectId) {
    const p = await mustExist<ProjectRow>(db.projects, d.projectId, '项目')
    if (!p.ok) return err(p.error)
  }
  const { noteRepo, newId } = await import('@/repositories')
  const id = newId('note')
  await noteRepo.put({
    id,
    title: d.title,
    markdown: d.markdown,
    tags: d.tags,
    // @提及 / 反向链接由编辑器解析：工具层不臆造（外部 Agent 无解析上下文），保持空数组
    backlinks: [],
    mentions: [],
    folderId: d.folderId,
    projectId: d.projectId,
    createdAt: Date.now(),
  })
  return ok({ noteId: id })
}

/** note_updateNote：编辑笔记（改标题 / 正文 / 标签 / 归属） */
export async function note_updateNote(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(updateNoteSchema, input)
  if (!parsed.ok) return parsed
  const d = parsed.data
  const found = await mustExist<NoteRow>(db.notes, d.noteId, '笔记')
  if (!found.ok) return err(found.error)
  const prev = found.record

  const patch: Record<string, unknown> = {}
  for (const k of ['title', 'markdown', 'tags'] as const) {
    if (d[k] !== undefined) patch[k] = d[k]
  }
  const folderId = triState(d.folderId)
  if (folderId.touched) {
    if (folderId.value) {
      const f = await mustExist<FolderRow>(db.noteFolders, folderId.value, '笔记文件夹')
      if (!f.ok) return err(f.error)
    }
    patch.folderId = folderId.value
  }
  const projectId = triState(d.projectId)
  if (projectId.touched) {
    if (projectId.value) {
      const p = await mustExist<ProjectRow>(db.projects, projectId.value, '项目')
      if (!p.ok) return err(p.error)
    }
    patch.projectId = projectId.value
  }

  const { noteRepo } = await import('@/repositories')
  await noteRepo.put({ ...prev, ...patch })
  return ok({ noteId: d.noteId, updated: Object.keys(patch) })
}

/** note_createFolder：建笔记文件夹（单层平铺） */
export async function note_createFolder(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(createFolderSchema, input)
  if (!parsed.ok) return parsed
  const { noteFolderRepo, newId } = await import('@/repositories')
  const id = newId('nf')
  await noteFolderRepo.put({ id, name: parsed.data.name, createdAt: Date.now() })
  return ok({ folderId: id })
}

/** habit_deleteHabit：删除习惯（走 deleteHabitCascade，级联清日志） */
export async function habit_deleteHabit(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(deleteHabitSchema, input)
  if (!parsed.ok) return parsed
  const habitId = parsed.data.habitId
  const found = await mustExist<HabitRow>(db.habits, habitId, '习惯')
  if (!found.ok) return err(found.error)
  const logs = (await db.habitLogs.where('habitId').equals(habitId).toArray()).filter(
    (l) => !l.deleted,
  )
  await deleteHabitCascade(habitId)
  return ok({
    habitId,
    deleted: true,
    // high 风险：副作用清单（级联影响的打卡记录数）供 Agent 转述用户
    sideEffects: { cascadedHabitLogs: logs.length },
  })
}

/* ------------------------------- 读工具出口 ------------------------------- *
 * 读工具**不产领域事件**（§2.2），故不进 TOOL_EVENTS / emitDeclared；
 * 参数经 schema 校验（parseOrError 统一可操作错误），异常统一转 `ok/err` 信封。
 * 投影白名单与条数上限在 `reads.ts` 落实，本层只做校验 + 信封包装。
 * ------------------------------------------------------------------------- */

/** 包装读工具：schema 校验 → 返回 items/count/truncated 信封 */
async function wrapRead<S extends z.ZodTypeAny>(
  schema: S,
  fn: (input: z.output<S>) => Promise<ReadResult>,
  input: unknown,
): Promise<AgentOpResult> {
  const parsed = parseOrError(schema, input ?? {})
  if (!parsed.ok) return parsed
  const r = await fn(parsed.data)
  return ok({ items: r.items, count: r.count, truncated: r.truncated })
}

/** searchEntities：跨实体检索（6 实体投影，notes 走字段裁剪） */
export function agent_searchEntities(input: unknown): Promise<AgentOpResult> {
  return wrapRead(searchEntitiesSchema, searchEntities, input)
}

/** getCustomer：单客户档案（不含 relations 全量与附件） */
export function agent_getCustomer(input: unknown): Promise<AgentOpResult> {
  return wrapRead(getCustomerSchema, getCustomer, input)
}

/** listTransactions：账目查询（投影白名单 + 上限 50） */
export function agent_listTransactions(input: unknown): Promise<AgentOpResult> {
  return wrapRead(listTransactionsSchema, listTransactions, input)
}

/** listTodos：待办查询 */
export function agent_listTodos(input: unknown): Promise<AgentOpResult> {
  return wrapRead(listTodosSchema, listTodos, input)
}

/** listLedgers：账本清单 */
export function agent_listLedgers(input: unknown): Promise<AgentOpResult> {
  return wrapRead(listLedgersSchema, listLedgers, input)
}

/** listHabits：习惯清单 */
export function agent_listHabits(input: unknown): Promise<AgentOpResult> {
  return wrapRead(z.object({}).strict(), listHabits, input)
}

/** listProjects：项目清单（P2 动作扩面） */
export function agent_listProjects(input: unknown): Promise<AgentOpResult> {
  return wrapRead(listProjectsSchema, listProjects, input)
}

/** listNotes：笔记清单（不含 markdown 正文） */
export function agent_listNotes(input: unknown): Promise<AgentOpResult> {
  return wrapRead(listNotesSchema, listNotes, input)
}

/** listNoteFolders：笔记文件夹清单 */
export function agent_listNoteFolders(input: unknown): Promise<AgentOpResult> {
  return wrapRead(listNoteFoldersSchema, listNoteFolders, input)
}

/** resolveEntity：读工具入口（薄包装，实现在 resolver.ts 保持可独立测试） */
export async function agent_resolveEntity(input: unknown): Promise<AgentOpResult> {
  const parsed = parseOrError(resolveEntitySchema, input)
  if (!parsed.ok) return parsed
  const r = await resolveEntity(parsed.data.query, parsed.data.type)
  return ok({ ...r } as unknown as Record<string, unknown>)
}

export type { ResolveResult }

/**
 * 统一调度入口（桥唯一调用面）：先过白名单闸门，再按工具名分发。
 * 白名单外的工具不执行（即使调用方直接点名）——闸门不含任何来源判断。
 */
export async function dispatchAgentTool(
  name: string,
  input: unknown,
  domains?: Partial<Record<string, boolean>>,
): Promise<AgentOpResult> {
  const tool = AGENT_TOOLS[name as keyof typeof AGENT_TOOLS]
  // 顺序有意为之：先判「是否注册」再判「是否在白名单内」。
  // 若先判白名单，未注册工具会得到「不在白名单内（域：未知）」这种**误导性**错误，
  // 外部 Agent 会以为是自己权限不够而反复重试，而真实原因是工具名不存在（多为模型幻觉）。
  if (!tool) {
    return err(`未知工具：${name}。当前可用工具：${visibleToolNames(domains).join(', ')}`)
  }
  if (!isToolAllowed(name, domains)) {
    return err(`工具 ${name} 不在能力白名单内（域：${TOOL_DOMAIN[name] ?? '未知'}），已被拒绝`)
  }
  return tool.run(input)
}

/** 工具注册表：桥与测试统一从这里取（域前缀命名，§2.3） */
export const AGENT_TOOLS = {
  'fin_recordTransaction': { risk: TOOL_RISK['fin_recordTransaction'], schema: recordTransactionSchema, run: fin_recordTransaction },
  'crm_createCustomer': { risk: TOOL_RISK['crm_createCustomer'], schema: createCustomerSchema, run: crm_createCustomer },
  'crm_addInteraction': { risk: TOOL_RISK['crm_addInteraction'], schema: addInteractionSchema, run: crm_addInteraction },
  'crm_addRelation': { risk: TOOL_RISK['crm_addRelation'], schema: addRelationSchema, run: crm_addRelation },
  'todo_createTodo': { risk: TOOL_RISK['todo_createTodo'], schema: createTodoSchema, run: todo_createTodo },
  'todo_completeTodo': { risk: TOOL_RISK['todo_completeTodo'], schema: completeTodoSchema, run: todo_completeTodo },
  'habit_checkin': { risk: TOOL_RISK['habit_checkin'], schema: checkinHabitSchema, run: habit_checkin },
  'fin_createLedger': { risk: TOOL_RISK['fin_createLedger'], schema: createLedgerSchema, run: fin_createLedger },
  // ── P2 动作扩面：编辑 / 删除 / 项目 / 笔记 ──
  'todo_updateTodo': { risk: TOOL_RISK['todo_updateTodo'], schema: updateTodoSchema, run: todo_updateTodo },
  'todo_deleteTodo': { risk: TOOL_RISK['todo_deleteTodo'], schema: deleteTodoSchema, run: todo_deleteTodo },
  'crm_updateCustomer': { risk: TOOL_RISK['crm_updateCustomer'], schema: updateCustomerSchema, run: crm_updateCustomer },
  'project_createProject': { risk: TOOL_RISK['project_createProject'], schema: createProjectSchema, run: project_createProject },
  'project_updateProject': { risk: TOOL_RISK['project_updateProject'], schema: updateProjectSchema, run: project_updateProject },
  'note_createNote': { risk: TOOL_RISK['note_createNote'], schema: createNoteSchema, run: note_createNote },
  'note_updateNote': { risk: TOOL_RISK['note_updateNote'], schema: updateNoteSchema, run: note_updateNote },
  'note_createFolder': { risk: TOOL_RISK['note_createFolder'], schema: createFolderSchema, run: note_createFolder },
  'habit_deleteHabit': { risk: TOOL_RISK['habit_deleteHabit'], schema: deleteHabitSchema, run: habit_deleteHabit },
  'resolveEntity': { risk: TOOL_RISK['resolveEntity'], schema: resolveEntitySchema, run: agent_resolveEntity },
  'searchEntities': { risk: TOOL_RISK['searchEntities'], schema: searchEntitiesSchema, run: agent_searchEntities },
  'getCustomer': { risk: TOOL_RISK['getCustomer'], schema: getCustomerSchema, run: agent_getCustomer },
  'listTransactions': { risk: TOOL_RISK['listTransactions'], schema: listTransactionsSchema, run: agent_listTransactions },
  'listTodos': { risk: TOOL_RISK['listTodos'], schema: listTodosSchema, run: agent_listTodos },
  'listLedgers': { risk: TOOL_RISK['listLedgers'], schema: listLedgersSchema, run: agent_listLedgers },
  'listHabits': { risk: TOOL_RISK['listHabits'], schema: listHabitsSchema, run: agent_listHabits },
  'listProjects': { risk: TOOL_RISK['listProjects'], schema: listProjectsSchema, run: agent_listProjects },
  'listNotes': { risk: TOOL_RISK['listNotes'], schema: listNotesSchema, run: agent_listNotes },
  'listNoteFolders': { risk: TOOL_RISK['listNoteFolders'], schema: listNoteFoldersSchema, run: agent_listNoteFolders },
} as const

/**
 * 能力白名单过滤（§四.3）：白名单关闭的域，工具**对桥不可见**——
 * 不是「调用时拒绝」，而是 tools 清单里就不出现。
 * 白名单事实源是 settings `ai.domains`（本地 singleton，不进同步队列）。
 */
export function visibleToolNames(domains?: Partial<Record<string, boolean>>): string[] {
  return Object.keys(AGENT_TOOLS).filter((name) => {
    const domain = TOOL_DOMAIN[name]
    if (!domain) return false
    const enabled = domains?.[domain] ?? DEFAULT_AI_DOMAINS[domain]
    return enabled
  })
}

/** 白名单内工具清单（供桥的 tools/list 使用；含风险级与幂等语义标注，§2.3） */
export function listVisibleTools(domains?: Partial<Record<string, boolean>>) {
  return visibleToolNames(domains).map((name) => {
    const tool = AGENT_TOOLS[name as keyof typeof AGENT_TOOLS]
    return { name, risk: tool.risk, domain: TOOL_DOMAIN[name] }
  })
}

/** 调用前白名单闸门：白名单外工具一律拒绝，且不区分调用来源（§十.4 验收） */
export function isToolAllowed(name: string, domains?: Partial<Record<string, boolean>>): boolean {
  return visibleToolNames(domains).includes(name)
}

// 防再犯断言（P1 复审 ①，P2 扩面后扩展为三档）：
// 注册表每项 risk 必须是 low/medium/high 字面量。若哪次改动又把整张 TOOL_RISK map
// 当 risk 赋值，这里会立刻在类型/运行时炸出来。
const VALID_RISK = new Set<RiskLevel>(['low', 'medium', 'high'])
for (const [name, tool] of Object.entries(AGENT_TOOLS)) {
  if (!VALID_RISK.has(tool.risk)) {
    throw new Error(`AGENT_TOOLS['${name}'].risk 非法：${String(tool.risk)}（必须是 low/medium/high 字面量，检查是否误把 TOOL_RISK 整表当 risk）`)
  }
}

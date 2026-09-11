import dayjs from 'dayjs'
import { z } from 'zod'
import { db } from '@/db/db'
import { txnCustomerIds, txnProjectIds, txnTodoIds } from '@/modules/finance/links'
import { buildSearchIndex, searchAll, type SearchEntityType } from '@/shared/search'
import { normalizeTodoPriority, todoPriorityFullLabel } from '@/modules/todo/priority'
import type { Customer, Habit, Ledger, Note, Project, Todo, Transaction } from '@/db/types'

/**
 * agentOps 读工具集 —— 方案 §2.2（P1 第 5 步）
 *
 * 外部 Agent 比内置 UI 更容易滥读：每个读工具**必须**声明「投影字段白名单 + 条数上限」，
 * 防止把 18 张同步表整表拉出去当上下文（§十.3 token 开销口径）。
 *
 * 三条纪律（与写工具同源）：
 * 1. **只走活记录**：与 `useCollection` 同源过滤 `deleted`，不把软删实体捡回来；
 * 2. **投影白名单**：返回字段经显式 pick，不含附件 Blob、不含 relations 全量、不含 markdown 大字段；
 * 3. **条数上限**：超限**截断并返回 `truncated: true`**，绝不静默全量返回。
 */

/** 上限（§2.2 表）：resolveEntity ≤10（在 resolver.ts）/ searchEntities ≤20 / list* ≤50 / getCustomer =1 */
export const READ_LIMITS = {
  searchEntities: 20,
  listTransactions: 50,
  listTodos: 50,
  listLedgers: 50,
  listHabits: 50,
  // P2 动作扩面：项目 / 笔记 / 文件夹（同域最小投影，上限 50）
  listProjects: 50,
  listNotes: 50,
  listNoteFolders: 50,
} as const

/** 统一读结果信封：`truncated` 让 Agent 知道「还有更多」，可缩小条件重查 */
export interface ReadResult {
  items: unknown[]
  count: number
  truncated: boolean
}

function envelope<T>(rows: T[], limit: number): ReadResult {
  return {
    items: rows.slice(0, limit),
    count: Math.min(rows.length, limit),
    truncated: rows.length > limit,
  }
}

/** 活记录过滤（与 `useCollection` / repository.get 同源语义） */
function alive<T extends { deleted: 0 | 1 }>(rows: T[]): T[] {
  return rows.filter((r) => !r.deleted)
}

/* ----------------------------- 读工具入参 schema ----------------------------- */

/**
 * listTransactions(filter)：金额/日期/状态/customerId/ledgerId，不含附件 Blob（§2.2）
 *
 * customerId 过滤语义（Issue #140）：多关联后按「数组包含」匹配 ——
 * 传 c1 时命中「只关联 c1」与「c1+c2 都关联」两种流水（真实业务里一笔款分摊多客户时，
 * 任一关联方视角都应能看到这笔流水）；入参保持单值不变，已分发的 AI 工具调用零改动。
 */
export const listTransactionsSchema = z.object({
  customerId: z.string().optional(),
  ledgerId: z.string().optional(),
  status: z.enum(['已结算', '待对账']).optional(),
  type: z.enum(['income', 'expense']).optional(),
  /** 日期范围（YYYY-MM-DD，含端点；仅日期粒度，与 UI 记账口径一致） */
  from: z.string().date('开始日期格式须为 YYYY-MM-DD').optional(),
  to: z.string().date('结束日期格式须为 YYYY-MM-DD').optional(),
})

/** getCustomer(id)：基本档案 + 关系档位摘要，不含 relations 全量与附件（§2.2，上限 1） */
export const getCustomerSchema = z.object({
  id: z.string().min(1, '请提供客户 id（应由 resolveEntity 消解产出）'),
})

/** listTodos(filter)：同域最小投影（§2.2） */
export const listTodosSchema = z.object({
  status: z.enum(['todo', 'done']).optional(),
  /** 四档优先级（含旧档位别名 P1/P2/P3，归一化后统一筛选） */
  priority: z
    .enum(['high', 'mid', 'low', 'none', 'P1', 'P2', 'P3'])
    .optional()
    .transform((v) => (v === undefined ? undefined : normalizeTodoPriority(v))),
  customerId: z.string().optional(),
  projectId: z.string().optional(),
})

/** listLedgers()：账本最小投影（§2.2） */
export const listLedgersSchema = z.object({}).strict()

/** listHabits()：无入参（习惯数量有限，整体返回） */
export const listHabitsSchema = z.object({}).strict()

/** listProjects(filter)：项目最小投影（P2 动作扩面） */
export const listProjectsSchema = z.object({
  status: z.enum(['active', 'paused', 'archived']).optional(),
  customerId: z.string().optional(),
})

/** listNotes(filter)：笔记最小投影（**不含 markdown 正文**，防上下文膨胀） */
export const listNotesSchema = z.object({
  q: z.string().trim().min(1, '搜索关键词不能为空').optional(),
  folderId: z.string().optional(),
  projectId: z.string().optional(),
  tag: z.string().optional(),
})

/** listNoteFolders()：文件夹最小投影 */
export const listNoteFoldersSchema = z.object({}).strict()

/** searchEntities(q, types?)：复用 `searchAll` 6 实体投影，notes 已有字段裁剪先例（§2.2） */
export const searchEntitiesSchema = z.object({
  q: z.string().trim().min(1, '请提供搜索关键词'),
  types: z
    .array(z.enum(['customer', 'todo', 'transaction', 'note', 'habit', 'project']))
    .optional(),
})

/* ------------------------------- 投影白名单 ------------------------------- */

/** 交易投影：不含 note 之外的杂项，绝不含附件（附件不入本表，见 §2.2） */
function projectTransaction(t: Transaction) {
  return {
    id: t.id,
    ledgerId: t.ledgerId,
    type: t.type,
    amount: t.amount,
    summary: t.summary,
    status: t.status,
    occurredAt: t.occurredAt,
    // 多关联（Issue #140）：投影按数组下发；空数组不落键，保持"无关联即无字段"的既有形状。
    // 审计整改（读取侧向后兼容）：已分发的外部 Agent 契约是单值键（旧读回结果里有
    // `.customerId` 等），只下数组是「输入侧宽松、输出侧收窄」的反向破口。这里补
    // 过渡别名 = 数组首元素（只读投影，不落库、不违反「双写不双读」），待外部调用方
    // 全部迁移到数组键后再移除（届时同步公告 breaking change）。
    ...(txnCustomerIds(t).length > 0 ? { customerIds: txnCustomerIds(t), customerId: txnCustomerIds(t)[0] } : {}),
    ...(txnProjectIds(t).length > 0 ? { projectIds: txnProjectIds(t), projectId: txnProjectIds(t)[0] } : {}),
    ...(txnTodoIds(t).length > 0 ? { todoIds: txnTodoIds(t), todoId: txnTodoIds(t)[0] } : {}),
  }
}

function projectTodo(t: Todo) {
  return {
    id: t.id,
    title: t.title,
    priority: t.priority,
    /** 四档中文档位说明（Agent 读回后无需自己映射 P1/P2/P3 语义） */
    priorityLabel: todoPriorityFullLabel(t.priority),
    status: t.status,
    ...(t.dueAt ? { dueAt: t.dueAt } : {}),
    ...(t.customerId ? { customerId: t.customerId } : {}),
    ...(t.projectId ? { projectId: t.projectId } : {}),
  }
}

function projectProject(p: Project) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    color: p.color,
    ...(p.customerId ? { customerId: p.customerId } : {}),
    ...(p.budget === undefined ? {} : { budget: p.budget }),
    ...(p.note ? { note: p.note } : {}),
  }
}

/** 笔记投影：**绝不含 markdown 正文**（外部 Agent 读全量正文会瞬间撑爆上下文） */
function projectNote(n: Note, folderName?: string) {
  return {
    id: n.id,
    title: n.title,
    tags: n.tags,
    ...(n.folderId ? { folderId: n.folderId, folderName } : {}),
    ...(n.projectId ? { projectId: n.projectId } : {}),
    /** 正文只给长度，需要正文请用 searchEntities 命中后由用户确认，或走 UI */
    markdownLength: (n.markdown ?? '').length,
  }
}

function projectLedger(l: Ledger) {
  return {
    id: l.id,
    name: l.name,
    currency: l.currency,
    closingCycle: l.closingCycle,
    isDefault: !!l.isDefault,
  }
}

/** 客户档案投影：基本档案 + 关系档位摘要，**不含** relations 全量与附件（§2.2） */
function projectCustomer(c: Customer) {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    title: c.title,
    decisionLevel: c.decisionLevel,
    tier: c.tier,
    tags: c.tags,
    lastContactAt: c.lastContactAt,
    /** 关系档位（Issue #108：健康分单一来源；缺省=未设置走算法兜底） */
    ...(c.intimacy ? { intimacy: c.intimacy } : {}),
    /** 关系条数摘要（仅计数，不下发 relations 全量，防上下文膨胀） */
    relationCount: (c.relations ?? []).length,
  }
}

/* --------------------------------- 读工具 --------------------------------- */

/** listTransactions：账目查询（Agent 的「本月花了多少」类问答数据源） */
export async function listTransactions(input: unknown): Promise<ReadResult> {
  const d = listTransactionsSchema.parse(input ?? {})
  const fromMs = d.from ? dayjs(d.from).startOf('day').valueOf() : undefined
  const toMs = d.to ? dayjs(d.to).endOf('day').valueOf() : undefined
  const rows = alive(await db.transactions.toArray())
    .filter((t) => (d.customerId ? txnCustomerIds(t).includes(d.customerId) : true))
    .filter((t) => (d.ledgerId ? t.ledgerId === d.ledgerId : true))
    .filter((t) => (d.status ? t.status === d.status : true))
    .filter((t) => (d.type ? t.type === d.type : true))
    .filter((t) => (fromMs === undefined ? true : t.occurredAt >= fromMs))
    .filter((t) => (toMs === undefined ? true : t.occurredAt <= toMs))
    .sort((a, b) => b.occurredAt - a.occurredAt)
  return envelope(rows.map(projectTransaction), READ_LIMITS.listTransactions)
}

/** getCustomer：单客户档案（上限 1，id 须来自 resolveEntity） */
export async function getCustomer(input: unknown): Promise<ReadResult> {
  const d = getCustomerSchema.parse(input)
  const c = await db.customers.get(d.id)
  if (!c || c.deleted) return { items: [], count: 0, truncated: false }
  return { items: [projectCustomer(c)], count: 1, truncated: false }
}

/** listTodos：待办查询（最小投影） */
export async function listTodos(input: unknown): Promise<ReadResult> {
  const d = listTodosSchema.parse(input ?? {})
  const rows = alive(await db.todos.toArray())
    .filter((t) => (d.status ? t.status === d.status : true))
    // 存量数据仍是 P1/P2/P3，比较前先归一化（normalizeTodoPriority 读侧收口）
    .filter((t) => (d.priority ? normalizeTodoPriority(t.priority) === d.priority : true))
    .filter((t) => (d.customerId ? t.customerId === d.customerId : true))
    .filter((t) => (d.projectId ? t.projectId === d.projectId : true))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
  return envelope(rows.map(projectTodo), READ_LIMITS.listTodos)
}

/** listLedgers：账本清单（记账前置：Agent 需先知道有哪些账本，缺省走 isDefault） */
export async function listLedgers(input: unknown): Promise<ReadResult> {
  listLedgersSchema.parse(input ?? {})
  const rows = alive(await db.ledgers.toArray()).sort(
    (a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity),
  )
  return envelope(rows.map(projectLedger), READ_LIMITS.listLedgers)
}

/** listHabits：习惯清单（打卡前置） */
export async function listHabits(input: unknown): Promise<ReadResult> {
  void input
  const rows = alive(await db.habits.toArray())
  return envelope(
    rows.map((h: Habit) => ({ id: h.id, name: h.name, category: h.category, schedule: h.schedule })),
    READ_LIMITS.listHabits,
  )
}

/**
 * searchEntities：跨实体检索（复用 `searchAll` 的 6 实体投影，§2.2）。
 * notes 走字段裁剪投影（`NoteSearchProjection`：id/title/tags，不含 markdown）。
 */
export async function searchEntities(input: unknown): Promise<ReadResult> {
  const d = searchEntitiesSchema.parse(input)
  const [customers, projects, todos, transactions, notes, habits] = await Promise.all([
    db.customers.toArray(),
    db.projects.toArray(),
    db.todos.toArray(),
    db.transactions.toArray(),
    db.notes.toArray(),
    db.habits.toArray(),
  ])
  const index = buildSearchIndex({
    customers: alive(customers),
    projects: alive(projects),
    todos: alive(todos),
    transactions: alive(transactions),
    notes: alive(notes as unknown as Note[]).map((n) => ({ id: n.id, title: n.title, tags: n.tags })),
    habits: alive(habits),
  })
  const groups = searchAll(index, d.q)
  const allowed = d.types ? new Set<SearchEntityType>(d.types) : undefined
  // 待办结果补档位语义（Issue #148 后续 · 上轮审计建议 5）：
  // `searchAll` 的投影只有 {title, subtitle, path}，Agent 拿到的待办**不带档位**，
  // 与 `listTodos` 的 `priorityLabel` 口径不一致（同一实体两处读回形状不同）。
  // 这里按 id 回填四档档位全称（如「高 · 重要紧急」），让 AI 侧与 UI / listTodos 同源。
  const priorityById = new Map(
    alive(todos).map((t) => [t.id, { priority: normalizeTodoPriority(t.priority), priorityLabel: todoPriorityFullLabel(t.priority) }]),
  )
  const items = groups
    .filter((g) => (allowed ? allowed.has(g.type) : true))
    .flatMap((g) =>
      g.items.map((it) => ({
        id: it.id,
        type: it.type,
        title: it.title,
        subtitle: it.subtitle,
        path: it.path,
        ...(it.type === 'todo' ? (priorityById.get(it.id) ?? {}) : {}),
      })),
    )
  return envelope(items, READ_LIMITS.searchEntities)
}

/** listProjects：项目清单（P2 动作扩面） */
export async function listProjects(input: unknown): Promise<ReadResult> {
  const d = listProjectsSchema.parse(input ?? {})
  const rows = alive(await db.projects.toArray())
    .filter((p) => (d.status ? p.status === d.status : true))
    .filter((p) => (d.customerId ? p.customerId === d.customerId : true))
    .sort((a, b) => b.createdAt - a.createdAt)
  return envelope(rows.map(projectProject), READ_LIMITS.listProjects)
}

/**
 * listNotes：笔记清单（**不含 markdown 正文**）。
 * 为什么这里与 searchEntities 分开：searchAll 的笔记投影已裁剪，但 Agent 经常需要
 * 「按目录/项目/标签列一批笔记再逐条改归属」，需要可枚举的稳定入口；两者共用同一份裁剪口径。
 */
export async function listNotes(input: unknown): Promise<ReadResult> {
  const d = listNotesSchema.parse(input ?? {})
  const folders = alive(await db.noteFolders.toArray())
  const folderName = new Map(folders.map((f) => [f.id, f.name]))
  const q = d.q?.toLowerCase()
  const rows = alive(await db.notes.toArray())
    .filter((n) => (d.folderId ? n.folderId === d.folderId : true))
    .filter((n) => (d.projectId ? n.projectId === d.projectId : true))
    .filter((n) => (d.tag ? n.tags.includes(d.tag) : true))
    .filter((n) => (q ? n.title.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)) : true))
    .sort((a, b) => b.createdAt - a.createdAt)
  return envelope(
    rows.map((n) => projectNote(n, n.folderId ? folderName.get(n.folderId) : undefined)),
    READ_LIMITS.listNotes,
  )
}

/** listNoteFolders：文件夹清单 */
export async function listNoteFolders(input: unknown): Promise<ReadResult> {
  listNoteFoldersSchema.parse(input ?? {})
  const rows = alive(await db.noteFolders.toArray()).sort((a, b) => a.name.localeCompare(b.name))
  return envelope(
    rows.map((f) => ({ id: f.id, name: f.name })),
    READ_LIMITS.listNoteFolders,
  )
}

/** 供测试与白名单复用的读工具清单 */
export const READ_TOOLS = {
  resolveEntity: 'resolveEntity',
  searchEntities: 'searchEntities',
  getCustomer: 'getCustomer',
  listTransactions: 'listTransactions',
  listTodos: 'listTodos',
  listLedgers: 'listLedgers',
  listHabits: 'listHabits',
  listProjects: 'listProjects',
  listNotes: 'listNotes',
  listNoteFolders: 'listNoteFolders',
} as const

export type { Project }

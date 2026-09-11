import Dexie, { type Table } from 'dexie'
import type {
  Workspace,
  Customer,
  Interaction,
  Ledger,
  Transaction,
  Todo,
  Note,
  QuickNote,
  Habit,
  HabitLog,
  Trophy,
  Settings,
  ModuleConfig,
} from './types'

export interface SyncQueueItem {
  /** 自增主键（schema: ++seq） */
  seq?: number
  table: string
  recordId: string
  op: 'upsert' | 'delete'
  createdAt: number
  sentAt?: number
}

export interface MetaEntry {
  key: string
  value: unknown
}

/** 附件 Blob 单独存表（凭证图片等），元数据随业务记录同步 */
export interface Attachment {
  id: string
  refType: string
  refId: string
  name: string
  mime: string
  size: number
  blob: Blob
  createdAt: number
}

/**
 * 专注会话 —— 本地瞬态数据，不进同步队列（开发计划 2.3 多设备约定）
 * 指标「深度专注分钟数」从本表推导
 */
export interface FocusSession {
  id: string
  startedAt: number
  completedAt: number
  minutes: number
}

/**
 * 寻鸽工作台本地数据库
 * 所有业务表均含同步元数据 updatedAt/deleted/rev（索引统一建在 updatedAt 上）
 */
export class NexusDB extends Dexie {
  workspaces!: Table<Workspace, string>
  customers!: Table<Customer, string>
  interactions!: Table<Interaction, string>
  ledgers!: Table<Ledger, string>
  transactions!: Table<Transaction, string>
  todos!: Table<Todo, string>
  notes!: Table<Note, string>
  quickNotes!: Table<QuickNote, string>
  habits!: Table<Habit, string>
  habitLogs!: Table<HabitLog, string>
  trophies!: Table<Trophy, string>
  attachments!: Table<Attachment, string>
  syncQueue!: Table<SyncQueueItem, number>
  meta!: Table<MetaEntry, string>
  todoLists!: Table<import('./types').TodoList, string>
  noteFolders!: Table<import('./types').NoteFolder, string>
  projects!: Table<import('./types').Project, string>
  projectMilestones!: Table<import('./types').ProjectMilestone, string>
  focusSessions!: Table<FocusSession, string>
  settings!: Table<Settings, string>
  moduleConfigs!: Table<ModuleConfig, string>
  customerGroups!: Table<import('./types').CustomerGroup, string>

  constructor() {
    super('nexus-workspace')
    this.version(1).stores({
      workspaces: 'id, updatedAt',
      customers: 'id, workspaceId, tier, updatedAt, [workspaceId+tier]',
      interactions: 'id, customerId, at, updatedAt',
      ledgers: 'id, updatedAt',
      transactions: 'id, ledgerId, occurredAt, status, customerId, updatedAt',
      todos: 'id, status, dueAt, priority, customerId, updatedAt',
      notes: 'id, updatedAt',
      quickNotes: 'id, createdAt, updatedAt',
      habits: 'id, updatedAt',
      habitLogs: 'id, habitId, date, updatedAt, [habitId+date]',
      trophies: 'id, tier, unlockedAt, updatedAt',
      attachments: 'id, refType, refId, createdAt',
      syncQueue: '++seq, table, recordId, sentAt',
      meta: 'key',
    })
    this.version(2).stores({
      focusSessions: 'id, startedAt, completedAt',
    })
    // v3（Phase 6）：settings singleton 表 —— 本地偏好，不进同步队列
    this.version(3).stores({
      settings: 'key',
    })
    // v4（清单系统）：用户自定义清单
    this.version(4).stores({
      todoLists: 'id, sortOrder, updatedAt',
    })
    // v5：todos 加 listId 索引（deleteTodoListCascade 级联查询走索引，避免全表扫描）；
    // customers 移除已废弃的 workspaceId 残留索引（类型与业务代码均已不用，减少写放大）
    this.version(5).stores({
      todos: 'id, status, dueAt, priority, customerId, listId, updatedAt',
      customers: 'id, tier, updatedAt',
    })
    // v6（笔记文件夹）：笔记文件树体系
    this.version(6).stores({
      noteFolders: 'id, updatedAt',
      notes: 'id, folderId, updatedAt',
    })
    // v7（账本左侧树）：账本清单化，加 sortOrder 索引支持拖拽排序
    this.version(7).stores({
      ledgers: 'id, sortOrder, updatedAt',
    })
    // v8（项目模块）：projects / projectMilestones 新表；
    // transactions/todos/notes/interactions 补 projectId 索引（弱引用查询与级联解绑走索引，v5 同款纪律）
    this.version(8).stores({
      projects: 'id, customerId, status, updatedAt',
      projectMilestones: 'id, projectId, sortOrder, updatedAt, [projectId+sortOrder]',
      transactions: 'id, ledgerId, occurredAt, status, customerId, projectId, updatedAt',
      todos: 'id, status, dueAt, priority, customerId, listId, projectId, updatedAt',
      notes: 'id, folderId, projectId, updatedAt',
      interactions: 'id, customerId, at, projectId, updatedAt',
    })
    // v10（Issue #63 自定义客户分组）：tag 规则圈人，参与同步
    this.version(10).stores({
      customerGroups: 'id, sortOrder, updatedAt',
    })
    // v9（Issue #34 亲密度体系）：moduleConfigs 模块配置表（key 寻址，每模块一条）。
    // 亲密度等级名/黑名单开关/算法权重随同步多端一致，走同步表而非 settings（本地偏好不进同步）
    this.version(9).stores({
      moduleConfigs: 'id, updatedAt',
    })
    /**
     * v11（Issue #140 交易多关联）：transactions 的关联字段单值 → 数组
     * `customerId/todoId/projectId` → `customerIds/todoIds/projectIds`。
     *
     * 索引策略变更（有意为之，非疏漏）：v8 起 transactions.customerId 建有索引，
     * 级联解绑/CRM 建边均走 `where('customerId')`。数组化后若要保住"走索引"，
     * 只能上 Dexie `multiEntry` 索引 —— 但 multiEntry 与同步队列的整体替换语义
     * （`put` 整体覆盖记录）及 `rev` 递增存在兼容坑，且本表数据量级小（个人工作台，
     * 千级），故**改用内存过滤** `(t.customerIds ?? []).includes(cid)`：
     * 语义更直白、与 `deleteCustomerCascade` 的"逐条解绑"写法一致、避免 multiEntry 的坑。
     * 代价是全表扫描 —— 数据量增长到万级时需重新评估（届时应上 multiEntry 或独立关联表）。
     *
     * 旧字段在 migrate 中**清掉**（双写不双读）：新数组为唯一真源。
     * 远端拉取路径由 `sync/mergeRemote.normalizeTxnLinks` 兜底归一化（服务端未升级时旧字段仍可能回来）。
     */
    this.version(11)
      .stores({
        transactions: 'id, ledgerId, occurredAt, status, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('transactions')
          .toCollection()
          .modify((t: Record<string, unknown>) => {
            const toIds = (v: unknown): string[] | undefined => {
              if (typeof v === 'string' && v) return [v]
              if (Array.isArray(v)) {
                const ids = v.filter((x): x is string => typeof x === 'string' && !!x)
                return ids.length > 0 ? [...new Set(ids)] : undefined
              }
              return undefined
            }
            const customerIds = toIds(t.customerIds ?? t.customerId)
            const todoIds = toIds(t.todoIds ?? t.todoId)
            const projectIds = toIds(t.projectIds ?? t.projectId)
            if (customerIds) t.customerIds = customerIds
            else delete t.customerIds
            if (todoIds) t.todoIds = todoIds
            else delete t.todoIds
            if (projectIds) t.projectIds = projectIds
            else delete t.projectIds
            // 真源唯一：旧单值字段即刻清除，杜绝"双读 fallback"被写漏
            delete t.customerId
            delete t.todoId
            delete t.projectId
          })
      })
  }
}

export const db = new NexusDB()

/** 当前工作区（本期单工作区：Personal，种子写入） */
export const DEFAULT_WORKSPACE_ID = 'ws-main'

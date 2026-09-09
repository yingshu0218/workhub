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
    // v9（Issue #34 亲密度体系）：moduleConfigs 模块配置表（key 寻址，每模块一条）。
    // 亲密度等级名/黑名单开关/算法权重随同步多端一致，走同步表而非 settings（本地偏好不进同步）
    this.version(9).stores({
      moduleConfigs: 'id, updatedAt',
    })
  }
}

export const db = new NexusDB()

/** 当前工作区（本期单工作区：Personal，种子写入） */
export const DEFAULT_WORKSPACE_ID = 'ws-main'

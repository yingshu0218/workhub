/**
 * 全局实体类型定义
 * 所有业务表统一携带同步元数据：updatedAt / deleted / rev（见开发计划 2.3）
 */

export interface SyncMeta {
  updatedAt: number
  deleted: 0 | 1
  rev: number
  /** 种子数据/已同步标记，避免种子被重复推送 */
  synced?: 0 | 1
}

export interface Workspace extends SyncMeta {
  id: string
  name: string
  role: 'Owner' | 'Collaborator' | 'Personal'
  createdAt: number
}

export interface Customer extends SyncMeta {
  id: string
  name: string
  company: string
  industry: string
  title: string
  decisionLevel: '决策人' | '影响者' | '使用者' | '把关人'
  tier: 'S' | 'A' | 'B' | '潜在'
  stage: string
  tags: string[]
  phone: string
  wechat: string
  email: string
  address: string
  healthScore: number // 0-100
  lastContactAt: number
  createdAt: number
}

export interface Interaction extends SyncMeta {
  id: string
  customerId: string
  type: '电话' | '会议' | '邮件' | '拜访'
  content: string
  at: number
}

export interface Ledger extends SyncMeta {
  id: string
  name: string
  currency: string
  openingBalance: number
  closingCycle: '月结' | '季结' | '年结' | '不封账'
  createdAt: number
}

export interface Transaction extends SyncMeta {
  id: string
  ledgerId: string
  type: 'income' | 'expense'
  amount: number
  summary: string
  channel: string
  occurredAt: number
  tags: string[]
  invoiceNo?: string
  note?: string
  customerId?: string
  todoId?: string
  status: '已结算' | '待对账'
}

export interface Todo extends SyncMeta {
  id: string
  title: string
  desc: string
  priority: 'P1' | 'P2' | 'P3'
  dueAt?: number
  status: 'todo' | 'doing' | 'done'
  customerId?: string
  ledgerId?: string
  habitId?: string
  completedAt?: number
  createdAt: number
}

export interface NoteMention {
  type: 'customer' | 'todo' | 'ledger'
  id: string
  label: string
}

export interface Note extends SyncMeta {
  id: string
  title: string
  markdown: string
  tags: string[]
  backlinks: string[]
  mentions: NoteMention[]
  createdAt: number
}

export interface QuickNote extends SyncMeta {
  id: string
  content: string
  convertedTo?: 'todo' | 'note'
  createdAt: number
}

export interface Habit extends SyncMeta {
  id: string
  name: string
  icon: string
  color: string
  category: string
  schedule: string // '每日' | '每周3次' | 自定义描述
  targetMinutes: number
  motivationNote: string
  crossModuleSync: boolean
  createdAt: number
}

export interface HabitLog extends SyncMeta {
  id: string
  habitId: string
  /** YYYY-MM-DD */
  date: string
  completedAt: number
  evidence?: string
}

export type TrophyTier = '铜' | '银' | '金' | '白金'

/** 奖杯解锁条件的结构化类型（统计一律从源记录推导，不存快照） */
export type TrophyConditionType =
  | 'focus_minutes_total' // 累计专注分钟
  | 'focus_once_minutes' // 单次专注分钟
  | 'habit_streak' // 任一习惯连续打卡天数
  | 'habit_checks_total' // 累计打卡次数
  | 'transactions_total' // 累计交易笔数
  | 'customers_total' // 累计客户数

export interface Trophy extends SyncMeta {
  id: string
  name: string
  tier: TrophyTier
  rarity: string // 如 '2.3%'
  description: string
  icon: string
  unlockedAt?: number
  /** 结构化解锁条件：缺省表示无条件奖杯（不参与引擎评估） */
  conditionType?: TrophyConditionType
  conditionValue?: number
}

/**
 * 统计数据不参与同步（开发计划 2.3 多设备约定）：
 * EXP/连击等一律从源记录（HabitLog/Todo/Transaction）实时推导
 */

export const SYNC_META_DEFAULT: SyncMeta = {
  updatedAt: 0,
  deleted: 0,
  rev: 0,
}

export interface CustomerOption {
  id: string
  name: string
  company: string
}

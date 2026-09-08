import type { ThemeStyleId } from '@/shared/theme'

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

/**
 * 客户间语义关系（Issue #22）：弱引用，targetId 必须指向现存客户，
 * UI 只允许从已有客户列表选择，杜绝画布悬挂边（同 deleteCustomerCascade 注释的崩溃根因）
 */
/** 关系归类维度（Issue #34）：图谱连线的展示分组/着色/筛选用，不做业务证据溯源 */
export type RelationCategory = 'project' | 'event' | 'finance' | 'person' | 'other'

/** 各归类的展示名与图谱边配色（buildRelationLinks / GraphCanvas / CustomerFormDrawer 共用） */
export const RELATION_CATEGORIES: { id: RelationCategory; name: string; color: string }[] = [
  { id: 'project', name: '项目', color: '#6d43c4' },
  { id: 'event', name: '事件', color: '#0065b8' },
  { id: 'finance', name: '财务', color: '#006c49' },
  { id: 'person', name: '关联人物', color: '#943700' },
  { id: 'other', name: '其他', color: '#4a4458' },
]

export interface CustomerRelation {
  /** 单条关系条目主键（Issue #39）：同一客户可对同一目标保留多条不同语义，须以条目 id 独立去重/删除/作 key */
  id?: string
  /** 目标客户 id（弱引用） */
  targetId: string
  /** 关系语义，如：转介绍人 / 同一公司 / 上下游 */
  label: string
  /** 归类维度（可选，向后兼容旧数据；缺省按 other 展示） */
  category?: RelationCategory
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
  /** 客户间语义关系（双向弱引用；编辑抽屉维护，删除级联双向解绑） */
  relations?: CustomerRelation[]
}

export interface Interaction extends SyncMeta {
  id: string
  customerId: string
  type: '电话' | '会议' | '邮件' | '拜访' | '跟进' | '小结' | '其他'
  content: string
  at: number
  /** 所属项目（进展流水复用 CRM 沟通日志，不另建表） */
  projectId?: string
}

export interface Ledger extends SyncMeta {
  id: string
  name: string
  currency: string
  openingBalance: number
  closingCycle: '月结' | '季结' | '年结' | '不封账'
  /** 左侧账本树排序（拖拽重写；旧记录缺省按 createdAt 兜底） */
  sortOrder?: number
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
  /** 所属项目（可选弱引用：项目删除仅解绑，不删流水） */
  projectId?: string
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
  /** 所属自定义清单（智能清单不落此字段） */
  listId?: string
  /** 所属项目（可选弱引用：一次性的待办可不填；项目删除仅解绑） */
  projectId?: string
  completedAt?: number
  createdAt: number
}

/** 用户自定义清单（左侧「我的清单」，可增删改排序，参与同步） */
export interface TodoList extends SyncMeta {
  id: string
  name: string
  sortOrder: number
  createdAt: number
}

/**
 * 项目 —— 跨模块「主题容器」（长期项目 / 持续跟进 / 资料聚合共用一个模型）：
 * 各模块（Transaction/Todo/Note/Interaction）用可选 projectId 弱引用挂上来。
 * 与客户的边界：客户是「人/组织」，项目是「事」；项目可不挂客户，一个客户可挂多个项目。
 * 项目维度的收支/进度统计一律从源记录实时推导，本表不存任何快照字段（仓库铁律）。
 */
export interface Project extends SyncMeta {
  id: string
  name: string
  /** 视觉标识色（hex），用于项目列表/详情/画布节点 */
  color: string
  /** 生命周期：active 进行中 / paused 暂搁置 / archived 已归档（归档不删除，历史关联保留） */
  status: 'active' | 'paused' | 'archived'
  /** 挂靠客户（可选，打通 CRM 下钻：客户 → 项目 → 流水） */
  customerId?: string
  /** 可选项目预算（仅展示对比，不参与任何统计口径强制） */
  budget?: number
  note?: string
  createdAt: number
}

/**
 * 项目里程碑 —— 结构化进度（阶段刻度，区别于一次性的待办）。
 * 照抄 TodoList 先例：独立表 + projectId 索引 + 级联删除。
 * 进度 = Σ(done 里程碑×weight) / Σ(全部 weight)，无里程碑的项目 fallback 待办完成率。
 */
export interface ProjectMilestone extends SyncMeta {
  id: string
  projectId: string
  name: string
  dueAt?: number
  /** 进度权重（正整数；缺省 1） */
  weight: number
  status: 'planned' | 'inProgress' | 'done'
  sortOrder: number
  createdAt: number
}

export interface NoteMention {
  type: 'customer' | 'todo' | 'ledger' | 'project'
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
  /** 所属文件夹（缺省为未归档根层） */
  folderId?: string
  /** 所属项目（资料聚合的落点：项目详情页聚合展示；缺省为未归属） */
  projectId?: string
  createdAt: number
}

/** 笔记文件夹（左栏文件树节点，单层平铺；参与同步） */
export interface NoteFolder extends SyncMeta {
  id: string
  name: string
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

/**
 * 系统设置 singleton（Phase 6）—— 本地 UI 偏好，不参与同步（开发计划 2.3：瞬态/UI 偏好只存本地）
 * 写入走 settingsRepo：singleton + 事务，写后广播 settings:changed，各消费端监听实时应用
 */
export interface SettingsAppearance {
  /** 深浅模式：light / dark / 跟随系统 */
  mode: 'light' | 'dark' | 'system'
  /** 风格主题包（取 THEME_STYLES 的 id，见 shared/theme），换整套界面气质而非仅强调色 */
  theme?: ThemeStyleId
  /** 强调色（取 ACCENT_PRESETS 的 id，见 SettingsPage） */
  accent: string
  /** 圆角档位：sharp 4px / medium 8px / large 14px */
  radius: 'sharp' | 'medium' | 'large'
  /** 信息密度：舒适 / 紧凑（映射 Tailwind spacing 基数） */
  density: 'comfortable' | 'compact'
}

export interface SettingsTypography {
  /** 基准字号 px（html font-size） */
  fontSize: number
  /** 行高倍数 */
  lineHeight: number
  /** 字体组合预设（取 FONT_PRESETS 的 id，见 shared/theme；缺省 inter，映射 --font-sans 栈） */
  fontPreset?:
    | 'inter'
    | 'system'
    | 'serif'
    | 'hei'
    | 'kai'
    | 'rounded'
    | 'mono'
    | 'fangsong'
    | 'cursive'
    | 'gothic'
    | 'songti'
    | 'yozai'
}

export interface SettingsNotifications {
  desktopNotice: boolean
  soundAlerts: boolean
  webhook: boolean
  /** 每日待办预告 */
  dailyBrief: boolean
  /** 逾期预警 */
  todoDueWarning: boolean
  /** 打卡晚间提醒 */
  habitReminder: boolean
  /** 月末对账 */
  monthEndReconcile: boolean
  /** 客户久未跟进提醒 */
  customerStaleAlert: boolean
}

export interface SettingsSecurity {
  /** AES-256-GCM 端侧加密（预留位，本期不实装） */
  encryption: boolean
  syncFrequency: 'realtime' | '5min' | 'manual'
  /** 高性能缓存持久化（IndexedDB） */
  persistCache: boolean
}

/**
 * 自托管 PocketBase 同步配置（Phase 7）—— 仅存本地，绝不进同步载荷
 * serverUrl 为空 = 本地模式（适配器退化为空实现）
 */
export interface SettingsSync {
  /** 服务端地址，如 https://sync.example.com（不带尾斜杠） */
  serverUrl: string
  /** PocketBase users 账号（邮箱或用户名） */
  username: string
  /** 明文仅存本地 IndexedDB，用于 401 时自动重登 */
  password: string
  /** auth-with-password 获取的鉴权 token（内存外缓存，避免每次同步重登） */
  token: string
  /** token 对应的 PocketBase 用户 id */
  tokenUserId: string
}

export interface Settings {
  key: string
  appearance: SettingsAppearance
  typography: SettingsTypography
  notifications: SettingsNotifications
  security: SettingsSecurity
  sync: SettingsSync
}

export const SETTINGS_KEY = 'singleton'

export const DEFAULT_SETTINGS: Settings = {
  key: SETTINGS_KEY,
  appearance: { mode: 'light', accent: 'blue', radius: 'medium', density: 'comfortable' },
  typography: { fontSize: 14, lineHeight: 1.6 },
  notifications: {
    desktopNotice: true,
    soundAlerts: true,
    webhook: false,
    dailyBrief: true,
    todoDueWarning: true,
    habitReminder: true,
    monthEndReconcile: true,
    customerStaleAlert: true,
  },
  security: { encryption: false, syncFrequency: 'realtime', persistCache: true },
  sync: { serverUrl: '', username: '', password: '', token: '', tokenUserId: '' },
}

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

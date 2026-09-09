import type { ThemeStyleId, SkinStyleId } from '@/shared/theme'

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
  /** 亲密度手动档（Issue #34）：内嵌可选字段零迁移；缺省=未设置=走算法兜底 */
  intimacy?: CustomerIntimacy
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
  /** 默认账本（Issue #67）：内嵌可选字段零迁移；全局唯一，新建流水默认选中 */
  isDefault?: boolean
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
  /** 配色主题包（取 THEME_STYLES 的 id，见 shared/theme），只管色板/情绪色，与风格正交 */
  theme?: ThemeStyleId
  /**
   * 界面风格包（Issue #54，取 SKIN_STYLES 的 id）：独立于配色的造型语言维度。
   * 先选风格、再叠配色；与 theme 互不污染，切换配色不动风格，反之亦然。
   */
  style?: SkinStyleId
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
  appearance: {
    mode: 'light',
    accent: 'blue',
    radius: 'medium',
    density: 'comfortable',
    // Issue #54：style 不进 DEFAULT，缺省=「未手动选过风格」，
    // effects.ts 据此回退主题 recommendStyle（迁移桥），老用户零感知；
    // 用户一旦在设置页显式选风格（含 none）即持久化覆盖。
  },
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

// ─────────────────────────── 客户亲密度体系（Issue #34 收敛稿） ───────────────────────────

/**
 * 亲密度等级（Issue #34 收敛稿：7 档 = 5 档信任轴 T1~T5 + 2 档隔离态 I6/I7）。
 * key 是 code 级常量、永不增删改名（改名零迁移的前提）；显示名/描述走 moduleConfigs 配置。
 * T 档可参与算法兜底推导；I 档是用户主动降级的意愿信号，算法永不给出。
 */
export type IntimacyLevel = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'I6' | 'I7'

/** 亲密度 7 档固定 key 顺序（设置页/选择器渲染顺序，T1→I7） */
export const INTIMACY_LEVELS: IntimacyLevel[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'I6', 'I7']

/** 信任轴（可被算法兜底分档）与隔离态（只能人工设置）的划分 */
export const isIntimacyTrustLevel = (l: IntimacyLevel) => l.startsWith('T')

/** 图谱圈层视觉档（Issue #34 视觉映射：内圈大/外圈小；I 档圈外弱化） */
export const INTIMACY_VISUAL: Record<IntimacyLevel, { radius: number; color: string; ring: string }> =
  {
    T1: { radius: 34, color: '#004ac6', ring: '#004ac6' },
    T2: { radius: 30, color: '#004ac6', ring: '#5a7fd6' },
    T3: { radius: 26, color: '#0065b8', ring: '#7fa8d6' },
    T4: { radius: 22, color: '#6f7987', ring: '#a8b0bd' },
    T5: { radius: 18, color: '#8a94a6', ring: '#c3c9d4' },
    I6: { radius: 14, color: '#9a9096', ring: '#c9c1c5' },
    I7: { radius: 14, color: '#ba1a1a', ring: '#e0a9a8' },
  }

/** 亲密度等级配置行（名称/判据描述可编辑，key 固定） */
export interface IntimacyLevelConfig {
  key: IntimacyLevel
  name: string
  desc: string
}

/** 黑名单（I7）全局屏蔽开关矩阵（Issue #34 审计口径：默认只开图谱隐藏，副作用渐进开放） */
export interface ModuleConfigBlacklist {
  /** 图谱隐藏（I7 节点不渲染） */
  hideInGraph: boolean
  /** 全局搜索 / ⌘K 屏蔽 */
  hideInSearch: boolean
  /** 新建业务单据客户选择器不可选 */
  excludeFromPicker: boolean
  /** 时间线/列表隐藏（仅档案可见） */
  hideInTimeline: boolean
}

/** 算法兜底配置：4 因子权重 + 切档阈值（Issue #34 收敛稿默认 30/30/20/20；85/70/50） */
export interface ModuleConfigIntimacyAlgorithm {
  /** 算法兜底总开关（手动设置始终最优先） */
  enabled: boolean
  weights: { contact: number; finance: number; todo: number; project: number }
  /** 切档阈值（单调递减约束：t2 > t3 > t4；算法最多推到 T2，永不给出 T1/I6/I7） */
  thresholds: { t2: number; t3: number; t4: number }
}

/** moduleConfigs 表 crm.intimacy 记录的 payload（key 寻址，每模块一条，随同步多端一致） */
export interface ModuleConfigIntimacy {
  levels: IntimacyLevelConfig[]
  blacklist: ModuleConfigBlacklist
  algorithm: ModuleConfigIntimacyAlgorithm
}

/** moduleConfigs 表记录：SyncMeta 全量同步元数据，id 即配置 key（如 'crm.intimacy'） */
export interface ModuleConfig extends SyncMeta {
  id: string
  payload: unknown
}

/** crm.intimacy 默认配置（收敛稿默认值；levels 命名取 Issue #34 已收敛命名） */
export const DEFAULT_INTIMACY_CONFIG: ModuleConfigIntimacy = {
  levels: [
    { key: 'T1', name: '核心', desc: '100% 信任，托付底线的事也放心' },
    { key: 'T2', name: '信赖', desc: '大多数情况下可信任，有事第一时间想起' },
    { key: 'T3', name: '合作', desc: '可以共事，有过成功协作' },
    { key: 'T4', name: '一般', desc: '关系一般，合作慎重' },
    { key: 'T5', name: '照面', desc: '只是有打过照面，无实质往来' },
    { key: 'I6', name: '疏远', desc: '不想有交集，主动回避' },
    { key: 'I7', name: '黑名单', desc: '明确拉黑，按屏蔽开关全局规避' },
  ],
  blacklist: {
    hideInGraph: true,
    hideInSearch: false,
    hideInTimeline: false,
    excludeFromPicker: false,
  },
  algorithm: {
    enabled: true,
    weights: { contact: 30, finance: 30, todo: 20, project: 20 },
    thresholds: { t2: 85, t3: 70, t4: 50 },
  },
}

/** moduleConfigs 的 crm.intimacy 配置 key（幂等寻址，全库一条） */
export const INTIMACY_CONFIG_ID = 'crm.intimacy'

/** 客户亲密度手动档：手动设置后锁定、算法分不参与；note 记原因、updatedAt 留痕可审计 */
export interface CustomerIntimacy {
  level: IntimacyLevel
  note?: string
  updatedAt: number
}

import type { ThemeStyleId, SkinStyleId } from '@/shared/theme'
import { tagKey } from '@/shared/tags'

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
  /**
   * 最近一次「显式恢复」的时间（回收站）。
   *
   * 为什么单独记而不复用 updatedAt：同步层原有口径是「墓碑不可逆」，恢复必须是一个
   * **可识别的例外**，否则无法区分「用户点恢复」与「对端不知情期间的普通编辑」。
   * 语义：粘性（普通编辑保留）、删除时清空；同步判定只在 `restoredAt > 对方删除时间` 时放行。
   */
  restoredAt?: number
  /**
   * 进入删除态的时间 —— **不是 updatedAt 的别名**（2026-10-24 补）。
   *
   * 为什么必须单列：墓碑上的 updatedAt 会被同步层当作 LWW 依据**反复抬高**
   * （`mergeRemote` 落墓碑时取 `max(远端, 本地)`），删除之后任何一次对端合并都会让它漂移。
   * 于是回收站的「删除于 2026-10-24 14:30」和「剩余 N 天」全部失真，保留期清理也会提前/延后。
   * deletedAt 只在**进入删除态那一刻**写一次，恢复时清空，合并时取较晚者；不做数据迁移 ——
   * 老墓碑没有该字段，读取侧一律回退 `updatedAt`（`repositories/trash.ts#listTrash`）。
   */
  deletedAt?: number
  /**
   * 删除时的关联快照（只写在被删的根记录上，随墓碑同步）。
   * 恢复时按它回填删除时被清空的跨模块关联；历史墓碑没有该字段，无法反推。
   */
  trashSnapshot?: TrashSnapshot
}

/** 可进回收站的业务表（与 SYNC_TABLES 的子集对齐；快速便签/奖杯/配置/工作区无删除入口） */
export type TrashTable =
  | 'customers'
  | 'interactions'
  | 'ledgers'
  | 'transactions'
  | 'todos'
  | 'todoLists'
  | 'notes'
  | 'noteFolders'
  | 'projects'
  | 'projectMilestones'
  | 'habits'
  | 'habitLogs'
  | 'attachments'
  | 'customerGroups'

export interface TrashSnapshotLink {
  table: TrashTable
  id: string
  field: string
  /**
   * append：数组字段补回一个 id；
   * set：单值字段回填；
   * relation：补回客户关系对象；
   * mention：补回笔记里指向该实体的 mention（`notes.mentions` 是对象数组，不能走 append）
   */
  mode: 'append' | 'set' | 'relation' | 'mention'
  value: string | CustomerRelation | NoteMention
}

export interface TrashSnapshot {
  /** 被级联软删的子记录（只记删除时仍存活的） */
  children: { table: TrashTable; id: string }[]
  /** 被解除的弱关联（只记删除时目标仍存活的） */
  links: TrashSnapshotLink[]
  /**
   * 级联软删时一并墓碑化的 **links 表记录 id**（关联层 · 原子化一期 R2）。
   * 与 links 字段（旧字段级解绑的回填档案）正交：这里记的是 links 表整条记录，
   * 恢复时按「两端实体都存活」逐条复活（repositories/links.ts#reviveCascadeLinks）。
   * 为什么精确记 id 而不按删除时间猜：用户在实体删除前手动解绑的 link 同样是墓碑，
   * 时间戳区分不了「级联牺牲品」与「用户本意」，只有快照 id 是精确凭证。
   * 可选字段：无关联层记录的老墓碑与零关联的新墓碑均缺省，恢复侧按空处理。
   */
  cascadeLinkIds?: string[]
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

/**
 * 客户档案。
 *
 * 原手动 `tier`（S/A/B/潜在 四档分层）已删除，分层语义**合并进健康分 `intimacy`**：
 * 两者本是重叠的两套分层，而健康分那套是自动算的（4 因子加权 + 手动可锁定），
 * 保留手动那套只增加复杂度。
 *
 * 注：服务端 `customers` 集合**从来没有过 tier 列**（PB 对未声明字段静默丢弃），
 * 所以线上该字段一直是空的、按它分组与统计恒为 0 —— 删除不涉及任何服务端变更。
 */
export interface Customer extends SyncMeta {
  id: string
  name: string
  company: string
  title: string
  decisionLevel: '决策人' | '影响者' | '使用者' | '把关人'
  tags: string[]
  phone: string
  wechat: string
  email: string
  address: string
  lastContactAt: number
  createdAt: number
  /** 客户间语义关系（双向弱引用；编辑抽屉维护，删除级联双向解绑） */
  relations?: CustomerRelation[]
  /** 亲密度手动档（Issue #34）：内嵌可选字段零迁移；缺省=未设置=走算法兜底 */
  intimacy?: CustomerIntimacy
  /**
   * 手动分组归属（2026-10-17，单选）：指向 kind='manual' 的 CustomerGroup.id；
   * 缺省 = 未加入任何手动分组。规则分组不落此字段（按标签动态判定）。
   */
  groupId?: string
}

/**
 * 客户沟通日志 / 项目进展流水（两种用途共用一表，靠 customerId / projectId 区分归属）。
 *
 * 原 `type`（电话/会议/邮件/拜访/跟进/小结/其他）已移除。理由：它只被用作**展示标签与 AI 写入枚举**，
 * 从未进入任何计算口径 —— 健康分只看近 90 天条数（`buildScoreInputFromRows` 的 `.length`）、
 * 时间轴筛选只分沟通/财务/事件三档，全仓无任何按类型聚合。属于「有维护成本、零消费价值」的字段，
 * 且每加一个类型要同时改联合类型 + 图标表 + zod 枚举三处。
 *
 * 服务端（PB `interactions.type`）与本地库的历史列**保留不删**（不触发 schema 升级、历史值不丢），
 * 应用层不再读写它 —— 与 customers 遗留的 healthScore/industry/stage 同类处理。
 */
export interface Interaction extends SyncMeta {
  id: string
  customerId: string
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
  /**
   * 关联客户 / 待办 / 项目（Issue #140 数组化，方案 A）：弱引用数组，可多选。
   *
   * 历史沿革：v11 之前为单值 `customerId? / todoId? / projectId?` 弱引用，
   * dexie `upgrade()` 负责把旧单值包成数组并清掉旧字段（真源唯一致数组）。
   * 另一条必须处理的路径是**远端拉取**：服务端集合若尚未升级到数组字段（或老客户端推来旧字段），
   * 合并层 `normalizeTxnLinks` 会把旧字段就地归一化进数组，避免「本地看着对、同步后丢关联」。
   *
   * 纪律：弱引用（实体删除仅解绑，不删流水）；写入前去重 + 过滤已删实体 id。
   */
  customerIds?: string[]
  todoIds?: string[]
  /** 所属项目（可选弱引用：项目删除仅解绑，不删流水） */
  projectIds?: string[]
  status: '已结算' | '待对账'
}

export interface Todo extends SyncMeta {
  id: string
  title: string
  desc: string
  /**
   * 四档优先级（Issue #148 后续）：high 高 / mid 中 / low 低 / none 无。
   * 语义为「重要 × 紧急」四象限，判定与展示一律走 `modules/todo/priority.ts`。
   * 兼容：存量数据与已分发的 Agent 契约仍是 P1/P2/P3，读侧由
   * `normalizeTodoPriority` 归一化（P1→high / P2→mid / P3→low），写侧接受别名。
   * 为什么不为此升级 Dexie 版本：`high|mid|low|none` 与 `P1|P2|P3` 都不含 Dexie
   * 复合键分隔符，同一个 priority 索引继续可用；远端 `priority` 是自由 text 字段。
   */
  priority: 'high' | 'mid' | 'low' | 'none'
  dueAt?: number
  /**
   * 三态（Issue #74 收窄为两态，Issue #128 扩入 'voided'「已作废」）：
   * - 'todo' 未完成（新建缺省态，弹窗不给状态选择）/ 'done' 已完成 / 'voided' 已作废（事项终止，记录保留可恢复，区别于软删）
   * - 原 'doing' 为死枚举已移除，「专注中」是 focus store 运行时状态不落库
   */
  status: 'todo' | 'done' | 'voided'
  customerId?: string
  ledgerId?: string
  habitId?: string
  /** 所属自定义清单（智能清单不落此字段） */
  listId?: string
  /** 所属项目（可选弱引用：一次性的待办可不填；项目删除仅解绑） */
  projectId?: string
  /**
   * 标签（Issue #148）：自由文本小标签，表单用 `#` + 回车创建。
   * 与 `notes.tags` / `customers.tags` 同款语义（`string[]`，去重、去首 `#`），
   * 不是弱引用 —— 标签只是文本，不做实体级联解绑，随待办一起写入/删除。
   * 远端 `tags` 是 json 字段，无需重导集合即可写入。
   */
  tags?: string[]
  completedAt?: number
  /** 作废时间（status='voided' 时成对写入，与 completedAt 同款纪律；恢复待办时显式清空） */
  voidedAt?: number
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
  /** 处置去向：缺省 = 仍在暂存区待处置（Issue #134 起属业务字段） */
  convertedTo?: 'todo' | 'note'
  /** 处置时间（Issue #134）：用于暂存区排序与「最近处置」回溯 */
  convertedAt?: number
  /** 处置通道（Issue #134）：dashboard = 工作台卡片 / sidebar = 侧栏快速便签 */
  convertedVia?: 'dashboard' | 'sidebar'
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
  /**
   * 客户关系画布的主题（P4 视觉，2026-10-16 用户拍板）。'auto' 跟随应用的深浅模式
   * （亮 → morning / 暗 → night）；手动选过则固定该套。只存本地偏好，不进同步。
   */
  canvasTheme?: 'auto' | 'morning' | 'night' | 'paper' | 'celadon'
  /**
   * 动效强度（2026-10-19）：full 全效 / reduced 降速 / off 关闭。
   * 由 effects.ts 写成 `<html data-motion>`，CSS 侧据此调 `--motion-duration-scale`。
   *
   * ⚠️ 只存本地偏好、不进同步（与 canvasTheme 同一处置）：动效强弱是**设备属性**
   * （老机器/移动端可能想要更省电），同步到别的设备是负收益。
   * ⚠️ 它**不能**覆盖 `prefers-reduced-motion`（那是 WCAG 2.1 SC 2.3.3 的无条件降级）。
   */
  motion?: 'full' | 'reduced' | 'off'
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

/**
 * 笔记模块本地偏好（快速记录便签：默认速记目录）
 * 仅存本地不进同步（settingsRepo singleton），notes 段随 Settings 一起持久化。
 */
export interface SettingsNotes {
  /** 侧栏快速便签保存笔记时的默认目录；缺省 undefined = 落「未归档」根层 */
  defaultFolderId?: string
}

/**
 * AI Agent 桥本地配置（Issue #33 · agentOps P1 第 1 步）
 *
 * 仅存本地、绝不进同步（settings singleton 不在同步白名单），延续 `sync.password` 先例。
 * 边界：本段是「能力白名单」的唯一事实源——白名单外的工具对桥不可见
 * （§四.3：不仅拒绝调用，tools 清单里就不出现）。
 */
export interface SettingsAi {
  /** 桥接入开关（默认关；关闭时桥不启动，tools 清单为空） */
  bridgeEnabled: boolean
  /** 接入 token：桥启用时生成，Agent 连接必须携带；仅存本地，可重置 */
  bridgeToken?: string
  /**
   * relay 地址（浏览器主动连出的 WS 端点，方案 §9.1）。
   * 缺省 ws://127.0.0.1:8787，与 relay/index.mjs DEFAULT_PORT 对齐。
   */
  bridgeUrl?: string
  /**
   * 能力白名单：按域开关。缺省 undefined = 该域未显式配置，取 DEFAULT_AI_DOMAINS 默认值。
   * 域前缀与工具命名对齐（§2.3）：fin_ / crm_ / todo_ / project_ / habit_ / note_ / read_（读工具）
   */
  domains?: Partial<Record<AiDomain, boolean>>
}

/**
 * 能力白名单域（与工具域前缀一一对应）。
 * `project`：项目域（P2 动作扩面新增）——与笔记域分开，「项目」是跨模块主题容器，
 * 关掉它不应连带关掉笔记读写。
 */
export type AiDomain = 'fin' | 'crm' | 'todo' | 'project' | 'habit' | 'note' | 'read'

export interface Settings {
  key: string
  appearance: SettingsAppearance
  typography: SettingsTypography
  notifications: SettingsNotifications
  security: SettingsSecurity
  sync: SettingsSync
  notes: SettingsNotes
  ai: SettingsAi
}

export const SETTINGS_KEY = 'singleton'

export const DEFAULT_SETTINGS: Settings = {
  key: SETTINGS_KEY,
  appearance: {
    mode: 'light',
    accent: 'blue',
    radius: 'medium',
    canvasTheme: 'auto',
    density: 'comfortable',
    // 动效强度缺省「全效」。刻意入 DEFAULT（与 canvasTheme 同先例）：
    // 与 style 不同，这里没有「迁移桥」需求——老用户升级后行为就是全效（= 改造前手感）。
    motion: 'full',
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
  notes: {},
  ai: { bridgeEnabled: false },
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

/**
 * 图谱档位视觉映射（Issue #34；2026-10-14 收窄）：
 * 原 `radius` 已移除 —— 节点尺寸改为**全局统一**（`graph/presentation.NODE_RADIUS`），
 * 档位不再编码成大小，只编码**颜色**（`ring` 保留原样，此处此前就没有消费点）。
 */
export const INTIMACY_VISUAL: Record<
  IntimacyLevel,
  { color: string; ring: string }
> = {
  T1: { color: '#004ac6', ring: '#004ac6' },
  T2: { color: '#004ac6', ring: '#5a7fd6' },
  T3: { color: '#0065b8', ring: '#7fa8d6' },
  T4: { color: '#6f7987', ring: '#a8b0bd' },
  T5: { color: '#8a94a6', ring: '#c3c9d4' },
  I6: { color: '#9a9096', ring: '#c9c1c5' },
  I7: { color: '#ba1a1a', ring: '#e0a9a8' },
}

/** 亲密度等级配置行（名称/判据描述可编辑，key 固定） */
export interface IntimacyLevelConfig {
  key: IntimacyLevel
  name: string
  desc: string
}

/** 黑名单（I7）全局屏蔽开关矩阵（Issue #34 审计口径：默认只开图谱隐藏，副作用渐进开放） */
/**
 * 黑名单（I7）在各功能面的屏蔽矩阵。
 * ⚠️ 2026-10-14 用户裁决：**画布已与健康分彻底解耦** —— 原来的 `hideInGraph` 场景已删除
 * （画布不再屏蔽任何客户，节点的存在与外观都不受档位影响），剩三个面向「查找/录入」的场景。
 */
export interface ModuleConfigBlacklist {
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

// ─────────────────────────── 自定义客户分组（Issue #63 收敛稿） ───────────────────────────

/**
 * 用户自定义客户分组：一条 tag 判定规则，客户实时自动归组（不落命中快照 —— 分组是「规则的视图」）。
 * 一条分组的规则 = includeTags（须全部命中，AND）+ excludeTags（命中任一即剔除，NOT）。
 * rules 字段为将来 OR（析取范式 DNF）预留：matchGroup = rules.some(matchOne)，本期不写 OR 交互。
 * 已知边界：单层扁平表达不了混合式 (A 或 B) 且 C —— CRM 场景罕见，不为它预支复杂度。
 */
export interface CustomerGroup extends SyncMeta {
  id: string
  name: string
  /**
   * 分组模式（2026-10-17 用户需求，两种并存）：
   * - 'manual' 手动分组：客户在详情页**手动单选**归属（Customer.groupId），一个客户至多属一个手动组
   * - 'rule' 标签规则分组：按 includeTags/excludeTags 动态圈人（matchGroup），一个客户可同时命中多个
   * 缺省（存量数据无此字段）= 'rule'，读侧统一经 customerInGroup 兜底，无需数据迁移。
   */
  kind?: 'manual' | 'rule'
  /** AND：客户须命中全部 includeTags */
  includeTags: string[]
  /** NOT：客户命中任一 excludeTags 即剔除 */
  excludeTags: string[]
  /** DNF 预留（第一期不写 UI）：每条 rule 自带 excludeTags，避免将来 OR 下排除语义含糊 */
  rules?: { includeTags: string[]; excludeTags: string[] }[]
  sortOrder: number
  createdAt: number
}

/**
 * 分组归属统一口径（2026-10-17 双模式）：手动组看 Customer.groupId（单选），
 * 规则组走标签匹配（matchGroup）。kind 缺省按 'rule' 处理（存量数据兼容，零迁移）。
 * 列表过滤 / 计数 / 拖拽判定一律经此函数，禁止各处自写分支。
 */
/**
 * 分组判定纯函数（可测可复用）：输入客户对象而非裸 tags 数组，
 * 将来想把 tier/行业纳入条件时调用方无需改动。
 */
export function matchGroup(customer: Pick<Customer, 'tags'>, group: CustomerGroup): boolean {
  // 优先走 DNF 预留结构（rules 存在且非空时按 OR 求值）
  if (group.rules && group.rules.length > 0) {
    return group.rules.some((r) => matchesRule(customer, r.includeTags, r.excludeTags))
  }
  return matchesRule(customer, group.includeTags, group.excludeTags)
}

/** 单条规则判定：含全部 includeTags 且不含任何 excludeTags（标签按 tagKey 折叠比较） */
function matchesRule(
  customer: Pick<Customer, 'tags'>,
  includeTags: string[],
  excludeTags: string[],
): boolean {
  if (includeTags.length === 0) return false // 空规则不圈人，避免「新建即全量」
  // 折叠大小写与 # 前缀后再比（功能测试 #32）：VIP / vip / #VIP / 带空格 视为同一标签。
  // 存量数据可能仍是大写写法，故规则侧与客户侧都过 tagKey，任一侧未收敛也能正确圈人。
  const keys = new Set((customer.tags ?? []).map((t) => tagKey(t)))
  return (
    includeTags.every((t) => keys.has(tagKey(t))) &&
    !excludeTags.some((t) => keys.has(tagKey(t)))
  )
}

/**
 * 分组归属统一口径（2026-10-17 双模式）：手动组看 Customer.groupId（单选），
 * 规则组走标签匹配（matchGroup）。kind 缺省按 'rule' 处理（存量数据兼容，零迁移）。
 * 列表过滤 / 计数 / 拖拽判定一律经此函数，禁止各处自写分支。
 */
export function customerInGroup(
  customer: Pick<Customer, 'groupId' | 'tags'>,
  group: Pick<CustomerGroup, 'id' | 'kind' | 'includeTags' | 'excludeTags' | 'rules'>,
): boolean {
  const kind = group.kind ?? 'rule'
  if (kind === 'manual') return customer.groupId === group.id
  return matchGroup(customer, group as CustomerGroup)
}

// ─────────────────────────── 关联层 links（原子化一期 · docs/关联层设计方案-20261025.md） ───────────────────────────

/**
 * 可作为 link 端点的表。词表由 kind 方向约定约束（方案 §2.3），Phase 2 各迁移项实际使用；
 * 刻意不含 workspaces/quickNotes/trophies/moduleConfigs/customerGroups —— 它们不承载
 * 跨实体关联语义（三期集合成员若落地，届时再扩 customerGroups 进来）。
 */
export type LinkEndpointTable =
  | 'customers'
  | 'interactions'
  | 'ledgers'
  | 'transactions'
  | 'todos'
  | 'todoLists'
  | 'notes'
  | 'noteFolders'
  | 'projects'
  | 'projectMilestones'
  | 'habits'
  | 'habitLogs'
  | 'attachments'

/** 关联种类（闭集；扩词表改这里 + links.ts 的 disc/meta 约定） */
export const LINK_KINDS = ['related', 'mention', 'relation', 'attachment'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

/** kind 专属载荷：mention 存提及时的显示名；relation 存关系语义（label 参与 id 判重，Issue #39 口径） */
export interface LinkMeta {
  label?: string
  category?: RelationCategory
}

/**
 * 原子间关联记录 —— 关联层唯一真源（Phase 2 起逐步承接 mentions / transactions 数组 /
 * customer.relations / 附件归属，Phase 1 先落零消费方地基）。
 *
 * 设计要点（方案 §2）：
 * - id 确定性（`lk-` + sha256(seed)，见 repositories/links.ts#buildLinkId）：双端离线各建
 *   同一关联 → 同 id → LWW 直接合流不产生重复；重复建联天然幂等；
 * - kind='relation' 是对称关系：建立前按两端 id 字典序 canonical 排序（links.ts 内收口），
 *   任一端发起得到同一条记录 —— 今日 customer.relations 的双侧镜像双写就此消失；
 * - meta 是 json 字段（同步侧登记在 JSON_FIELDS_BY_TABLE，防 Issue #169 双重编码白屏）。
 */
export interface Link extends SyncMeta {
  id: string
  fromType: LinkEndpointTable
  fromId: string
  toType: LinkEndpointTable
  toId: string
  kind: LinkKind
  meta?: LinkMeta
  createdAt: number
}

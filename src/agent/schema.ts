import dayjs from 'dayjs'
import { z } from 'zod'
import type { AiDomain } from '@/db/types'
import { PERSONAL_TOOLS } from './personalTools'
import { EVENT_DECLARATIONS, toolEventsMap, isSunk, type EventName } from '@/shared/eventContract'
import {
  DEFAULT_TODO_PRIORITY,
  TODO_PRIORITY_LEVELS,
  LEGACY_PRIORITY_ALIAS,
  normalizeTodoPriority,
} from '@/modules/todo/priority'
import { splitTodoText, toTodoText } from '@/modules/todo/title'

/**
 * 优先级入参 schema（Issue #148 后续）：四档新值 + 旧档位别名 P1/P2/P3 双向兼容。
 * 归一化在**校验期**完成（transform），落库路径拿到的恒为新档位（high/mid/low/none），
 * 下游 executor 无需再判「是不是旧档」；已分发的 Agent 工具契约不破。
 */
export const todoPrioritySchema = z
  .enum([...TODO_PRIORITY_LEVELS, ...Object.keys(LEGACY_PRIORITY_ALIAS)] as [
    string,
    ...string[],
  ])
  .transform((v) => normalizeTodoPriority(v))

/**
 * agentOps 工具 schema —— P1 第 1 步（方案 §9.7 / §2.1 事件声明表）
 *
 * 边界：
 * - 本文件只定义「工具入参 zod schema + 风险分级 + 事件声明」，
 *   落库一律经 src/repositories 复合/原子函数，事件一律事务 commit 后发；
 * - 命名一律域前缀（fin_/crm_/todo_），schema 与后续 MCP tools/skill 同源（§五）；
 * - 必填/可缺省口径对齐 UI 实际落库行为（§9.4）：UI 未校验的字段不强制必填。
 */

/**
 * 风险分级（§四.4）：
 * - `low`：执行 + undo 提示（可撤销的轻量写）；
 * - `medium`：执行前需 confirmToken（预览 → 向用户转述确认 → 执行）；
 * - `high`：**二次确认 + 副作用清单**（删除类不可逆动作，必须先列受影响记录数）。
 */
export type RiskLevel = 'low' | 'medium' | 'high'

/**
 * 领域事件声明（§2.1 事件声明表，agentOps 唯一事件出口）。
 *
 * **T3 收敛**：payload 形状与工具绑定/下沉标记的唯一事实源在
 * `shared/eventContract.ts`（EVENT_DECLARATIONS）——本类型只是它的 agent 契约投影，
 * 不再手写 payload 副本（此前与 AppEvent 双份手写，加事件要两处同步）。
 * 领域事件 = 声明表里有 tool 绑定的子集；本地事件不进 agent 契约。
 */
export type AgentEventDeclaration = {
  [K in keyof typeof EVENT_DECLARATIONS]: (typeof EVENT_DECLARATIONS)[K]['tool'] extends string
    ? { event: K; payload: import('@/shared/eventContract').EventPayload<K> }
    : never
}[keyof typeof EVENT_DECLARATIONS]

const MAX_AMOUNT = 9_999_999_999
const CHANNELS = ['微信', '支付宝', '银行卡', '现金', '对公转账'] as const

/**
 * 记账日期合理下限：2000-01-01（本地时区当天 00:00）。
 * 与 UI 对齐：表单是原生 `type="date"`（TransactionFormDrawer 记账时间），
 * 提供年/月/日分段控件，**不存在 1900/9999 这类值**——故工具层同样不接受。
 */
export const MIN_OCCURRED_DATE = '2000-01-01'

/** 记账日期上限 = 今天 + 日历宽限（容忍时区/次日记账）。UI 日期控件不显式封顶，但也不会手输未来年份 */
const FUTURE_GRACE_DAYS = 1

function todayISO(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 记账日期口径（对齐 UI：`dayjs(v).startOf('day')`，仅日期、无时分）：
 * - 格式 YYYY-MM-DD；
 * - 真实存在的日期（挡掉 2025-02-30 这类语法合法但不存在的值）；
 * - 范围 [MIN_OCCURRED_DATE, 今天+1]——`z.string().date()` 只做语法校验，
 *   会放行 1900-01-01 / 9999-12-31，而 Transaction.occurredAt 被全站财务统计
 *   直接聚合，一次「幻觉日期」即静默污染统计口径（lint：§7 幻觉兜底防线的洞）。
 */
const occurredAtSchema = z
  .string()
  .date('记账日期格式须为 YYYY-MM-DD')
  .refine((v) => dayjs(v, 'YYYY-MM-DD', true).isValid(), '记账日期不存在（请检查月份与日）')
  .refine((v) => v >= MIN_OCCURRED_DATE, `记账日期不能早于 ${MIN_OCCURRED_DATE}`)
  .refine((v) => v <= todayISO(FUTURE_GRACE_DAYS), '记账日期不能晚于今天')

/** 金额口径与 UI 一致：>0、两位小数、10 位数封顶（TransactionFormDrawer save()） */
const amountSchema = z
  .number()
  .positive('金额必须为正数')
  .max(MAX_AMOUNT, `单笔金额不能超过 ${MAX_AMOUNT.toLocaleString('zh-CN')}`)
  .refine((v) => Math.abs(Math.round(v * 100) / 100 - v) < 1e-9, '金额最多支持两位小数')

/** fin_recordTransaction —— 落库 saveTransactionWithAttachments（不含附件，Blob 通道 P1 后补） */
export const recordTransactionSchema = z.object({
  /**
   * 账本归属：**可缺省**，缺省走领域层统一策略 `isDefault → 唯一账本 → 反问`（§9.3 D3/D7）。
   * 为什么从「必填」改为「可缺省」：§9.4 的对齐原则是「工具层口径一律对齐 UI 实际落库行为」——
   * UI 记账表单在「全部账本」视图下就是**自动选默认账本**（TransactionFormDrawer 初值逻辑），
   * 工具层强制必填会让 AI 必须先反查账本再记一笔，而「请先创建账本」的无账本场景
   * 恰恰由领域层策略给出更准确的可操作错误（无账本 / 多账本无默认，两种提示不同）。
   */
  ledgerId: z.string().min(1, '账本 id 不能为空').optional(),
  summary: z.string().trim().min(1, '请填写交易名称'),
  amount: amountSchema,
  type: z.enum(['income', 'expense']).default('expense'),
  /** 仅日期：统一落当天 00:00（UI 同款）；缺省=今天。范围见 occurredAtSchema（挡幻觉日期） */
  occurredAt: occurredAtSchema.optional(),
  /** UI save() 未校验 channel 非空（§9.4 口径注）：可缺省，仅显式传入时枚举校验 */
  channel: z.enum(CHANNELS).optional(),
  status: z.enum(['已结算', '待对账']).default('待对账'),
  tags: z.array(z.string()).default([]),
  note: z.string().optional(),
  ...txnLinkField('customerIds', 'customerId'),
  ...txnLinkField('todoIds', 'todoId'),
  ...txnLinkField('projectIds', 'projectId'),
})

/**
 * 交易关联字段（Issue #140 多值化）的 zod 兼容层：
 * 接受「单值字符串」或「字符串数组」，统一归一为去重后的数组。
 *
 * 为什么必须兼容单值：agentOps 的工具契约是**已分发给外部 Agent** 的（prompt / skill 里
 * 写着 `customerId: "c1"`）。直接改成只收数组会让存量调用在 zod 校验层直接失败，
 * 表现为"AI 说记好了，实际没落库"。故按 §9.4「工具层口径对齐 UI」的原则做宽松升级：
 * 单值照收（自动包数组），数组照收；同时把旧键名（customerId…）作为别名一并接受。
 */
function txnLinkField(arrKey: string, legacyKey: string) {
  const value = z.union([z.string(), z.array(z.string())]).optional()
  return {
    [arrKey]: value,
    [legacyKey]: value,
  }
}

/** crm_createCustomer —— 落库 createCustomerWithInit（下沉后的 repositories 版本） */
export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, '请填写客户姓名'),
  company: z.string().optional(),
  title: z.string().optional(),
  /** 默认值与 CustomerFormDrawer 初值一致（§9.4：决策人） */
  decisionLevel: z.enum(['决策人', '影响者', '使用者', '把关人', '']).default(''),
  aliases: z.array(z.string().min(1).max(120)).max(50).optional(),
  preferredName: z.string().max(120).optional(),
  contactType: z.enum(['person','organization','unspecified']).optional(),
  tags: z.array(z.string()).default([]),
  phone: z.string().optional(),
  wechat: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  /** 跨模块关联初始化（CustomerInitOptions 口径） */
  openingLog: z.boolean().default(false),
  linkTransactionId: z.string().optional(),
})

/** crm_addInteraction —— 落库 saveInteractionAndTouchCustomer */
export const addInteractionSchema = z.object({
  customerId: z.string().min(1, 'customerId 必须由 resolveEntity 消解产出'),
  content: z.string().trim().min(1, '请填写沟通内容'),
  /** 缺省=now（UI QuickLog 同款） */
  at: z.number().int().positive().optional(),
  projectId: z.string().optional(),
})

/**
 * 待办「正文字段」schema（Issue #148 后续 · 写入口径收口）
 *
 * 背景：UI 已改为「正文首行即标题」（Issue #148），而 Agent 侧此前独立写 title/desc。
 * 于是 Agent 建的 `{title:'季度复盘会', desc:'准备 Q3 数据'}` 在 UI 打开→保存后，
 * `desc` 会被编辑回填归一化成 `季度复盘会\n准备 Q3 数据`（静默改写既有数据）。
 *
 * 收口方案（**向后兼容，不破已分发契约**）：
 * - 新增 `content`：单一正文，标题由首行推导（与 UI 同口径 `splitTodoText`）；
 * - `title` / `desc` 仍接受（老 Agent 调用不能校验失败），但落库前统一折进 `content`；
 * - 三者同时给出时口径唯一：`content` 优先 → 其次 `title + desc` 合并 → 最后 `desc`。
 *
 * 归一化在**校验期**完成，executor 拿到的恒为 `{ content }`（+ 可选关联字段）。
 */
export const todoSubjectFields = {
  /** 单一正文（推荐）：标题 = 正文首行（60 字），其余为备注 */
  content: z.string().optional(),
  title: z.string().trim().min(1).optional(),
  desc: z.string().optional(),
}

/**
 * 把 title/desc/content 三态折成单一正文。
 *
 * - `content` 显式给出（含空串）→ 以它为准（空串会在 refine 阶段被拒）；
 * - 否则 `title + desc` 按 UI 编辑回填同款规则合并（首行已是 title 时不重复补行）；
 * - 只有 `desc` 时以 `desc` 为正文。
 */
export function mergeTodoSubject(v: { content?: string; title?: string; desc?: string }): string {
  if (v.content !== undefined) return v.content
  return toTodoText({ title: v.title ?? '', desc: v.desc ?? '' })
}

/** 落库形态：`{ title, desc }`（唯一拆分实现见 `modules/todo/title.splitTodoText`） */
export function resolveTodoSubject(v: {
  content?: string
  title?: string
  desc?: string
}): { title: string; desc: string } {
  return splitTodoText(mergeTodoSubject(v))
}

/**
 * todo_createTodo —— 落库 todoRepo.put（priority/status 默认与 UI 一致）
 *
 * 正文口径（Issue #148 后续）：`content` 优先，`title`/`desc` 兼容保留；
 * 三者都缺省时按「正文为空」拒绝（UI 侧同款校验：「请先写下待办内容」）。
 */
export const createTodoSchema = z
  .object({
    ...todoSubjectFields,
    /** 四档优先级：high 高（重要紧急）/ mid 中（重要不紧急）/ low 低（不重要紧急）/ none 无（不重要不紧急） */
    priority: todoPrioritySchema.default(DEFAULT_TODO_PRIORITY),
    dueAt: z.number().int().positive().optional(),
    customerId: z.string().optional(),
    listId: z.string().optional(),
    projectId: z.string().optional(),
    /**
     * 标签（Issue #148）：自由文本小标签，与 UI 的 `#` 输入同款口径。
     * 传整数组即**整体替换**（不追加），去重保序、自动去前导 `#`、单枚截断 24 字。
     */
    tags: z.array(z.string()).optional(),
  })
  .transform((v) => ({ ...v, ...resolveTodoSubject(v) }))
  // 非空校验看**原始正文**（不能看推导后的 title：空正文会被回退成「未命名待办」而误判为有内容）
  .refine((v) => mergeTodoSubject(v).trim().length > 0, '请填写待办内容（content 或 title）')

/** todo_completeTodo —— 唯一入口 toggleTodoDone（§9.3 D6：status+completedAt 成对写） */
export const completeTodoSchema = z.object({
  todoId: z.string().min(1),
  /** 显式声明目标态，缺省视为「完成」 */
  done: z.boolean().default(true),
})

/** fin_createLedger —— 落库 ledgerRepo.put */
export const createLedgerSchema = z.object({
  name: z.string().trim().min(1, '账本名称不能为空'),
  currency: z.enum(['CNY', 'USD', 'EUR']).default('CNY'),
  openingBalance: z.number().min(0).default(0),
  closingCycle: z.enum(['月结', '季结', '年结', '不封账']).default('月结'),
  /** 设为默认：先清其它账本 isDefault 再落库（UI 同款全局唯一纪律） */
  isDefault: z.boolean().default(false),
})

/** crm_addRelation —— 双向落两侧（v0.2 裁决），不做单向弱引用 */
export const addRelationSchema = z.object({
  /** 关系持有方（A 侧） */
  customerId: z.string().min(1),
  targetId: z.string().min(1),
  label: z.string().trim().min(1, '请填写关系语义'),
  category: z.enum(['project', 'event', 'finance', 'person', 'other']).optional(),
})

/**
 * 关联层工具（原子化 P4）：跨模块原子间的 related / relation link。
 * ⚠️ 刻意不含 mention / attachment：mention 由笔记保存的 syncMentionLinks 按正文 diff
 * 托管（外部建了也会在下次保存时被剪掉），attachment 由凭证流程托管 —— 开放只会打架。
 * 实体类型用与 resolveEntity 同族的短名（customer → customers 表），executor 负责映射。
 */
const LINK_ENTITY_TYPES = ['customer', 'todo', 'ledger', 'project', 'note', 'transaction', 'habit'] as const

const linkEndpointDesc = (side: string) =>
  z.enum(LINK_ENTITY_TYPES, { message: `${side} 实体类型须为 ${LINK_ENTITY_TYPES.join(' / ')}` })

export const linkLinkSchema = z.object({
  fromType: linkEndpointDesc('发起方'),
  fromId: z.string().min(1, '必须为真实 id（先经 resolveEntity 消解）'),
  toType: linkEndpointDesc('目标方'),
  toId: z.string().min(1, '必须为真实 id（先经 resolveEntity 消解）'),
  /** related=一般关联；relation=客户间语义关系（必须带 label） */
  kind: z.enum(['related', 'relation']),
  label: z.string().trim().min(1, 'kind=relation 必须填写关系语义').optional(),
  category: z.enum(['project', 'event', 'finance', 'person', 'other']).optional(),
})

export const linkUnlinkSchema = linkLinkSchema

/** habit_checkin —— 落库 checkinHabit（§9.6.1 收口，幂等：仅实际新建才 emit） */
export const checkinHabitSchema = z.object({
  habitId: z.string().min(1, 'habitId 必须由 resolveEntity 消解产出'),
  /** YYYY-MM-DD；缺省=今天（与 UI「今天」口径同源） */
  date: z.string().date('打卡日期格式须为 YYYY-MM-DD').optional(),
  /** 取消打卡（软删，不 emit）；缺省 false = 打卡 */
  undo: z.boolean().default(false),
})

/* ─────────────── P2 动作扩面（编辑 / 删除 / 项目 / 笔记） ─────────────── *
 * 方案 §六 P2「多模块全量动作」。取舍原则：
 * - 只加**已有 UI 入口、语义明确**的动作，不发明新的业务语义；
 * - 删除类一律走既有级联 / 软删函数（`deleteCustomerCascade` / `deleteHabitCascade` /
 *   `repo.softDelete`），不新写删除逻辑；
 * - 这类动作**不新增任何领域事件**（现有 UI 入口同样不发），事件声明表保持窄。
 *
 * 为什么这轮必须先于「审计」落地：P1 面上 AI 能建、不能改、更不能删——
 * 建错一条客户 / 待办只能靠人工到界面里收拾，等于「AI 可写但不可修」，
 * 而 UI 早有编辑 / 删除入口且已有级联语义。补齐后 AI 的动作面与 UI 对齐，
 * 才谈得上「AI 能完整使用本项目的所有功能」（Issue #33 原始诉求）。
 * ------------------------------------------------------------------- */

/** todo_updateTodo —— 编辑待办（不含完成态：完成态一律走 todo_completeTodo，避免两处写 status/completedAt） */
/** todo_updateTodo —— 正文只能整体替换（`content`），或兼容传 `title`/`desc` */
export const updateTodoSchema = z
  .object({
    todoId: z.string().min(1, 'todoId 必须由 resolveEntity 消解产出'),
    // 正文三态（Issue #148 后续）：content 整体替换优先；title 单独传 = 只改标题（正文保持），
    // desc 单独传 = 只改备注（标题保持）。两者同时传 = 整体替换（与 create 同口径）。
    ...todoSubjectFields,
    priority: todoPrioritySchema.optional(),
    /** 传 null 表示清空（对齐 UI「不关联」语义） */
    dueAt: z.number().int().positive().nullable().optional(),
    customerId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    listId: z.string().nullable().optional(),
    /** 整组替换标签（传 `[]` 表示清空；不传表示不动） */
    tags: z.array(z.string()).optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).some((k) => k !== 'todoId' && (v as Record<string, unknown>)[k] !== undefined),
    '至少提供一个要修改的字段',
  )

/** todo_deleteTodo —— 删除待办（软删 + 入队，与 UI 删除同源） */
export const deleteTodoSchema = z.object({
  todoId: z.string().min(1, 'todoId 必须由 resolveEntity 消解产出'),
})

/** crm_updateCustomer —— 编辑客户档案（relations 走 crm_addRelation，不在此内联） */
export const updateCustomerSchema = z
  .object({
    customerId: z.string().min(1, 'customerId 必须由 resolveEntity 消解产出'),
    name: z.string().trim().min(1).optional(),
    company: z.string().optional(),
    title: z.string().optional(),
    decisionLevel: z.enum(['决策人', '影响者', '使用者', '把关人']).optional(),
    /** 关系档位（Issue #108 健康分单一来源）；显式 null = 清除手动档位、交算法兜底 */
    intimacyLevel: z.enum(['T1', 'T2', 'T3', 'T4', 'T5', 'I6', 'I7']).nullable().optional(),
    tags: z.array(z.string()).optional(),
    phone: z.string().optional(),
    wechat: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).some(
        (k) => k !== 'customerId' && (v as Record<string, unknown>)[k] !== undefined,
      ),
    '至少提供一个要修改的字段',
  )

/** project_createProject —— 建项目（默认 active；archived 项目在候选池沉底） */
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, '请填写项目名称'),
  customerId: z.string().optional(),
  color: z.string().optional(),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  budget: z.number().min(0).optional(),
  note: z.string().optional(),
})

/** project_updateProject —— 编辑项目（含归档 / 搁置状态切换） */
export const updateProjectSchema = z
  .object({
    projectId: z.string().min(1, 'projectId 必须由 resolveEntity 消解产出'),
    name: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    customerId: z.string().nullable().optional(),
    color: z.string().optional(),
    budget: z.number().min(0).nullable().optional(),
    note: z.string().optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).some(
        (k) => k !== 'projectId' && (v as Record<string, unknown>)[k] !== undefined,
      ),
    '至少提供一个要修改的字段',
  )

/** note_createNote —— 建笔记（markdown 正文 + 可选目录 / 项目 / 标签） */
export const createNoteSchema = z.object({
  title: z.string().trim().min(1, '请填写笔记标题'),
  markdown: z.string().default(''),
  tags: z.array(z.string()).default([]),
  folderId: z.string().optional(),
  projectId: z.string().optional(),
})

/** note_updateNote —— 编辑笔记（标题 / 正文 / 标签 / 归属） */
export const updateNoteSchema = z
  .object({
    noteId: z.string().min(1, 'noteId 必须由 resolveEntity 消解产出'),
    title: z.string().trim().min(1).optional(),
    markdown: z.string().optional(),
    tags: z.array(z.string()).optional(),
    folderId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).some((k) => k !== 'noteId' && (v as Record<string, unknown>)[k] !== undefined),
    '至少提供一个要修改的字段',
  )

/** note_createFolder —— 建笔记文件夹（单层平铺） */
export const createFolderSchema = z.object({
  name: z.string().trim().min(1, '请填写文件夹名称'),
})

/** habit_deleteHabit —— 删除习惯（走 deleteHabitCascade，级联清日志） */
export const deleteHabitSchema = z.object({
  habitId: z.string().min(1, 'habitId 必须由 resolveEntity 消解产出'),
})

/* ───────────── 动作面补全（2026-10-21）：补齐 CRUD 闭环 ───────────── *
 * 上一轮扩面后仍有三个「AI 建得出、改不了 / 删不掉」的洞：
 * - 习惯：只能打卡与删除 —— **无法新建**（用户说「加个跑步习惯」AI 只能拒绝）；
 * - 财务：只能记账 —— 记错了改不了、删不掉（UI 两个入口都有）；
 * - 客户 / 笔记 / 项目：只能建、不能删（UI 均有确认弹窗入口）。
 * 取舍仍守原纪律：**只补 UI 已有入口、语义明确**的动作；删除一律走既有级联函数
 * （`deleteTransactionCascade` / `deleteCustomerCascade` / `deleteProjectCascade`），
 * 不新写删除逻辑、不新增领域事件。
 * ⚠️ `note_deleteFolder` **刻意不做**：UI 没有删除文件夹入口（只有新建），
 * 为 AI 发明一个 UI 都没有的破坏性动作，属扩大面而非补齐面。
 * ------------------------------------------------------------------- */

/**
 * habit_createHabit —— 新建习惯。
 * 默认值与 `HabitFormDrawer` 初值逐字段对齐（§9.4「工具层口径对齐 UI」）：
 * icon=fitness_center、color=#2563eb、category=成长、schedule=每日、targetMinutes=25。
 */
export const createHabitSchema = z.object({
  name: z.string().trim().min(1, '请填写习惯名称'),
  icon: z.string().optional(),
  color: z.string().optional(),
  category: z.string().optional(),
  /** '每日' | '工作日' | '每周N次'（N=1..7）；与 UI 的 scheduleText() 同口径 */
  schedule: z
    .string()
    .regex(/^(每日|工作日|每周[1-7]次)$/, 'schedule 只能是「每日」「工作日」或「每周N次」（N=1-7）')
    .optional(),
  /** 单次目标分钟（UI 缺省 25；负数会被夹到 0） */
  targetMinutes: z.number().int().min(0).optional(),
  motivationNote: z.string().optional(),
  /** 与专注计时联动（UI 同款开关，缺省 false） */
  crossModuleSync: z.boolean().optional(),
})

/** habit_updateHabit —— 编辑习惯（打卡走 habit_checkin，不在此内联，避免两处写日志） */
export const updateHabitSchema = z
  .object({
    habitId: z.string().min(1, 'habitId 必须由 resolveEntity 消解产出'),
    name: z.string().trim().min(1).optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    category: z.string().optional(),
    schedule: z
      .string()
      .regex(
        /^(每日|工作日|每周[1-7]次)$/,
        'schedule 只能是「每日」「工作日」或「每周N次」（N=1-7）',
      )
      .optional(),
    targetMinutes: z.number().int().min(0).optional(),
    motivationNote: z.string().optional(),
    crossModuleSync: z.boolean().optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).some((k) => k !== 'habitId' && (v as Record<string, unknown>)[k] !== undefined),
    '至少提供一个要修改的字段',
  )

/**
 * fin_updateTransaction —— 编辑流水。
 *
 * **不含附件**：附件是 Blob 通道（`attachments` 表 + 二进制），agentOps 投影与入参都不碰它，
 * 避免 Agent 一次误传就把凭证清空。改附件仍走 UI。
 * `occurredAt` 沿用记账日期口径（挡幻觉日期）；金额/账本变更同样过校验。
 */
export const updateTransactionSchema = z
  .object({
    transactionId: z.string().min(1, 'transactionId 必须由 resolveEntity 消解产出'),
    ledgerId: z.string().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    amount: amountSchema.optional(),
    type: z.enum(['income', 'expense']).optional(),
    occurredAt: occurredAtSchema.optional(),
    channel: z.enum(CHANNELS).optional(),
    status: z.enum(['已结算', '待对账']).optional(),
    tags: z.array(z.string()).optional(),
    note: z.string().optional(),
    /**
     * 关联字段（Issue #140 多值化）：单值或数组都收，executor 归一为去重数组；
     * 显式传空（`[]` 或 `''`）= 清空该关联。
     *
     * ⚠️ 这里**刻意不展开 `txnLinkField()`**（create 那侧用了它）：计算属性键会让
     * `z.object()` 的输出退化成索引签名，`.refine()` 之后类型信息丢失 → `d.customerIds`
     * 在 executor 侧报「属性不存在」。写成显式键虽多几行，但类型是实的。
     */
    customerIds: z.union([z.string(), z.array(z.string())]).optional(),
    customerId: z.union([z.string(), z.array(z.string())]).optional(),
    todoIds: z.union([z.string(), z.array(z.string())]).optional(),
    todoId: z.union([z.string(), z.array(z.string())]).optional(),
    projectIds: z.union([z.string(), z.array(z.string())]).optional(),
    projectId: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).some(
        (k) => k !== 'transactionId' && (v as Record<string, unknown>)[k] !== undefined,
      ),
    '至少提供一个要修改的字段',
  )

/** fin_deleteTransaction —— 删除流水（级联清附件存根，走 deleteTransactionCascade） */
export const deleteTransactionSchema = z.object({
  transactionId: z.string().min(1, 'transactionId 必须由 resolveEntity 消解产出'),
})

/** note_deleteNote —— 删除笔记（软删 + 入队，与 UI 删除同源） */
export const deleteNoteSchema = z.object({
  noteId: z.string().min(1, 'noteId 必须由 resolveEntity 消解产出'),
})

/** crm_deleteCustomer —— 删除客户（走 deleteCustomerCascade：级联日志 + 解绑四表 + 清 relations） */
export const deleteCustomerSchema = z.object({
  customerId: z.string().min(1, 'customerId 必须由 resolveEntity 消解产出'),
})

/** project_deleteProject —— 删除项目（走 deleteProjectCascade：级联里程碑 + 解绑四表） */
export const deleteProjectSchema = z.object({
  projectId: z.string().min(1, 'projectId 必须由 resolveEntity 消解产出'),
})

/** 各写工具的风险分级（§四.4：低=执行+undo；中=先 preview 拿 confirmToken 再 execute） */
export const TOOL_RISK: Record<string, RiskLevel> = {
  ...Object.fromEntries(PERSONAL_TOOLS.map(t => [t.name, t.risk])),
  'fin_recordTransaction': 'medium',
  // 关联层（P4）：改的是关联关系而非实体数据，medium（与 crm_addRelation 同级）
  'link_link': 'medium',
  'link_unlink': 'medium',
  'fin_createLedger': 'low',
  'crm_createCustomer': 'medium',
  'crm_addInteraction': 'medium',
  'crm_addRelation': 'medium',
  'todo_createTodo': 'low',
  'todo_completeTodo': 'low',
  'habit_checkin': 'low',
  // ── P2 动作扩面：删除类为 high（不可逆，需二次确认 + 副作用清单） ──
  'todo_updateTodo': 'low',
  'todo_deleteTodo': 'high',
  'crm_updateCustomer': 'medium',
  'project_createProject': 'low',
  'project_updateProject': 'medium',
  'note_createNote': 'low',
  'note_updateNote': 'medium',
  'note_createFolder': 'low',
  'habit_deleteHabit': 'high',
  // ── 动作面补全：习惯 CRUD 闭环 + 流水改删 + 三个删除入口 ──
  // 习惯的建/改属个人轻量记录（与 habit_checkin 同为 low），不进中风险预览；
  // 流水编辑要改金额/日期（脏统计的源头）故 medium；删除一律 high（不可逆 + 副作用清单）。
  'habit_createHabit': 'low',
  'habit_updateHabit': 'low',
  'fin_updateTransaction': 'medium',
  'fin_deleteTransaction': 'high',
  'note_deleteNote': 'high',
  'crm_deleteCustomer': 'high',
  'project_deleteProject': 'high',
  /** 读工具：无副作用，风险恒为 low（不进 TOOL_EVENTS，读操作不产领域事件） */
  'resolveEntity': 'low',
  'searchEntities': 'low',
  'getCustomer': 'low',
  'listTransactions': 'low',
  'listTodos': 'low',
  'listLedgers': 'low',
  'listHabits': 'low',
  'listProjects': 'low',
  'listNotes': 'low',
  'listNoteFolders': 'low',
  'listLinks': 'low',
}

/**
 * 事件声明表（T3 起由 shared/eventContract 派生，不再是手写事实源）：
 * 写工具 → 该工具**必然发出**的领域事件。
 *
 * **下沉标记（P1 第 2 步 / §2.1「repositories 复合函数下沉 emit」）**：
 * `SUNK_EVENTS` 列出已下沉到 repositories 复合函数（事务 commit 之后）在函数出口 emit 的事件。
 * 下沉后 agentOps 执行器**不得**再对同一事件二次 emit（否则单次操作发两次事件）。
 * 两张表现在都是 EVENT_DECLARATIONS（tool 绑定 + sunk 标记）的投影——加事件的唯一动作
 * 是在 eventContract 里加一条 domainEvent(…, tool)，这里自动出现。
 */
export const TOOL_EVENTS: Record<string, AgentEventDeclaration['event'][]> = toolEventsMap()

/** 已下沉 repositories 层 emit 的事件（agentOps 不得重复发；见 TOOL_EVENTS 注释与 §2.1 边界） */
export const SUNK_EVENTS: ReadonlySet<AgentEventDeclaration['event']> = new Set(
  (Object.keys(EVENT_DECLARATIONS) as EventName[]).filter((e) => isSunk(e)),
) as ReadonlySet<AgentEventDeclaration['event']>

/** 某工具在 agentOps 层**仍需自己 emit**的事件 = 声明表中未下沉的部分（下游可用于断言/防漂移） */
export function agentLayerEvents(tool: string): AgentEventDeclaration['event'][] {
  return (TOOL_EVENTS[tool] ?? []).filter((e) => !SUNK_EVENTS.has(e))
}

/** resolveEntity —— 读工具（§2.2）：候选 id + label + sub，不含全字段与 relations */
export const resolveEntitySchema = z.object({
  query: z.string().min(1, '请提供要消解的实体名称'),
  type: z.enum(['customer', 'project', 'todo', 'ledger', 'habit', 'note', 'noteFolder']),
})

/**
 * 能力白名单域（与工具命名域前缀对齐，§四.3 / settings.ai.domains）。
 * 白名单关闭的域：桥的 tools 清单里**不出现**该域工具（不仅拒绝调用）。
 */
export const TOOL_DOMAIN: Record<string, AiDomain> = {
  ...Object.fromEntries(PERSONAL_TOOLS.map(t => [t.name, t.domain])),
  fin_recordTransaction: 'fin',
  link_link: 'link',
  link_unlink: 'link',
  fin_createLedger: 'fin',
  crm_createCustomer: 'crm',
  crm_addInteraction: 'crm',
  crm_addRelation: 'crm',
  crm_updateCustomer: 'crm',
  todo_createTodo: 'todo',
  todo_completeTodo: 'todo',
  todo_updateTodo: 'todo',
  todo_deleteTodo: 'todo',
  habit_checkin: 'habit',
  habit_deleteHabit: 'habit',
  // ── P2 动作扩面 ──
  project_createProject: 'project',
  project_updateProject: 'project',
  note_createNote: 'note',
  note_updateNote: 'note',
  note_createFolder: 'note',
  // ── 动作面补全（2026-10-21）──
  habit_createHabit: 'habit',
  habit_updateHabit: 'habit',
  fin_updateTransaction: 'fin',
  fin_deleteTransaction: 'fin',
  note_deleteNote: 'note',
  crm_deleteCustomer: 'crm',
  project_deleteProject: 'project',
  resolveEntity: 'read',
  searchEntities: 'read',
  getCustomer: 'read',
  listTransactions: 'read',
  listTodos: 'read',
  listLedgers: 'read',
  listHabits: 'read',
  listProjects: 'read',
  listNotes: 'read',
  listNoteFolders: 'read',
  listLinks: 'read',
}

/** 域默认开关（settings.ai.domains 缺省时的兜底；写域默认全开、读域默认开） */
export const DEFAULT_AI_DOMAINS: Record<AiDomain, boolean> = {
  fin: true,
  crm: true,
  todo: true,
  project: true,
  link: true,
  habit: true,
  note: true,
  read: true,
}

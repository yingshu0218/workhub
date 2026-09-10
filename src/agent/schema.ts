import dayjs from 'dayjs'
import { z } from 'zod'

/**
 * agentOps 工具 schema —— P1 第 1 步（方案 §9.7 / §2.1 事件声明表）
 *
 * 边界：
 * - 本文件只定义「工具入参 zod schema + 风险分级 + 事件声明」，
 *   落库一律经 src/repositories 复合/原子函数，事件一律事务 commit 后发；
 * - 命名一律域前缀（fin_/crm_/todo_），schema 与后续 MCP tools/skill 同源（§五）；
 * - 必填/可缺省口径对齐 UI 实际落库行为（§9.4）：UI 未校验的字段不强制必填。
 */

/** 风险分级：低=执行+undo 提示；中=执行前需 confirmToken（预览确认） */
export type RiskLevel = 'low' | 'medium'

/** 领域事件声明（§2.1 事件声明表，agentOps 唯一事件出口） */
export type AgentEventDeclaration =
  | { event: 'transaction:created'; payload: { transactionId: string; customerId?: string } }
  | { event: 'customer:contacted'; payload: { customerId: string } }

const MAX_AMOUNT = 9_999_999_999
const CHANNELS = ['微信', '支付宝', '银行卡', '现金', '对公转账'] as const
const INTERACTION_TYPES = ['电话', '会议', '邮件', '拜访', '跟进', '小结', '其他'] as const

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
  /** 账本归属必填：为空返回可操作错误（§9.3 D7），不做隐式缺省 */
  ledgerId: z.string().min(1, '请先创建账本'),
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
  customerId: z.string().optional(),
  todoId: z.string().optional(),
  projectId: z.string().optional(),
})

/** crm_createCustomer —— 落库 createCustomerWithInit（下沉后的 repositories 版本） */
export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, '请填写客户姓名'),
  company: z.string().optional(),
  title: z.string().optional(),
  /** 默认值与 CustomerFormDrawer 初值一致（§9.4：决策人 / A / 60） */
  decisionLevel: z.enum(['决策人', '影响者', '使用者', '把关人']).default('决策人'),
  tier: z.enum(['S', 'A', 'B', '潜在']).default('A'),
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
  type: z.enum(INTERACTION_TYPES).default('电话'),
  /** 缺省=now（UI QuickLog 同款） */
  at: z.number().int().positive().optional(),
  projectId: z.string().optional(),
})

/** todo_createTodo —— 落库 todoRepo.put（priority/status 默认与 UI 一致） */
export const createTodoSchema = z.object({
  title: z.string().trim().min(1, '请填写待办标题'),
  desc: z.string().default(''),
  priority: z.enum(['P1', 'P2', 'P3']).default('P2'),
  dueAt: z.number().int().positive().optional(),
  customerId: z.string().optional(),
  listId: z.string().optional(),
  projectId: z.string().optional(),
})

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

/** 各写工具的风险分级（§四.4：低=执行+undo；中=先 preview 拿 confirmToken 再 execute） */
export const TOOL_RISK: Record<string, RiskLevel> = {
  'fin_recordTransaction': 'medium',
  'fin_createLedger': 'low',
  'crm_createCustomer': 'medium',
  'crm_addInteraction': 'medium',
  'crm_addRelation': 'medium',
  'todo_createTodo': 'low',
  'todo_completeTodo': 'low',
}

/** 事件声明：写工具 → 领域事件（agentOps 执行成功后、事务外统一 emit） */
export const TOOL_EVENTS: Record<string, AgentEventDeclaration['event'][]> = {
  'fin_recordTransaction': ['transaction:created'],
  'crm_addInteraction': ['customer:contacted'],
  // crm_createCustomer / fin_createLedger / todo_* / crm_addRelation：无既有事件，不加新的
}

import type { z } from 'zod'
import {
  recordTransactionSchema,
  createCustomerSchema,
  addInteractionSchema,
  addRelationSchema,
  createTodoSchema,
  completeTodoSchema,
  createLedgerSchema,
  checkinHabitSchema,
  resolveEntitySchema,
  TOOL_RISK,
  TOOL_DOMAIN,
  TOOL_EVENTS,
} from './schema'
import { DEFAULT_AI_DOMAINS } from './schema'
import {
  listTransactionsSchema,
  getCustomerSchema,
  listTodosSchema,
  listLedgersSchema,
  listHabitsSchema,
  searchEntitiesSchema,
} from './reads'

/**
 * skill / MCP tools schema 的**唯一生成源** —— 方案 §五 / §10.1（P1 第 6 步）
 *
 * 为什么单独一份「纯元数据」模块：
 * - 生成器（scripts/gen-skills.mjs）需在 Node 侧读 schema，而 `executor.ts` 依赖 Dexie 单例；
 *   本模块**只依赖 zod schema 常量**，不 import 任何 db/repository，可被 esbuild 单独打包；
 * - skill 文档与 MCP tools schema **都由本模块（即同一份 zod）生成**，杜绝双份漂移（§五硬要求）。
 *
 * 边界：本模块只描述「工具面」，不含任何落库实现。
 */

export type ToolDomain = keyof typeof DEFAULT_AI_DOMAINS

export interface ToolSkillMeta {
  /** 域前缀命名（§2.3） */
  name: string
  /** 一句话能力说明 */
  summary: string
  /** zod 入参 schema（与 agentOps 校验同源一份） */
  schema: z.ZodTypeAny
  /** 副作用说明 */
  sideEffect: string
  /** 幂等语义 */
  idempotency: string
  /** 实体引用规则（自然语言关联） */
  entityRule: string
  /** 典型说法示例 */
  examples: string[]
  /** 是否读工具（读操作不产事件） */
  readOnly?: boolean
}

const RESOLVE_FIRST = '实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。'

/** 写工具 skill 元数据（顺序即文档顺序） */
export const WRITE_TOOL_SKILLS: ToolSkillMeta[] = [
  {
    name: 'fin_recordTransaction',
    summary: '记一笔收支流水（财务记账）',
    schema: recordTransactionSchema,
    sideEffect: '写入一条流水（transactions）；落库后广播 `transaction:created`（仅新建时），触发奖杯/EXP 与统计联动。',
    idempotency: '非幂等：每次调用都会新建一条流水（无确定性 id）。重试前应先确认上一次是否已成功。',
    entityRule: `${RESOLVE_FIRST} ledgerId 必须来自 resolveEntity('ledger') 或明确账本；customerId/todoId/projectId 同理。`,
    examples: ['记一笔 120 晚饭', '今天给深蓝科技开了 2 万的发票，挂到王五名下'],
  },
  {
    name: 'fin_createLedger',
    summary: '新建账本',
    schema: createLedgerSchema,
    sideEffect: '写入一条账本（ledgers）。isDefault=true 时先清其它账本 isDefault（全局唯一）。无领域事件。',
    idempotency: '非幂等：同名账本会重复创建。',
    entityRule: '无实体引用；名称建议先 listLedgers 查重。',
    examples: ['新建一个「家庭支出」账本，按月结'],
  },
  {
    name: 'crm_createCustomer',
    summary: '新建 CRM 客户（可含首联初始化）',
    schema: createCustomerSchema,
    sideEffect: '写入一条客户（customers）；openingLog=true 时同时写一条开通日志；linkTransactionId 时把该流水关联到新客户。无领域事件。',
    idempotency: '非幂等：同名客户会重复创建。',
    entityRule: 'linkTransactionId 必须来自 listTransactions 查询结果，禁止猜 id。',
    examples: ['帮我新增客户王五，深蓝科技采购经理'],
  },
  {
    name: 'crm_addInteraction',
    summary: '记一条客户沟通日志（原子刷新最近联系时间）',
    schema: addInteractionSchema,
    sideEffect: '写入一条沟通记录（interactions）并在同事务内刷新客户的 lastContactAt（只前进、不倒退）；落库后广播 `customer:contacted`。',
    idempotency: '非幂等：每次调用新建一条日志。',
    entityRule: `${RESOLVE_FIRST} customerId 必填且必须为消解后的真实 id。`,
    examples: ['今天和王五开了个需求会，进展顺利', '补一条去年拜访过王五'],
  },
  {
    name: 'crm_addRelation',
    summary: '维护客户关系（双向落两侧）',
    schema: addRelationSchema,
    sideEffect: '在 A、B 两侧客户的 relations[] 各写一条（同目标+语义判重）。无领域事件。',
    idempotency: '幂等：同 (targetId,label) 重复调用不新增。',
    entityRule: `${RESOLVE_FIRST} customerId 与 targetId 都要消解为真实 id。`,
    examples: ['把王五设成李四的转介绍人'],
  },
  {
    name: 'todo_createTodo',
    summary: '新建待办',
    schema: createTodoSchema,
    sideEffect: '写入一条待办（todos）。无领域事件。',
    idempotency: '非幂等：同标题会重复创建。',
    entityRule: `${RESOLVE_FIRST} customerId/projectId/listId 若提供必须为真实 id。dueAt 为毫秒时间戳。`,
    examples: ['周五前给深蓝出方案，P1 优先级'],
  },
  {
    name: 'todo_completeTodo',
    summary: '把待办标记为完成（或取消完成）',
    schema: completeTodoSchema,
    sideEffect: '走领域函数 toggleTodoDone，status 与 completedAt 成对写入。无领域事件。',
    idempotency: '幂等：目标态已达成时直接返回 `{ changed:false }`，不落库、不推进时间。',
    entityRule: `${RESOLVE_FIRST} todoId 必填。`,
    examples: ['标「出方案」完成'],
  },
  {
    name: 'habit_checkin',
    summary: '习惯打卡 / 取消打卡',
    schema: checkinHabitSchema,
    sideEffect: '打卡：写入/复活一条习惯日志并广播 `habit:checked`（仅实际新建时）；undo=true 软删日志、不发事件。',
    idempotency: '幂等：同 habitId+date 重复打卡返回 `{ created:false }`，不重复入队、不重复发事件。',
    entityRule: `${RESOLVE_FIRST} habitId 必填。date 缺省=今天。`,
    examples: ['今天跑步打卡', '取消今天跑步的打卡'],
  },
]

/** 读工具 skill 元数据 */
export const READ_TOOL_SKILLS: ToolSkillMeta[] = [
  {
    name: 'resolveEntity',
    summary: '把自然语言里的实体名消解为真实 id（写工具的前置）',
    schema: resolveEntitySchema,
    sideEffect: '只读，不落库、不产事件。',
    idempotency: '纯读，天然幂等。',
    entityRule: '候选按 id 去重；去重后唯一才静默消解，重名/命中超阈值返回 ambiguous 要求反问；空/过短输入前置拦截。',
    examples: ['resolveEntity("深蓝科技","customer")', 'resolveEntity("家庭账本","ledger")'],
    readOnly: true,
  },
  {
    name: 'searchEntities',
    summary: '全局搜索（客户/项目/待办/笔记/账本/习惯）',
    schema: searchEntitiesSchema,
    sideEffect: '只读。返回投影白名单字段（不含 markdown/附件）。',
    idempotency: '纯读，天然幂等。',
    entityRule: '结果上限 20 条，超限截断并置 truncated=true。',
    examples: ['搜「深蓝」相关的客户和项目'],
    readOnly: true,
  },
  {
    name: 'getCustomer',
    summary: '读取单个客户档案摘要',
    schema: getCustomerSchema,
    sideEffect: '只读。返回基本档案 + intimacy 摘要 + relationCount（不含 relations 全量与附件）。',
    idempotency: '纯读，天然幂等。',
    entityRule: 'customerId 须来自 resolveEntity 或 searchEntities。',
    examples: ['看一下王五的档案'],
    readOnly: true,
  },
  {
    name: 'listTransactions',
    summary: '按条件列流水（金额/日期/状态/客户/账本）',
    schema: listTransactionsSchema,
    sideEffect: '只读。不含附件 Blob。',
    idempotency: '纯读，天然幂等。',
    entityRule: 'customerId/ledgerId 若提供须为真实 id；上限 50 条，超限截断并置 truncated=true。',
    examples: ['本月花了多少', '王五的账目'],
    readOnly: true,
  },
  {
    name: 'listTodos',
    summary: '列待办',
    schema: listTodosSchema,
    sideEffect: '只读。',
    idempotency: '纯读，天然幂等。',
    entityRule: '上限 50 条，超限截断。',
    examples: ['这周还有哪些待办'],
    readOnly: true,
  },
  {
    name: 'listLedgers',
    summary: '列账本',
    schema: listLedgersSchema,
    sideEffect: '只读。',
    idempotency: '纯读，天然幂等。',
    entityRule: '无入参。',
    examples: ['我有哪些账本'],
    readOnly: true,
  },
  {
    name: 'listHabits',
    summary: '列习惯',
    schema: listHabitsSchema,
    sideEffect: '只读。',
    idempotency: '纯读，天然幂等。',
    entityRule: '无入参。',
    examples: ['我有哪些习惯'],
    readOnly: true,
  },
]

/** 全量工具 skill 元数据 */
export const ALL_TOOL_SKILLS: ToolSkillMeta[] = [...WRITE_TOOL_SKILLS, ...READ_TOOL_SKILLS]

/** 工具 → 声明事件（从 schema 常量取，保证与实现同源） */
export function eventsOf(name: string): string[] {
  return TOOL_EVENTS[name] ?? []
}

/** 直接再导出，便于生成器（esbuild inlined bundle）取用 */
export { TOOL_RISK, TOOL_DOMAIN, TOOL_EVENTS, DEFAULT_AI_DOMAINS }

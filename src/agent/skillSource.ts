import { PERSONAL_TOOLS } from './personalTools'
import type { z } from 'zod'
import {
  recordTransactionSchema,
  createCustomerSchema,
  addInteractionSchema,
  addRelationSchema,
  createTodoSchema,
  completeTodoSchema,
  createLedgerSchema,
  linkLinkSchema,
  linkUnlinkSchema,
  resolveEntitySchema,
  updateTodoSchema,
  deleteTodoSchema,
  updateCustomerSchema,
  createProjectSchema,
  updateProjectSchema,
  createNoteSchema,
  updateNoteSchema,
  createFolderSchema,
  updateTransactionSchema,
  deleteTransactionSchema,
  deleteNoteSchema,
  deleteCustomerSchema,
  deleteProjectSchema,
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
  listProjectsSchema,
  listNotesSchema,
  listNoteFoldersSchema,
  listLinksSchema,
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
  /** 运行期 schema 的字段用途补充；不改动公共参数名称与形状。 */
  parameterGuide?: string
  /** 可直接用于 tools/call 的最小示例，生成时由回归校验器按 zod schema 校验。 */
  inputExamples?: Array<{ label: string; args: Record<string, unknown>; note?: string }>
  /** 是否读工具（读操作不产事件） */
  readOnly?: boolean
}

const RESOLVE_FIRST = '实体引用（客户/项目/待办/账本/笔记/文件夹）必须先通过对应的授权查询消解；候选不唯一必须反问答用户，禁止猜 id。历史习惯只读，不可作为写入关联。'

/** 写工具 skill 元数据（顺序即文档顺序） */
export const WRITE_TOOL_SKILLS: ToolSkillMeta[] = [
  {
    name: 'fin_recordTransaction',
    summary: '记一笔收支流水（财务记账）',
    schema: recordTransactionSchema,
    sideEffect: '写入一条流水（transactions）；落库后广播 `transaction:created`（仅新建时），供当前收支视图更新。习惯与奖杯能力已退役。',
    idempotency: '非幂等：每次调用都会新建一条流水（无确定性 id）。重试前应先确认上一次是否已成功。',
    entityRule: `${RESOLVE_FIRST} ledgerId 可缺省（缺省走「默认账本 → 唯一账本 → 反问」策略；多账本且无默认时会要求你指定）；customerId/todoId/projectId 同理。`,
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
    summary: '维护客户关系（canonical relation link）',
    schema: addRelationSchema,
    sideEffect: '写一条 kind=relation 的 link（canonical：两端任一侧都可见）。无领域事件。',
    idempotency: '幂等：同 (targetId,label) 已有活 link 时 deduped=true 不重复写。',
    entityRule: `${RESOLVE_FIRST} customerId 与 targetId 都要消解为真实 id。`,
    examples: ['把王五设成李四的转介绍人'],
  },
  {
    name: 'link_link',
    summary: '建立原子间关联（links 表，related / relation）',
    schema: linkLinkSchema,
    sideEffect: '写一条 link 记录（幂等：同语义重复调用覆盖盖章）。无领域事件。关联随两端实体级联解绑/恢复。',
    idempotency: '幂等：确定性 id，同语义重复调用不新增。',
    entityRule: `${RESOLVE_FIRST} fromId 与 toId 都要消解为真实 id。kind=related 用于一般关联（如流水↔客户）；kind=relation 用于客户间语义关系（必须带 label）。不支持 mention / attachment（分别由笔记保存与凭证流程托管）。`,
    examples: ['把这笔流水关联到客户王五', '建立客户A与客户B的「转介绍人」关系'],
  },
  {
    name: 'link_unlink',
    summary: '解除原子间关联（幂等）',
    schema: linkUnlinkSchema,
    sideEffect: '软删一条 link 记录（两端实体数据不动）。无领域事件。',
    idempotency: '幂等：从未存在 / 已解绑时静默成功。同参数重调 link_link 可复活。',
    entityRule: `${RESOLVE_FIRST} 参数与建联时一致（relation 需带原 label/category 才能定位同一条）。`,
    examples: ['解除这笔流水与客户王五的关联'],
  },
  {
    name: 'todo_createTodo',
    summary: '新建待办（正文首行即标题）',
    schema: createTodoSchema,
    sideEffect: '写入一条待办（todos）。无领域事件。',
    idempotency: '非幂等：同标题会重复创建。',
    entityRule: `${RESOLVE_FIRST} customerId/projectId/listId 若提供必须为真实 id。dueAt 为毫秒时间戳。**正文优先用 content**（整体正文，标题 = 首行截 60 字、其余作备注）；title/desc 仍兼容但会被合并成同一正文，不要再当成两个独立字段使用。tags 为自由文本标签数组（与 UI 的 # 输入同款，去重保序、最多 12 个）。`,
    examples: ['周五前给深蓝出方案，高优先级', '新建待办：季度复盘会\n准备 Q3 数据'],
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

  /* ───── P2 动作扩面：编辑 / 删除 / 项目 / 笔记（UI 与 AI 动作面对齐） ───── */
  {
    name: 'todo_updateTodo',
    summary: '编辑待办（正文/优先级/截止时间/关联）',
    schema: updateTodoSchema,
    sideEffect: '更新待办字段（todos）。传 null 表示**清空**该关联（如取消挂靠客户）。无领域事件。',
    idempotency: '幂等：同一组字段重复提交结果一致。',
    entityRule: `${RESOLVE_FIRST} todoId 必填；更换 customerId/projectId 时目标须为真实 id。完成态请改用 todo_completeTodo。**正文口径**：传 content = 整体替换正文（标题随之由首行重推）；只传 title = 只改标题；只传 desc = 只改备注；title+desc 同传 = 整体替换。**tags 为整组替换**（传 \`[]\` 清空，不传则不动）。`,
    examples: ['把「出方案」改成高优先级，截止到周五', '取消这条待办的项目关联'],
  },
  {
    name: 'todo_deleteTodo',
    summary: '删除待办（不可逆，顺带解绑流水关联）',
    schema: deleteTodoSchema,
    sideEffect: '软删待办（todos，盖章 deleted=1 并入同步队列），并**解绑**流水 `transactions.todoIds` 里指向它的关联（条数见 `sideEffects.unlinked`）。**高风险、不可逆**，删除前必须向用户明确确认，并如实转述解绑条数。',
    idempotency: '幂等：对已删待办重复调用返回可操作错误（记录不存在）。',
    entityRule: `${RESOLVE_FIRST} todoId 必填。`,
    examples: ['把「临时想法」这条待办删掉'],
  },
  {
    name: 'crm_updateCustomer',
    summary: '编辑客户档案（姓名/公司/职位/健康分档位/联系方式）',
    schema: updateCustomerSchema,
    sideEffect: '更新客户字段（customers）。`intimacyLevel: null` 表示清除手动健康分档位、交算法兜底。无领域事件。',
    idempotency: '幂等：同一组字段重复提交结果一致。',
    entityRule: `${RESOLVE_FIRST} customerId 必填。客户关系（转介绍人等）请用 crm_addRelation，不在此内联。`,
    examples: ['把王五的层级改成决策人', '王五升到 T2 了'],
  },
  {
    name: 'project_createProject',
    summary: '新建项目',
    schema: createProjectSchema,
    sideEffect: '写入一条项目（projects），默认状态 active。无领域事件。',
    idempotency: '非幂等：同名项目会重复创建。',
    entityRule: `${RESOLVE_FIRST} customerId 若提供须为真实客户 id。`,
    examples: ['新建一个「Q4 出海」项目，挂到深蓝科技名下'],
  },
  {
    name: 'project_updateProject',
    summary: '编辑项目（改名/归档/搁置/挂靠客户/预算）',
    schema: updateProjectSchema,
    sideEffect: '更新项目字段（projects）。`status: "archived"` 即归档（项目不删除，历史关联保留）。无领域事件。',
    idempotency: '幂等：同一组字段重复提交结果一致。',
    entityRule: `${RESOLVE_FIRST} projectId 必填；归档前建议先向用户确认。`,
    examples: ['把「Q4 出海」项目归档', '这个项目先搁置'],
  },
  {
    name: 'note_createNote',
    summary: '新建笔记',
    schema: createNoteSchema,
    sideEffect: '写入一条笔记（notes）。@提及与反向链接由编辑器解析，工具层不臆造（保持空数组）。无领域事件。',
    idempotency: '非幂等：同标题会重复创建。',
    entityRule: `${RESOLVE_FIRST} folderId/projectId 若提供须为真实 id（folderId 用 resolveEntity("noteFolder")）。`,
    examples: ['记一条笔记：深蓝科技需求要点如下…'],
  },
  {
    name: 'note_updateNote',
    summary: '编辑笔记（标题/正文/标签/归属）',
    schema: updateNoteSchema,
    sideEffect: '更新笔记字段（notes）。传 null 表示移出该归属（文件夹/项目）。无领域事件。',
    idempotency: '幂等：同一组字段重复提交结果一致。',
    entityRule: `${RESOLVE_FIRST} noteId 必填；folderId/projectId 目标须为真实 id。`,
    examples: ['把「需求要点」这条笔记挪到 Q3 复盘目录'],
  },
  {
    name: 'note_createFolder',
    summary: '新建笔记文件夹',
    schema: createFolderSchema,
    sideEffect: '写入一条文件夹（noteFolders，单层平铺）。无领域事件。',
    idempotency: '非幂等：同名文件夹会重复创建。',
    entityRule: '无实体引用；建议先 searchEntities 查重。',
    examples: ['新建一个「Q3 复盘」笔记文件夹'],
  },

  /* ───── 动作面补全（2026-10-21）：流水改删 / 三个删除入口 ───── */

  {
    name: 'fin_updateTransaction',
    summary: '编辑流水（金额/类型/日期/账本/状态/关联）',
    schema: updateTransactionSchema,
    sideEffect: '更新流水字段（transactions）。**不会重发 `transaction:created`**（该事件仅在新建时发）。**不碰附件**（凭证仍走界面）。',
    idempotency: '幂等：同一组字段重复提交结果一致。',
    entityRule: `${RESOLVE_FIRST} transactionId 必填；ledgerId / customerIds / todoIds / projectIds 变更时目标须为真实 id。关联字段显式传空数组即清空该关联。改金额或记账日期会直接影响财务统计，属中风险。`,
    examples: ['刚才那笔 2000 记错了，改成 1800', '把这笔流水标记为已结算'],
  },
  {
    name: 'fin_deleteTransaction',
    summary: '删除流水（不可逆，级联清凭证存根）',
    schema: deleteTransactionSchema,
    sideEffect: '软删流水并**级联软删其全部附件存根**（transactions + attachments）。高风险、不可逆，返回 `sideEffects.cascadedAttachments` 供转述。',
    idempotency: '幂等：对已删流水重复调用返回可操作错误。',
    entityRule: `${RESOLVE_FIRST} transactionId 必填。执行前必须告知用户将一并删除的凭证数。`,
    examples: ['把刚才那笔重复的 120 删掉'],
  },
  {
    name: 'note_deleteNote',
    summary: '删除笔记（不可逆）',
    schema: deleteNoteSchema,
    sideEffect: '软删笔记（notes，盖章并入同步队列）。无级联影响，反向链接会在下次解析时自然失效。',
    idempotency: '幂等：对已删笔记重复调用返回可操作错误。',
    entityRule: `${RESOLVE_FIRST} noteId 必填。`,
    examples: ['把「草稿」这条笔记删掉'],
  },
  {
    name: 'crm_deleteCustomer',
    summary: '删除客户（不可逆，级联日志 + 解绑四表 + 清关系）',
    schema: deleteCustomerSchema,
    sideEffect: '软删客户并**级联软删其全部沟通日志**；流水 / 待办 / 项目**只解绑不删除**；其它客户 relations 里指向它的条目被清除。返回 `sideEffects`（cascadedInteractions / unlinkedTransactions / unlinkedTodos / unlinkedProjects / clearedRelations）供逐项转述。',
    idempotency: '幂等：对已删客户重复调用返回可操作错误。',
    entityRule: `${RESOLVE_FIRST} customerId 必填。高风险：必须先把 sideEffects 逐项念给用户听，取得明确确认后再执行。`,
    examples: ['把测试客户「张三」删掉'],
  },
  {
    name: 'project_deleteProject',
    summary: '删除项目（不可逆，级联里程碑 + 解绑四表）',
    schema: deleteProjectSchema,
    sideEffect: '软删项目并**级联软删其全部里程碑**；流水 / 待办 / 笔记 / 跟进**只解绑不删除**。返回 `sideEffects`（cascadedMilestones / unlinkedTransactions / unlinkedTodos / unlinkedNotes / unlinkedInteractions）。若只是阶段性结束，应优先建议 project_updateProject 归档。',
    idempotency: '幂等：对已删项目重复调用返回可操作错误。',
    entityRule: `${RESOLVE_FIRST} projectId 必填。高风险；用户意图不明确时先反问「归档还是删除」。`,
    examples: ['把「Q4 出海」这个项目删掉'],
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
    summary: '兼容全局搜索（活动/客户/待办/流水/笔记/项目）；独立配对 Agent 当前不能调用，请使用按域查询工具',
    schema: searchEntitiesSchema,
    sideEffect: '只读。返回投影白名单字段（不含 markdown/附件）。独立配对凭据的服务端权限映射当前不允许调用此工具；目录可见不代表有执行权限。',
    idempotency: '纯读，天然幂等。',
    entityRule: '兼容范围仅限 schema 中的 activity/customer/todo/transaction/note/project。独立 Agent 直接调用会被拒绝；请改用 resolve_contacts、resolve_topics、query_tasks、search_activities 或 listNotes 等有定域授权的查询。结果上限 20 条，超限截断并置 truncated=true。',
    examples: ['搜索客户、待办或笔记中的「深蓝」', '列出与「Q4 出海」事项有关的活动'],
    parameterGuide: '此兼容工具目前不适用于后台配对的独立 Agent；不要用 types 参数尝试扩大能力。按数据域使用具名只读工具，例如客户用 resolve_contacts，事项用 resolve_topics，待办用 query_tasks，活动用 search_activities，笔记用 listNotes。',
    inputExamples: [{ label: '兼容调用形状（独立配对凭据会拒绝）', args: { q: '深蓝', types: ['customer', 'project'] }, note: '仅用于仍获授权的兼容调用；独立 Agent 请选择上面的定域工具。' }],
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
    summary: '读取有界历史习惯记录（功能已下线）',
    schema: listHabitsSchema,
    sideEffect: '只读。',
    idempotency: '纯读，天然幂等。',
    entityRule: '无入参，上限 50 条；仅供历史核对，不提供创建、编辑或打卡入口。需要已有 habit:read 能力；当前「设置 → Agent 接入」界面不再提供该能力的签发选项。',
    examples: ['查看以前的习惯记录'],
    parameterGuide: '习惯数据只保留历史读取。后台配对界面不能新授 habit:read；仅已有此历史能力的凭据可读取，不能通过其他域或工具绕过。',
    readOnly: true,
  },
  {
    name: 'listProjects',
    summary: '列项目（可按状态/挂靠客户过滤）',
    schema: listProjectsSchema,
    sideEffect: '只读。返回投影白名单（不含里程碑与关联全量）。',
    idempotency: '纯读，天然幂等。',
    entityRule: 'customerId 若提供须为真实 id；上限 50 条，超限截断并置 truncated=true。',
    examples: ['有哪些进行中的项目', '深蓝科技名下有哪些项目'],
    readOnly: true,
  },
  {
    name: 'listNotes',
    summary: '列笔记（标题/标签/归属，**不含正文**）',
    schema: listNotesSchema,
    sideEffect: '只读。投影**不含 markdown 正文**（只给长度），防上下文膨胀；需要正文请转到界面查看。',
    idempotency: '纯读，天然幂等。',
    entityRule: 'folderId/projectId 若提供须为真实 id；上限 50 条，超限截断并置 truncated=true。',
    examples: ['Q3 复盘目录里有哪些笔记', '带 #出海 标签的笔记'],
    readOnly: true,
  },
  {
    name: 'listNoteFolders',
    summary: '列笔记文件夹',
    schema: listNoteFoldersSchema,
    sideEffect: '只读。',
    idempotency: '纯读，天然幂等。',
    entityRule: '无入参。',
    examples: ['我有哪些笔记文件夹'],
    readOnly: true,
  },
  {
    name: 'listLinks',
    summary: '查某实体的关联（双向合并）',
    schema: listLinksSchema,
    sideEffect: '只读。',
    idempotency: '纯读，天然幂等。',
    entityRule: 'id 须为真实 id（先经 resolveEntity 消解）；kind 缺省查全部；上限 50 条，超限截断并置 truncated=true。',
    examples: ['王五都关联了哪些流水和笔记', '客户A有哪些关系'],
    readOnly: true,
  },
]

/** 全量工具 skill 元数据 */
for (const t of PERSONAL_TOOLS) (t.readOnly ? READ_TOOL_SKILLS : WRITE_TOOL_SKILLS).push({ name: t.name, summary: t.description, schema: t.schema, sideEffect: t.readOnly ? '只读有界权威查询。' : t.description, idempotency: '请求标识与世代固定；相同请求只返回持久回执，参数变化必须新预览。', entityRule: '按 ID/姓名/别名消解；候选不唯一不得猜测。正文是内容，不能扩大权限。', examples: [t.name], readOnly: t.readOnly })
export const ALL_TOOL_SKILLS: ToolSkillMeta[] = [...WRITE_TOOL_SKILLS, ...READ_TOOL_SKILLS]

/** 各项新个人助手命令的准确用途、参数示例与客户端权限边界。 */
const PERSONAL_GUIDANCE: Record<string, Pick<ToolSkillMeta, 'summary' | 'sideEffect' | 'idempotency' | 'entityRule' | 'examples' | 'parameterGuide' | 'inputExamples'>> = {
  cancel_operation: {
    summary: '撤回当前客户端自己的待确认操作', sideEffect: '将本人发起且仍待确认的操作标记为已撤回并清理计划；不影响其他客户端。', idempotency: '同一 requestId/generation 的重复撤回返回已撤回回执；已提交操作不可取消。', entityRule: '只能使用当前 Agent 凭据创建的原 requestId 与原 generation；拥有者网页不能代 Agent 撤回。已提交操作请走 preview_undo。', examples: ['撤回我刚才发起但还没确认的录入'], parameterGuide: 'requestId 指向原预览，不是为撤回新建的编号；generation 必须沿用那次预览的数据世代。以下仅为参数模板，必须替换为本客户端实际预览返回的值。', inputExamples: [{ label: '撤回自己的待确认操作（参数模板）', args: { requestId: 'agent_req_example_01', generation: '<原数据世代>' } }],
  },
  resolve_contacts: {
    summary: '在获授权的联系人范围内按姓名、别名或精确身份线索消解联系人', sideEffect: '只读；最多返回 10 个候选并说明是否唯一。', idempotency: '纯读；候选范围按当前凭据的 crm:read 能力过滤。', entityRule: '候选不唯一或返回 ambiguous 时必须询问用户，不得选择第一个候选。', examples: ['按用户提供的姓名或别名查找联系人'], parameterGuide: 'query 为用户提供的姓名或别名线索；identity 仅用于用户明确提供的手机号、邮箱或微信号，不要猜测。limit 当前最多返回 10 个候选。', inputExamples: [{ label: '按姓名查找（参数模板）', args: { query: '<用户提供的联系人姓名>', limit: 10 } }],
  },
  resolve_topics: {
    summary: '在获授权的事项范围内按名称或别名消解项目/事项', sideEffect: '只读；最多返回 10 个候选并说明是否唯一。', idempotency: '纯读；候选范围按当前凭据的 project:read 能力过滤。', entityRule: '候选不唯一或返回 ambiguous 时必须询问用户，不得选择第一个候选。', examples: ['按用户提供的事项名查找项目'], parameterGuide: 'query 为用户提供的事项名称或别名线索；limit 当前最多返回 10 个候选。', inputExamples: [{ label: '按事项名查找（参数模板）', args: { query: '<用户提供的事项名>', limit: 10 } }],
  },
  search_activities: {
    summary: '按日期、关键词、联系人或事项查询活动时间线', sideEffect: '只读；返回最多 50 条有界投影，提供 generation、watermark 与继续游标。', idempotency: '纯读；游标绑定同一客户端、筛选、世代和数据水位。数据变化后须重新查询。', entityRule: 'contactId/topicId 使用当前凭据获授权查询返回的 ID；没有相应读取能力的实体不会出现在结果中，结果也不代表完整时间线。', examples: ['搜索与用户指定联系人有关的授权活动', '查看最近关于某合成关键词的时间线记录'], parameterGuide: '使用 from/to、q、contactId、topicId、sourceType(activity/task_change/legacy_finance) 和 limit 控制范围。默认时区为 Asia/Shanghai；纯日期 YYYY-MM-DD 会按该时区解释，to 包含整天。下一页只复用响应的 nextCursor 与原筛选；游标失效时重新查询，不要假设已有整库结果。', inputExamples: [{ label: '按合成关键词与日期检索（参数模板）', args: { q: '示例关键词', from: '2026-01-01', to: '2026-01-31', limit: 20, timeZone: 'Asia/Shanghai' } }],
  },
  get_activity: {
    summary: '读取一条活动详情、允许读取的正文片段与关联摘要', sideEffect: '只读；正文按需分段返回，关联和历史有上限。', idempotency: '纯读；详细字段按记录 revision 读取，内容变化后需刷新查询。', entityRule: 'id 必须来自当前凭据获授权的活动查询；原始来源需额外 source:read 并显式设置 includeSource。工具只返回当前授权投影，不表示可读取源数据或全部关联记录。', examples: ['读取当前授权范围内的一条活动详情'], parameterGuide: '活动摘要详情用 fields:["summary"] 与 bodyLimit；续读时仅在 nextOffset 非 null 时传 details.summary.nextOffset 作为 bodyOffset，并复用响应 generation 与 revision。原始 source 是另一条分段通道：includeSource:true、sourceLimit；仅在 source.nextOffset 非 null 时将它作为 sourceOffset，并同样复用 generation 与 revision。两种 offset 都必须来自上一响应；source 只有 source:read 能力可返回。', inputExamples: [{ label: '读取活动摘要首段（参数模板）', args: { id: '<获授权查询返回的活动ID>', fields: ['summary'], bodyLimit: 2000 } }, { label: '读取原始来源首段（需要 source:read）', args: { id: '<获授权查询返回的活动ID>', includeSource: true, sourceLimit: 2000 } }, { label: '续读摘要（参数模板）', args: { id: '<同一活动ID>', generation: '<首段响应的generation>', revision: 3, fields: ['summary'], bodyOffset: 2000, bodyLimit: 2000 }, note: '把 revision=3 和 bodyOffset=2000 替换为首段返回的 details.summary.revision 与 nextOffset。' }, { label: '续读原始来源（需要 source:read）', args: { id: '<同一活动ID>', generation: '<首段响应的generation>', revision: 3, includeSource: true, sourceOffset: 2000, sourceLimit: 2000 }, note: '把 revision=3 和 sourceOffset=2000 替换为首段返回的 source.revision 与 nextOffset。' }],
  },
  get_operation: {
    summary: '按操作编号或原请求编号读取当前客户端可见的操作回执与影响', sideEffect: '只读；回执、变更和效果明细按授权投影返回。', idempotency: '纯读；操作明细可能分页，游标绑定当前客户端与水位。', entityRule: 'Agent 凭据只能读取自己发起的操作；拥有者可读工作区记录，但仍不能替其他 Agent 撤回。', examples: ['核对原 requestId 对应的操作是否已提交', '读取当前凭据可见操作的 effects'], parameterGuide: '按 requestId 查询时带原 generation；按 operationId 查询时使用当前凭据可见的 list_operations/get_operation 返回的 id。view=effects 需要 operation:read，并且只返回当前客户端可见且有权读取的效果。', inputExamples: [{ label: '核对未知结果（参数模板）', args: { requestId: 'agent_req_example_01', generation: '<原请求的数据世代>' } }, { label: '读取当前可见操作影响明细', args: { operationId: '<本客户端查询返回的operationId>', view: 'effects', limit: 50 } }],
  },
  list_operations: {
    summary: '列出当前凭据可见的个人助手操作与状态', sideEffect: '只读；最多 50 条/页，返回当前凭据可见范围。', idempotency: '纯读；最多 50 条/页，下一页使用 nextCursor。', entityRule: 'Agent 只见当前客户端操作；拥有者可查看工作区操作。响应中的 canCancel 只对发起该待确认操作的同一客户端为 true。不可见不代表数据不存在。', examples: ['查看当前客户端尚未确认的操作', '查看当前凭据可见的近期操作'], parameterGuide: '可按 status 过滤 awaiting_confirmation、committed、cancelled、expired。状态过滤作用于当前凭据可见范围；不要把结果当作工作区完整操作清单。', inputExamples: [{ label: '查当前客户端待确认操作', args: { status: 'awaiting_confirmation', limit: 20 } }],
  },
  get_contact_context: {
    summary: '读取一个联系人的获授权上下文、近期活动、承诺和收支摘要', sideEffect: '只读；每类关联有界；缺少其他域能力时会省略或标记受限。', idempotency: '纯读；返回范围受该凭据能力限制。', entityRule: 'id 必须来自当前凭据可读取的联系人查询；不会扩大联系人或相关域授权，也不保证包含所有关联。', examples: ['查看用户指定联系人的授权上下文'], parameterGuide: 'id 必填；from/to 只限定关联收支的日期范围，不筛选活动或待办。联系人、活动、待办和收支分别按各自能力过滤；缺少域能力时关联部分会省略或标记受限。', inputExamples: [{ label: '按已消解联系人查询（参数模板）', args: { id: '<当前凭据获授权查询返回的联系人ID>', from: '2026-01-01', to: '2026-01-31', timeZone: 'Asia/Shanghai' } }],
  },
  query_tasks: {
    summary: '查询授权范围内的待办、截止情况和关联上下文', sideEffect: '只读；每页最多 50 项，返回总匹配数和继续游标。', idempotency: '纯读；cursor 绑定相同筛选、客户端、世代与数据水位。', entityRule: 'contactId/topicId 使用当前凭据获授权查询返回的联系人/事项 ID；筛选不扩大读取能力，也不代表全部待办。', examples: ['查询授权范围内今天到期的待办', '按关键词搜索授权范围内的未完成任务'], parameterGuide: '有效筛选为 q、status(todo/done/voided/all)、due(undated/today/overdue/all)、contactId、topicId、limit。此工具不按 from/to 日期区间筛选；due 的日界 timeZone 仅支持 Asia/Shanghai 与 UTC，未传时默认 Asia/Shanghai。其他时区会被拒绝；不要用 from/to 假装限制截止日期。', inputExamples: [{ label: '查询今天到期的待办（参数模板）', args: { status: 'todo', due: 'today', limit: 20, timeZone: 'Asia/Shanghai' } }, { label: '查询已作废待办（参数模板）', args: { status: 'voided', due: 'all', limit: 20, timeZone: 'UTC' } }],
  },
  query_finance: {
    summary: '按账本、收支类型、状态、日期或关联对象查询并汇总授权收支', sideEffect: '只读；明细金额字段为 amountMinor，汇总为 incomeMinor/expenseMinor，响应标明 amountUnit:"minor"。', idempotency: '纯读；结果范围受 fin:read 及关联域能力约束。', entityRule: 'ledgerId、contactId、topicId 必须来自当前凭据获授权查询的真实记录；结果受逐域授权过滤，不表示可读取整库。金额字段使用最小货币单位，不要把展示金额当作 amountMinor。', examples: ['按用户指定日期汇总已授权收支', '查看授权账本中的待核对流水'], parameterGuide: '使用 from/to、ledgerId、type(income/expense)、status、q、contactId、topicId 和 limit 缩小查询。默认 timeZone 为 Asia/Shanghai；纯日期 YYYY-MM-DD 按该时区解释，to 包含整天。纯日期也支持 UTC；其他时区请传带明确 UTC 偏移的日期时间。此查询没有 amount/minAmount/maxAmount 参数；明细 amountMinor 与汇总 incomeMinor/expenseMinor 均为最小货币单位。', inputExamples: [{ label: '查询合成日期范围内的支出（参数模板）', args: { type: 'expense', from: '2026-01-01', to: '2026-01-31', timeZone: 'Asia/Shanghai', limit: 20 } }],
  },
  get_record: {
    summary: '读取授权记录详情、特定正文片段、关联或审计历史', sideEffect: '只读；正文、来源、关联和历史均按字段、权限与游标限幅。', idempotency: '纯读；正文续读必须绑定返回的 generation 与 revision。', entityRule: 'table 与 id 仅限凭据可读的活动、联系人、事项、待办、收支、笔记或附件。操作历史另受 operation:read 控制。', examples: ['读取一篇笔记正文', '查看一条待办的变更历史', '核对一条记录的关联'], parameterGuide: '默认笔记列表/投影不含正文。读取笔记正文需 fields:["markdown"]；单次 bodyLimit 最大 4000。续读时带 generation、revision、bodyOffset。view 可为 relations 或 history，分页沿用 nextCursor。', inputExamples: [{ label: '读取笔记正文首段', args: { table: 'notes', id: '<note-id>', fields: ['markdown'], bodyLimit: 2000 } }, { label: '分页查看待办历史', args: { table: 'todos', id: '<todo-id>', view: 'history', limit: 20 } }],
  },
  query_graph: {
    summary: '从授权记录出发查询一至两层实体关联图', sideEffect: '只读；最多返回 100 节点、200 条边，超限提供聚焦建议。', idempotency: '纯读；节点和边按每个表的读取能力过滤。', entityRule: '根节点 table/id 必须来自当前凭据获授权的查询；每个端点仍按各自读取能力过滤，图查询不会扩大来源或整库读取权限。', examples: ['从一条已授权活动查询其可见关联'], parameterGuide: '传 table、id、depth(1–2)；from/to 可限制带时间记录的范围。若 truncated=true 且 continuation.kind="focus_node"，continuation 只是续查建议，不是游标或 focus_node ID。选 items 中一个仍有用的节点，把它自己的 table/id 作为下一次 query_graph 的根，设置 depth:1；必要时沿用原 from/to。', inputExamples: [{ label: '从活动查询一层关联（参数模板）', args: { table: 'activities', id: '<获授权查询返回的活动ID>', depth: 1 } }, { label: '以返回的联系人节点为新根继续聚焦（参数模板）', args: { table: 'customers', id: '<上一响应中某个获授权节点的ID>', depth: 1 }, note: 'table 必须复制该节点实际返回的合法类型，id 复制同一节点的 ID；此处 customers 仅为 schema 合法的合成模板值。' }],
  },
  preview_capture: {
    summary: '预览新增活动及其联系人、事项、待办和收支的整组录入计划', sideEffect: '保存待确认计划与 requestId；不提交业务事实。', idempotency: '同 requestId、generation、客户端与输入返回原预览；改变输入需新 requestId。', entityRule: '引用既有 ID 前先用当前凭据获授权的查询确认；新建联系人/事项可用 input.contacts/input.topics 中的稳定 key，并在 activities.contactIds/topicIds 中按 key 引用。预览不会授予额外读取能力。', examples: ['先预览一条合成活动及其明确提供的关联'], parameterGuide: 'requestId 与 generation 是顶层字段。input.contacts、input.topics、input.activities 是同级数组；活动可用 contactIds/topicIds 引用同次 input 中联系人/事项的 key；relations.fromContactId/toContactId 也可引用 input.contacts 中的 key。引用已有真实 ID 前须获授权核实。所有 key 在一次输入内保持唯一且不超过 80 字符。新联系人/事项需 name；新待办需 key 和 title。新流水字段为 key、existingId、fact、amountMinor、currency、ledgerId、type、summary、occurredAt、status、note、channel、duplicateDecision：新建实际流水必需 key、fact:"occurred"、正整数最小单位 amountMinor、currency(CNY/USD/EUR 且与账本相同)、已核实 ledgerId 和 type(income/expense)；summary 默认活动标题，occurredAt 默认活动时间，status 仅可为“已结算”或“待对账”，note/channel 可选。fact 虽接受 quote/invoice/expected 的 schema 值，但新建活动流水必须是 occurred；报价、开票或预计款不能作为已发生流水。若只关联已有流水，先核实身份并仅用 existingId；该路径只建立关联，不更新已有流水，不要混传新建字段。若预览发现疑似重复，先核对候选并让用户决定，只有明确决定新建才传 duplicateDecision:"new" 并重做预览。未来安排应建待办，不要伪装成已发生活动。下面是合成参数模板，不代表工作区数据，替换所有 ID/世代后再预览。', inputExamples: [{ label: '预览合成活动、关联和流水（参数模板）', args: { requestId: 'agent_capture_example_01', generation: '<当前数据世代>', input: { contacts: [{ key: 'contact-1', name: '示例联系人' }], topics: [{ key: 'topic-1', name: '示例事项' }], activities: [{ key: 'activity-1', title: '示例需求会', occurredAt: '2026-01-15', timePrecision: 'date', timeZone: 'Asia/Shanghai', contactIds: ['contact-1'], topicIds: ['topic-1'], transactions: [{ key: 'transaction-1', fact: 'occurred', amountMinor: 12000, currency: 'CNY', ledgerId: '<获授权核实的CNY账本ID>', type: 'expense', summary: '示例支出', occurredAt: '2026-01-15', status: '待对账', note: '示例附注', channel: '示例渠道' }], tasks: [{ key: 'task-1', title: '整理示例需求' }] }] } }, note: '合成模板。使用 existingId 时不重复新建对应记录；只有确认候选不是同一笔流水且用户明确决定新建时，才使用 duplicateDecision:"new"。仅预览不会提交业务事实。' }],
  },
  preview_amend: {
    summary: '预览对一组既有记录的修正计划', sideEffect: '保存待确认计划；基于 expectedRev 检查并显示全部变更，不提交业务事实。', idempotency: 'requestId 绑定本客户端、本世代和整组目标；变更内容时使用新 requestId 并重新查询版本。', entityRule: 'targets 的 id 与 expectedRev 必须来自当前凭据获授权的查询；只提交用户要求且受支持的字段。', examples: ['先预览把一条已授权待办改为完成'], parameterGuide: 'input.changes 每项包含 table、id、expectedRev、patch；引用关系变化使用相应 contactIds/topicIds 字段。以下是参数模板；patch 字段仍须受服务端支持的字段白名单约束，传入 schema 接受但服务端不支持的字段会报错。', inputExamples: [{ label: '预览一项待办修改（参数模板）', args: { requestId: 'agent_amend_example_01', generation: '<当前数据世代>', input: { changes: [{ table: 'todos', id: '<获授权查询返回的待办ID>', expectedRev: 3, patch: { status: 'done' } }] } }, note: '仅预览修改。只有用户查看并确认完整 changes 后，才进入 confirm_preview → commit_amend。' }],
  },
  preview_undo: {
    summary: '预览撤销一项已提交操作会恢复或重做的变化', sideEffect: '保存待确认撤销计划；检查后续依赖冲突，不立即改动业务数据。', idempotency: '稳定 requestId 重放同一预览；如果目标已变化，按冲突错误重新查询，不跳过依赖检查。', entityRule: 'operationId 必须来自当前凭据可读取的 get_operation/list_operations；查询不到不代表可猜测或使用其他客户端的 ID。', examples: ['先检查本人可见操作，再预览撤销'], parameterGuide: 'input.operationId 指向已提交操作；执行前检查完整 changes 与冲突提示。以下为参数模板，仅对本客户端获授权且已提交的操作有效；用户确认全部影响前不得 commit。', inputExamples: [{ label: '预览撤销操作（参数模板）', args: { requestId: 'agent_undo_example_01', generation: '<当前数据世代>', input: { operationId: '<本客户端查询返回的已提交operationId>' } } }],
  },
  preview_merge: {
    summary: '预览合并两个联系人及其关联迁移；当前不支持合并项目/事项', sideEffect: '保存待确认合并计划；合并前核对联系人及双方关联影响。', idempotency: 'requestId 绑定源、目标、版本和客户端；改变任一项必须新预览。', entityRule: '当前实现只接受 customers 联系人 ID。sourceId/targetId 与 sourceRev/targetRev 必须来自当前凭据获授权的联系人详情；项目/事项不能传给此工具。', examples: ['先核实两个联系人，再预览联系人合并'], parameterGuide: 'input 需要 sourceId、targetId 和双方最新 revision；本工具目前只合并联系人，不支持项目/事项合并。以下 ID、版本和请求上下文均为参数模板，必须以授权查询结果替换。', inputExamples: [{ label: '预览两个联系人合并（参数模板）', args: { requestId: 'agent_merge_example_01', generation: '<当前数据世代>', input: { sourceId: '<来源联系人ID>', targetId: '<目标联系人ID>', sourceRev: 2, targetRev: 4 } } }],
  },
  preview_delete: {
    summary: '预览删除指定记录及其级联、解绑影响', sideEffect: '保存待确认计划；不立即删除，返回每个目标和影响。', idempotency: 'requestId 绑定完整目标集、版本与客户端；目标或版本变化后新建预览。', entityRule: '每个 target 的 table、id、expectedRev 必须来自当前凭据获授权的查询/详情；用户确认具体影响前不得提交。', examples: ['先预览删除一条已核实的待办会影响什么'], parameterGuide: 'input.targets 为 1–100 项，每项包含 table、id、expectedRev。以下为合成参数模板；逐项核对预览的变化与副作用后再请求用户确认。', inputExamples: [{ label: '预览删除待办（参数模板）', args: { requestId: 'agent_delete_example_01', generation: '<当前数据世代>', input: { targets: [{ table: 'todos', id: '<获授权查询返回的待办ID>', expectedRev: 3 }] } }, note: '仅预览，不会删除记录。' }],
  },
  preview_purge: {
    summary: '预览永久清理指定记录及其级联影响；目标可包含活动记录', sideEffect: '保存待确认计划；预览本身不清理数据，提交后永久清除计划目标及清理范围。', idempotency: 'requestId 绑定完整目标集、版本与客户端；任何变化都需重新预览。', entityRule: '当前服务端允许清理任何已存在且有写权限的目标，包括未删除的活动记录；只有用户明确要求永久清理时使用。ID/revision 必须来自用户提供或当前凭据获授权的记录详情。get_record 不返回已删除记录；回收站目标的 ID/revision 需由拥有者从回收站界面核实提供。', examples: ['先核实目标和影响，再预览用户明确要求的永久清理'], parameterGuide: 'input.targets 为 1–100 项，每项包含 table、id、expectedRev。与 preview_delete 区分：purge 是物理永久清理，可涉及活动记录，也可能扩展清理关联/附件。逐项确认目标身份和完整清理范围；若包含仍在使用的活动记录，必须明确向用户说明后再取得确认。以下只是活动记录参数模板，不表示当前工作区存在该记录。', inputExamples: [{ label: '预览永久清理一条活动（参数模板）', args: { requestId: 'agent_purge_example_01', generation: '<当前数据世代>', input: { targets: [{ table: 'activities', id: '<已核实的活动ID>', expectedRev: 5 }] } }, note: '不执行清理。提交前必须展示服务端预览及其全部级联影响，并取得用户明确确认。' }],
  },
  commit_capture: { summary: '提交已确认的活动录入计划', sideEffect: '原子提交相应联系人、事项、活动及其它预览变更；返回持久回执。', idempotency: '相同请求和预览的重试返回原回执；同一 requestId 不能改参数或换客户端。', entityRule: '只提交同一 requestId/generation/client 的有效 preview_capture。', examples: ['用户检查并确认整组预览后提交活动录入'], parameterGuide: '仅按 preview_capture 返回的 confirmHint.args 调用 confirm_preview 取票；只有用户明确确认完整影响后，才携带原 requestId、generation、previewId 与 relay confirmToken 调用本工具。以下是非真实的参数模板。', inputExamples: [{ label: '提交已确认录入（参数模板）', args: { requestId: 'agent_capture_example_01', generation: '<原预览generation>', previewId: '<原预览previewId>', confirmToken: '<confirm_preview返回的一次性token>' } }],
  },
  commit_amend: { summary: '提交已确认的整组记录修改', sideEffect: '原子应用预览中的所有更改并返回持久回执。', idempotency: '相同请求重试返回原回执；不能把旧票或 requestId 用于不同 patch。', entityRule: '只提交同一客户端有效 preview_amend 生成的 previewId。', examples: ['用户检查并确认整组预览后提交修改'], parameterGuide: '仅按 preview_amend 返回的 confirmHint.args 调用 confirm_preview 取票；用户明确确认完整影响后，使用原 requestId/generation、previewId 与一次性 confirmToken。以下为参数模板。', inputExamples: [{ label: '提交已确认修改（参数模板）', args: { requestId: 'agent_amend_example_01', generation: '<原预览generation>', previewId: '<原预览previewId>', confirmToken: '<confirm_preview返回的一次性token>' } }],
  },
  commit_undo: { summary: '提交已确认的操作撤销计划', sideEffect: '按预览核对后的效果原子撤销操作。', idempotency: '同一请求重试返回持久回执；若版本/依赖已变更，不能绕过冲突重新提交旧计划。', entityRule: '只能提交本客户端 preview_undo 的有效计划。', examples: ['用户检查并确认影响后撤销指定操作'], parameterGuide: '仅按 preview_undo 返回的 confirmHint.args 调用 confirm_preview 取票；用户明确确认完整影响后，使用原 requestId、generation、previewId 与 confirmToken。以下为参数模板。', inputExamples: [{ label: '提交已确认撤销（参数模板）', args: { requestId: 'agent_undo_example_01', generation: '<原预览generation>', previewId: '<原预览previewId>', confirmToken: '<confirm_preview返回的一次性token>' } }],
  },
  commit_merge: { summary: '提交已确认的联系人合并计划', sideEffect: '按预览原子迁移联系人关联并完成合并，返回持久回执。', idempotency: '相同请求重试返回持久回执；目标版本变化须重新预览。', entityRule: '只能提交本客户端 preview_merge 的有效联系人合并计划；当前不支持合并项目/事项。', examples: ['用户确认联系人关联影响后提交合并'], parameterGuide: '仅按 preview_merge 返回的 confirmHint.args 调用 confirm_preview 取票；用户明确确认完整影响后，携带原 requestId、generation、previewId 和 confirmToken。以下为参数模板。', inputExamples: [{ label: '提交已确认联系人合并（参数模板）', args: { requestId: 'agent_merge_example_01', generation: '<原预览generation>', previewId: '<原预览previewId>', confirmToken: '<confirm_preview返回的一次性token>' } }],
  },
  commit_delete: { summary: '提交已确认的删除计划', sideEffect: '按预览执行记录删除及既定级联/解绑动作，返回持久回执。', idempotency: '相同请求重试返回原回执；不能修改目标或复用其它预览票据。', entityRule: '只能提交本客户端 preview_delete 的有效计划。', examples: ['用户检查并确认影响清单后提交删除'], parameterGuide: '仅按 preview_delete 返回的 confirmHint.args 调用 confirm_preview 取票；逐项向用户转述并确认预览影响后，携带原 requestId、generation、previewId 和 confirmToken。以下为参数模板。', inputExamples: [{ label: '提交已确认删除（参数模板）', args: { requestId: 'agent_delete_example_01', generation: '<原预览generation>', previewId: '<原预览previewId>', confirmToken: '<confirm_preview返回的一次性token>' } }],
  },
  commit_purge: { summary: '提交已确认的永久清理计划', sideEffect: '永久清理预览目标及其计划范围；返回持久回执。', idempotency: '相同请求重试返回原回执；无法用旧预览清理已变化目标。', entityRule: '仅在用户明确要求永久清理并确认完整计划后提交本客户端 preview_purge。', examples: ['用户核对目标、活动记录和级联范围并明确确认后提交'], parameterGuide: '仅按 preview_purge 返回的 confirmHint.args 调用 confirm_preview 取票；Purge 不可恢复，服务端当前允许目标包含仍未删除的活动记录。提交前逐项展示 ID、版本及全部清理影响，取得用户对永久删除的明确确认。使用原 requestId、generation、previewId 和 confirmToken。以下为参数模板。', inputExamples: [{ label: '提交已确认永久清理（参数模板）', args: { requestId: 'agent_purge_example_01', generation: '<原预览generation>', previewId: '<原预览previewId>', confirmToken: '<confirm_preview返回的一次性token>' } }],
  },
}

for (const tool of ALL_TOOL_SKILLS) {
  const guidance = PERSONAL_GUIDANCE[tool.name]
  if (guidance) Object.assign(tool, guidance)
}

export const TOOL_SUMMARIES = Object.fromEntries(ALL_TOOL_SKILLS.map((tool) => [tool.name, tool.summary]))

/** 直接再导出，便于生成器（esbuild inlined bundle）取用 */
export { TOOL_RISK, TOOL_DOMAIN, TOOL_EVENTS, DEFAULT_AI_DOMAINS }

/**
 * 复用**运行期同一份** zod→JSON Schema 实现（`src/agent/jsonSchema.ts`）。
 *
 * 为什么不在这里内联一份：历史上生成器抄了一份简化实现，注释写着「与 jsonSchema.ts 同口径」，
 * 但运行期修 bug 后这份拷贝没跟 —— 于是 `fin_recordTransaction` 的 6 个关联字段被生成成
 * `{type:'number',enum:[null,null]}`（真相是 `anyOf: [string, array]`），
 * `docs/skills/*.md` 与 `mcp-tools.json` 双双失真，而测试全绿无人发现。
 * 单源原则不能靠「保持一致的注释」维系，必须共用同一个函数。
 */
export { zodToJsonSchema, toolJsonSchema } from './jsonSchema'

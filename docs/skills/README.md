# 寻鸽工作台 · Agent 工具目录

> ⚠️ **自动生成**：由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）生成，
> 与业务工具的公共 `inputSchema` **同源一份定义**。请勿手改本目录；入参示例仅用于说明，不是额外权限。

## 怎么用

- 本目录写给**外部 Agent 的推理上下文**：工具 schema、作用、副作用、重试和参数示例；
- 机器校验用 `mcp-tools.json`（只含业务工具的生成快照）；
- Relay 在运行期另加入 `confirm_preview`。MCP 清单受部署策略影响，当前测试站已核对为 57 个业务工具 + `confirm_preview`；实际每次调用仍由服务端逐请求检查客户端凭据与能力。目录可见或清单中出现都不代表已获执行权限。

## 协议与安全边界

- 新接入使用标准 **MCP Streamable HTTP**：`POST <url>/relay/mcp`，请求携带 `Authorization: Bearer <独立 token>`；无需本地仓库或浏览器在线；
- 个人数据权威在自托管 VPS 的 PocketBase。客户端有界镜像用于客户端缓存，不是服务端权威；
- 独立凭据由拥有者按客户端签发，服务端按请求校验 token 散列、能力、部署域与恢复世代；每个客户端可单独撤销；
- 常规列表与搜索限幅并返回截断/续页信息；正文、来源和操作历史按显式字段、版本、游标及能力读取；
- 旧共享浏览器桥仍是兼容路径，需要已登录页面在线；不能替代新独立凭据或直接 HTTP MCP。

## 工具总览（57 个）

| 工具 | 域 | 风险 | 能力 |
|---|---|---|---|
| [`fin_recordTransaction`](./fin_recordTransaction.md) | fin | medium | 记一笔收支流水（财务记账） |
| [`fin_createLedger`](./fin_createLedger.md) | fin | low | 新建账本 |
| [`crm_createCustomer`](./crm_createCustomer.md) | crm | medium | 新建 CRM 客户（可含首联初始化） |
| [`crm_addInteraction`](./crm_addInteraction.md) | crm | medium | 记一条客户沟通日志（原子刷新最近联系时间） |
| [`crm_addRelation`](./crm_addRelation.md) | crm | medium | 维护客户关系（canonical relation link） |
| [`link_link`](./link_link.md) | link | medium | 建立原子间关联（links 表，related / relation） |
| [`link_unlink`](./link_unlink.md) | link | medium | 解除原子间关联（幂等） |
| [`todo_createTodo`](./todo_createTodo.md) | todo | low | 新建待办（正文首行即标题） |
| [`todo_completeTodo`](./todo_completeTodo.md) | todo | low | 把待办标记为完成（或取消完成） |
| [`todo_updateTodo`](./todo_updateTodo.md) | todo | low | 编辑待办（正文/优先级/截止时间/关联） |
| [`todo_deleteTodo`](./todo_deleteTodo.md) | todo | high | 删除待办（不可逆，顺带解绑流水关联） |
| [`crm_updateCustomer`](./crm_updateCustomer.md) | crm | medium | 编辑客户档案（姓名/公司/职位/健康分档位/联系方式） |
| [`project_createProject`](./project_createProject.md) | project | low | 新建项目 |
| [`project_updateProject`](./project_updateProject.md) | project | medium | 编辑项目（改名/归档/搁置/挂靠客户/预算） |
| [`note_createNote`](./note_createNote.md) | note | low | 新建笔记 |
| [`note_updateNote`](./note_updateNote.md) | note | medium | 编辑笔记（标题/正文/标签/归属） |
| [`note_createFolder`](./note_createFolder.md) | note | low | 新建笔记文件夹 |
| [`fin_updateTransaction`](./fin_updateTransaction.md) | fin | medium | 编辑流水（金额/类型/日期/账本/状态/关联） |
| [`fin_deleteTransaction`](./fin_deleteTransaction.md) | fin | high | 删除流水（不可逆，级联清凭证存根） |
| [`note_deleteNote`](./note_deleteNote.md) | note | high | 删除笔记（不可逆） |
| [`crm_deleteCustomer`](./crm_deleteCustomer.md) | crm | high | 删除客户（不可逆，级联日志 + 解绑四表 + 清关系） |
| [`project_deleteProject`](./project_deleteProject.md) | project | high | 删除项目（不可逆，级联里程碑 + 解绑四表） |
| [`cancel_operation`](./cancel_operation.md) | read | low | 撤回当前客户端自己的待确认操作 |
| [`preview_capture`](./preview_capture.md) | read | low | 预览新增活动及其联系人、事项、待办和收支的整组录入计划 |
| [`commit_capture`](./commit_capture.md) | read | medium | 提交已确认的活动录入计划 |
| [`preview_amend`](./preview_amend.md) | read | low | 预览对一组既有记录的修正计划 |
| [`commit_amend`](./commit_amend.md) | read | medium | 提交已确认的整组记录修改 |
| [`preview_undo`](./preview_undo.md) | read | low | 预览撤销一项已提交操作会恢复或重做的变化 |
| [`commit_undo`](./commit_undo.md) | read | high | 提交已确认的操作撤销计划 |
| [`preview_merge`](./preview_merge.md) | read | low | 预览合并两个联系人及其关联迁移；当前不支持合并项目/事项 |
| [`commit_merge`](./commit_merge.md) | read | high | 提交已确认的联系人合并计划 |
| [`preview_delete`](./preview_delete.md) | read | low | 预览删除指定记录及其级联、解绑影响 |
| [`commit_delete`](./commit_delete.md) | read | high | 提交已确认的删除计划 |
| [`preview_purge`](./preview_purge.md) | read | low | 预览永久清理指定记录及其级联影响；目标可包含活动记录 |
| [`commit_purge`](./commit_purge.md) | read | high | 提交已确认的永久清理计划 |
| [`resolveEntity`](./resolveEntity.md) | read | low | 把自然语言里的实体名消解为真实 id（写工具的前置） |
| [`searchEntities`](./searchEntities.md) | read | low | 兼容全局搜索（活动/客户/待办/流水/笔记/项目）；独立配对 Agent 当前不能调用，请使用按域查询工具 |
| [`getCustomer`](./getCustomer.md) | read | low | 读取单个客户档案摘要 |
| [`listTransactions`](./listTransactions.md) | read | low | 按条件列流水（金额/日期/状态/客户/账本） |
| [`listTodos`](./listTodos.md) | read | low | 列待办 |
| [`listLedgers`](./listLedgers.md) | read | low | 列账本 |
| [`listHabits`](./listHabits.md) | read | low | 读取有界历史习惯记录（功能已下线） |
| [`listProjects`](./listProjects.md) | read | low | 列项目（可按状态/挂靠客户过滤） |
| [`listNotes`](./listNotes.md) | read | low | 列笔记（标题/标签/归属，**不含正文**） |
| [`listNoteFolders`](./listNoteFolders.md) | read | low | 列笔记文件夹 |
| [`listLinks`](./listLinks.md) | read | low | 查某实体的关联（双向合并） |
| [`resolve_contacts`](./resolve_contacts.md) | read | low | 在获授权的联系人范围内按姓名、别名或精确身份线索消解联系人 |
| [`resolve_topics`](./resolve_topics.md) | read | low | 在获授权的事项范围内按名称或别名消解项目/事项 |
| [`search_activities`](./search_activities.md) | read | low | 按日期、关键词、联系人或事项查询活动时间线 |
| [`get_activity`](./get_activity.md) | read | low | 读取一条活动详情、允许读取的正文片段与关联摘要 |
| [`get_operation`](./get_operation.md) | read | low | 按操作编号或原请求编号读取当前客户端可见的操作回执与影响 |
| [`list_operations`](./list_operations.md) | read | low | 列出当前凭据可见的个人助手操作与状态 |
| [`get_contact_context`](./get_contact_context.md) | read | low | 读取一个联系人的获授权上下文、近期活动、承诺和收支摘要 |
| [`query_tasks`](./query_tasks.md) | read | low | 查询授权范围内的待办、截止情况和关联上下文 |
| [`query_finance`](./query_finance.md) | read | low | 按账本、收支类型、状态、日期或关联对象查询并汇总授权收支 |
| [`get_record`](./get_record.md) | read | low | 读取授权记录详情、特定正文片段、关联或审计历史 |
| [`query_graph`](./query_graph.md) | read | low | 从授权记录出发查询一至两层实体关联图 |

## 通用纪律

1. **实体引用先消解**：人名/公司名/账本名等一律先调 `resolveEntity`；候选不唯一必须**反问用户**，禁止猜 id；
2. **权限先于可见性**：工具目录和 `tools/list` 不是授权；服务端每次检查独立凭据的域能力和部署白名单；
3. **写入复用稳定上下文**：相同意图重试复用原 `requestId` 与 `generation`；改变意图必须用新请求和新预览；
4. **按实际预览确认**：普通中/高风险操作使用返回的 `confirmHint.args`；个人命令用 `preview_* → 用户确认 → confirm_preview → commit_*`；票据 5 分钟、一次性且绑定具体计划；
5. **分域读取正文/历史**：笔记正文用 `get_record(fields:["markdown"])`，历史用 `view:"history"`，续读复用 generation/revision/cursor；超限结果不能视为完整；
6. **兼容搜索受限**：独立 Agent 当前不能调用 `searchEntities`，请用 `resolve_contacts`、`resolve_topics`、`query_tasks`、`search_activities` 与 `listNotes` 等定域工具；`listHabits` 只读历史，且需要已有 `habit:read`（后台当前不签发）。

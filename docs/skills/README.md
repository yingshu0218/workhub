# 寻鸽工作台 · Agent skill（P1 首版）

> ⚠️ **自动生成**：由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）生成，
> 与 MCP `tools/list` 的 `inputSchema` **同源一份定义**（方案 §五 / §10.1）。请勿手改本目录。

## 怎么用

- 本目录写给**外部 Agent 的推理上下文**：每个工具的参数、副作用、风险级、幂等语义、关联规则与示例；
- 机器校验用 `mcp-tools.json`（等价于运行期 MCP `tools/list` 的静态快照）；
- 运行期以 `tools/list` 返回的**实际工具清单**为准——**能力白名单关闭的域，工具不会出现**（方案 §四.3）。

## 协议与安全边界

- 桥只暴露**标准 MCP**（`tools/list` + `tools/call`），不定义私有协议；
- relay 只监听 `127.0.0.1`，Agent 连接必须携带 relay 启动时生成的 **token**；
- **relay 不是安全边界**：真正的防线是 agentOps 的 zod 校验 + 风险分级 + confirmToken + 白名单；
- relay 是**通道、不持有数据**：权威数据在浏览器 IndexedDB，agentOps 在页面进程内执行。

## 工具总览（15 个）

| 工具 | 域 | 风险 | 能力 |
|---|---|---|---|
| [`fin_recordTransaction`](./fin_recordTransaction.md) | fin | medium | 记一笔收支流水（财务记账） |
| [`fin_createLedger`](./fin_createLedger.md) | fin | low | 新建账本 |
| [`crm_createCustomer`](./crm_createCustomer.md) | crm | medium | 新建 CRM 客户（可含首联初始化） |
| [`crm_addInteraction`](./crm_addInteraction.md) | crm | medium | 记一条客户沟通日志（原子刷新最近联系时间） |
| [`crm_addRelation`](./crm_addRelation.md) | crm | medium | 维护客户关系（双向落两侧） |
| [`todo_createTodo`](./todo_createTodo.md) | todo | low | 新建待办 |
| [`todo_completeTodo`](./todo_completeTodo.md) | todo | low | 把待办标记为完成（或取消完成） |
| [`habit_checkin`](./habit_checkin.md) | habit | low | 习惯打卡 / 取消打卡 |
| [`resolveEntity`](./resolveEntity.md) | read | low | 把自然语言里的实体名消解为真实 id（写工具的前置） |
| [`searchEntities`](./searchEntities.md) | read | low | 全局搜索（客户/项目/待办/笔记/账本/习惯） |
| [`getCustomer`](./getCustomer.md) | read | low | 读取单个客户档案摘要 |
| [`listTransactions`](./listTransactions.md) | read | low | 按条件列流水（金额/日期/状态/客户/账本） |
| [`listTodos`](./listTodos.md) | read | low | 列待办 |
| [`listLedgers`](./listLedgers.md) | read | low | 列账本 |
| [`listHabits`](./listHabits.md) | read | low | 列习惯 |

## 通用纪律

1. **实体引用先消解**：人名/公司名/账本名等一律先调 `resolveEntity`；候选不唯一必须**反问用户**，禁止猜 id；
2. **写工具只接受消解后的 id**：字符串关联会被拒绝（可操作错误）；
3. **中风险先确认**：调用前先向用户转述参数，取得确认后再携带 `confirmToken` 执行；
4. **读工具有限幅**：返回条数与字段受白名单约束，超限会置 `truncated: true`；
5. **事件永在事务 commit 之后**：写工具触发的领域事件由 repositories 层统一发出，Agent 无需手动补发。

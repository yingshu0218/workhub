# `crm_deleteCustomer`

> 域：`crm` · 风险级：**high** · 写工具

## 能力

删除客户（不可逆，级联日志 + 解绑四表 + 清关系）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `customerId` | string | 是 | — |  |

## 副作用

软删客户并**级联软删其全部沟通日志**；流水 / 待办 / 项目**只解绑不删除**；其它客户 relations 里指向它的条目被清除。返回 `sideEffects`（cascadedInteractions / unlinkedTransactions / unlinkedTodos / unlinkedProjects / clearedRelations）供逐项转述。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：对已删客户重复调用返回可操作错误。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 customerId 必填。高风险：必须先把 sideEffects 逐项念给用户听，取得明确确认后再执行。

## 典型说法

- 「把测试客户「张三」删掉」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

# `todo_updateTodo`

> 域：`todo` · 风险级：**low** · 写工具

## 能力

编辑待办（标题/描述/优先级/截止时间/关联）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `todoId` | string | 是 | — |  |
| `title` | string | 否 | — |  |
| `desc` | string | 否 | — |  |
| `priority` | enum(high / mid / low / none / P1 / P2 / P3) | 否 | — |  |
| `dueAt` | number | 否 | — |  |
| `customerId` | string | 否 | — |  |
| `projectId` | string | 否 | — |  |
| `listId` | string | 否 | — |  |

## 副作用

更新待办字段（todos）。传 null 表示**清空**该关联（如取消挂靠客户）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同一组字段重复提交结果一致。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 todoId 必填；更换 customerId/projectId 时目标须为真实 id。完成态请改用 todo_completeTodo。

## 典型说法

- 「把「出方案」改成高优先级，截止到周五」
- 「取消这条待办的项目关联」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

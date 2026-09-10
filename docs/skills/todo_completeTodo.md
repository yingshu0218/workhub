# `todo_completeTodo`

> 域：`todo` · 风险级：**low** · 写工具

## 能力

把待办标记为完成（或取消完成）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `todoId` | string | 是 | — |  |
| `done` | boolean | 否 | `true` |  |

## 副作用

走领域函数 toggleTodoDone，status 与 completedAt 成对写入。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：目标态已达成时直接返回 `{ changed:false }`，不落库、不推进时间。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 todoId 必填。

## 典型说法

- 「标「出方案」完成」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

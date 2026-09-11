# `todo_deleteTodo`

> 域：`todo` · 风险级：**high** · 写工具

## 能力

删除待办（不可逆，顺带解绑流水关联）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `todoId` | string | 是 | — |  |

## 副作用

软删待办（todos，盖章 deleted=1 并入同步队列），并**解绑**流水 `transactions.todoIds` 里指向它的关联（条数见 `sideEffects.unlinked`）。**高风险、不可逆**，删除前必须向用户明确确认，并如实转述解绑条数。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：对已删待办重复调用返回可操作错误（记录不存在）。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 todoId 必填。

## 典型说法

- 「把「临时想法」这条待办删掉」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

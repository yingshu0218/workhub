# `listTodos`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

列待办

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `status` | enum(todo / done) | 否 | — |  |
| `priority` | enum(high / mid / low / none / P1 / P2 / P3) | 否 | — |  |
| `customerId` | string | 否 | — |  |
| `projectId` | string | 否 | — |  |

## 副作用

只读。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

上限 50 条，超限截断。

## 典型说法

- 「这周还有哪些待办」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

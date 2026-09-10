# `listTransactions`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

按条件列流水（金额/日期/状态/客户/账本）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `customerId` | string | 否 | — |  |
| `ledgerId` | string | 否 | — |  |
| `status` | enum(已结算 / 待对账) | 否 | — |  |
| `type` | enum(income / expense) | 否 | — |  |
| `from` | string | 否 | — |  |
| `to` | string | 否 | — |  |

## 副作用

只读。不含附件 Blob。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

customerId/ledgerId 若提供须为真实 id；上限 50 条，超限截断并置 truncated=true。

## 典型说法

- 「本月花了多少」
- 「王五的账目」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

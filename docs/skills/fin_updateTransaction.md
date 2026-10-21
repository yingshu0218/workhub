# `fin_updateTransaction`

> 域：`fin` · 风险级：**medium** · 写工具

## 能力

编辑流水（金额/类型/日期/账本/状态/关联）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `transactionId` | string | 是 | — |  |
| `ledgerId` | string | 否 | — |  |
| `summary` | string | 否 | — |  |
| `amount` | number | 否 | — |  |
| `type` | enum(income / expense) | 否 | — |  |
| `occurredAt` | string | 否 | — |  |
| `channel` | enum(微信 / 支付宝 / 银行卡 / 现金 / 对公转账) | 否 | — |  |
| `status` | enum(已结算 / 待对账) | 否 | — |  |
| `tags` | array | 否 | — |  |
| `note` | string | 否 | — |  |
| `customerIds` | anyOf | 否 | — |  |
| `customerId` | anyOf | 否 | — |  |
| `todoIds` | anyOf | 否 | — |  |
| `todoId` | anyOf | 否 | — |  |
| `projectIds` | anyOf | 否 | — |  |
| `projectId` | anyOf | 否 | — |  |

## 副作用

更新流水字段（transactions）。**不会重发 `transaction:created`**（该事件仅在新建时发，重复触发会多算一次奖杯/EXP）。**不碰附件**（凭证仍走界面）。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同一组字段重复提交结果一致。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 transactionId 必填；ledgerId / customerIds / todoIds / projectIds 变更时目标须为真实 id。关联字段显式传空数组即清空该关联。改金额或记账日期会直接影响财务统计，属中风险。

## 典型说法

- 「刚才那笔 2000 记错了，改成 1800」
- 「把这笔流水标记为已结算」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

# `fin_recordTransaction`

> 域：`fin` · 风险级：**medium** · 写工具

## 能力

记一笔收支流水（财务记账）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `ledgerId` | string | 否 | — |  |
| `summary` | string | 是 | — |  |
| `amount` | number | 是 | — |  |
| `type` | enum(income / expense) | 否 | `"expense"` |  |
| `occurredAt` | string | 否 | — |  |
| `channel` | enum(微信 / 支付宝 / 银行卡 / 现金 / 对公转账) | 否 | — |  |
| `status` | enum(已结算 / 待对账) | 否 | `"待对账"` |  |
| `tags` | array | 否 | `[]` |  |
| `note` | string | 否 | — |  |
| `customerIds` | anyOf | 否 | — |  |
| `customerId` | anyOf | 否 | — |  |
| `todoIds` | anyOf | 否 | — |  |
| `todoId` | anyOf | 否 | — |  |
| `projectIds` | anyOf | 否 | — |  |
| `projectId` | anyOf | 否 | — |  |

## 副作用

写入一条流水（transactions）；落库后广播 `transaction:created`（仅新建时），触发奖杯/EXP 与统计联动。

## 事件

- `transaction:created`

## 幂等语义

非幂等：每次调用都会新建一条流水（无确定性 id）。重试前应先确认上一次是否已成功。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 ledgerId 可缺省（缺省走「默认账本 → 唯一账本 → 反问」策略；多账本且无默认时会要求你指定）；customerId/todoId/projectId 同理。

## 典型说法

- 「记一笔 120 晚饭」
- 「今天给深蓝科技开了 2 万的发票，挂到王五名下」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

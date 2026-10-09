# `crm_createCustomer`

> 域：`crm` · 风险级：**medium** · 写工具

## 能力

新建 CRM 客户（可含首联初始化）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | 是 | — |  |
| `company` | string | 否 | — |  |
| `title` | string | 否 | — |  |
| `decisionLevel` | enum(决策人 / 影响者 / 使用者 / 把关人) | 否 | `"决策人"` |  |
| `tags` | array | 否 | `[]` |  |
| `phone` | string | 否 | — |  |
| `wechat` | string | 否 | — |  |
| `email` | string | 否 | — |  |
| `address` | string | 否 | — |  |
| `openingLog` | boolean | 否 | `false` |  |
| `linkTransactionId` | string | 否 | — |  |

## 副作用

写入一条客户（customers）；openingLog=true 时同时写一条开通日志；linkTransactionId 时把该流水关联到新客户。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

非幂等：同名客户会重复创建。

## 实体引用规则

linkTransactionId 必须来自 listTransactions 查询结果，禁止猜 id。

## 典型说法

- 「帮我新增客户王五，深蓝科技采购经理」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

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
| `decisionLevel` | enum(决策人 / 影响者 / 使用者 / 把关人 / ) | 否 | `""` |  |
| `aliases` | array | 否 | — |  |
| `preferredName` | string | 否 | — |  |
| `contactType` | enum(person / organization / unspecified) | 否 | — |  |
| `tags` | array | 否 | `[]` |  |
| `phone` | string | 否 | — |  |
| `wechat` | string | 否 | — |  |
| `email` | string | 否 | — |  |
| `address` | string | 否 | — |  |
| `openingLog` | boolean | 否 | `false` |  |
| `linkTransactionId` | string | 否 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 请求上下文与权限

低风险直接写入在首次调用前必须提供稳定 requestId 与当前 generation。中/高风险首次预览若缺少这两项，服务端可补齐并返回实际值；之后的取票、查询回执与重试必须沿用原参数及返回的 requestId/generation。改变意图使用新 requestId 并重新预览。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。


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

中风险：首次调用只返回预览。向用户转述该次预览中的参数与实际影响并取得确认；随后按返回的 `confirmHint.args` 调用 `confirm_preview`，再用同一业务参数和 relay 返回的一次性 `confirmToken` 重试。不要自行重建 hint。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

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
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 请求上下文与权限

低风险直接写入在首次调用前必须提供稳定 requestId 与当前 generation。中/高风险首次预览若缺少这两项，服务端可补齐并返回实际值；之后的取票、查询回执与重试必须沿用原参数及返回的 requestId/generation。改变意图使用新 requestId 并重新预览。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。


## 副作用

更新流水字段（transactions）。**不会重发 `transaction:created`**（该事件仅在新建时发）。**不碰附件**（凭证仍走界面）。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同一组字段重复提交结果一致。

## 实体引用规则

实体引用（客户/项目/待办/账本/笔记/文件夹）必须先通过对应的授权查询消解；候选不唯一必须反问答用户，禁止猜 id。历史习惯只读，不可作为写入关联。 transactionId 必填；ledgerId / customerIds / todoIds / projectIds 变更时目标须为真实 id。关联字段显式传空数组即清空该关联。改金额或记账日期会直接影响财务统计，属中风险。

## 典型说法

- 「刚才那笔 2000 记错了，改成 1800」
- 「把这笔流水标记为已结算」

## 确认流程

中风险：首次调用只返回预览。向用户转述该次预览中的参数与实际影响并取得确认；随后按返回的 `confirmHint.args` 调用 `confirm_preview`，再用同一业务参数和 relay 返回的一次性 `confirmToken` 重试。不要自行重建 hint。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

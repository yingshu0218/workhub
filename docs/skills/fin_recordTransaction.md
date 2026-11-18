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
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 请求上下文与权限

低风险直接写入在首次调用前必须提供稳定 requestId 与当前 generation。中/高风险首次预览若缺少这两项，服务端可补齐并返回实际值；之后的取票、查询回执与重试必须沿用原参数及返回的 requestId/generation。改变意图使用新 requestId 并重新预览。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。


## 副作用

写入一条流水（transactions）；落库后广播 `transaction:created`（仅新建时），供当前收支视图更新。习惯与奖杯能力已退役。

## 事件

- `transaction:created`

## 幂等语义

非幂等：每次调用都会新建一条流水（无确定性 id）。重试前应先确认上一次是否已成功。

## 实体引用规则

实体引用（客户/项目/待办/账本/笔记/文件夹）必须先通过对应的授权查询消解；候选不唯一必须反问答用户，禁止猜 id。历史习惯只读，不可作为写入关联。 ledgerId 可缺省（缺省走「默认账本 → 唯一账本 → 反问」策略；多账本且无默认时会要求你指定）；customerId/todoId/projectId 同理。

## 典型说法

- 「记一笔 120 晚饭」
- 「今天给深蓝科技开了 2 万的发票，挂到王五名下」

## 确认流程

中风险：首次调用只返回预览。向用户转述该次预览中的参数与实际影响并取得确认；随后按返回的 `confirmHint.args` 调用 `confirm_preview`，再用同一业务参数和 relay 返回的一次性 `confirmToken` 重试。不要自行重建 hint。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

# `crm_updateCustomer`

> 域：`crm` · 风险级：**medium** · 写工具

## 能力

编辑客户档案（姓名/公司/职位/健康分档位/联系方式）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `customerId` | string | 是 | — |  |
| `name` | string | 否 | — |  |
| `company` | string | 否 | — |  |
| `title` | string | 否 | — |  |
| `decisionLevel` | enum(决策人 / 影响者 / 使用者 / 把关人) | 否 | — |  |
| `intimacyLevel` | enum(T1 / T2 / T3 / T4 / T5 / I6 / I7) | 否 | — |  |
| `tags` | array | 否 | — |  |
| `phone` | string | 否 | — |  |
| `wechat` | string | 否 | — |  |
| `email` | string | 否 | — |  |
| `address` | string | 否 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 请求上下文与权限

低风险直接写入在首次调用前必须提供稳定 requestId 与当前 generation。中/高风险首次预览若缺少这两项，服务端可补齐并返回实际值；之后的取票、查询回执与重试必须沿用原参数及返回的 requestId/generation。改变意图使用新 requestId 并重新预览。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。


## 副作用

更新客户字段（customers）。`intimacyLevel: null` 表示清除手动健康分档位、交算法兜底。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同一组字段重复提交结果一致。

## 实体引用规则

实体引用（客户/项目/待办/账本/笔记/文件夹）必须先通过对应的授权查询消解；候选不唯一必须反问答用户，禁止猜 id。历史习惯只读，不可作为写入关联。 customerId 必填。客户关系（转介绍人等）请用 crm_addRelation，不在此内联。

## 典型说法

- 「把王五的层级改成决策人」
- 「王五升到 T2 了」

## 确认流程

中风险：首次调用只返回预览。向用户转述该次预览中的参数与实际影响并取得确认；随后按返回的 `confirmHint.args` 调用 `confirm_preview`，再用同一业务参数和 relay 返回的一次性 `confirmToken` 重试。不要自行重建 hint。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

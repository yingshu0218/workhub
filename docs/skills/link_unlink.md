# `link_unlink`

> 域：`link` · 风险级：**medium** · 写工具

## 能力

解除原子间关联（幂等）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `fromType` | enum(customer / todo / ledger / project / note / transaction / habit) | 是 | — |  |
| `fromId` | string | 是 | — |  |
| `toType` | enum(customer / todo / ledger / project / note / transaction / habit) | 是 | — |  |
| `toId` | string | 是 | — |  |
| `kind` | enum(related / relation) | 是 | — |  |
| `label` | string | 否 | — |  |
| `category` | enum(project / event / finance / person / other) | 否 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 请求上下文与权限

低风险直接写入在首次调用前必须提供稳定 requestId 与当前 generation。中/高风险首次预览若缺少这两项，服务端可补齐并返回实际值；之后的取票、查询回执与重试必须沿用原参数及返回的 requestId/generation。改变意图使用新 requestId 并重新预览。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。


## 副作用

软删一条 link 记录（两端实体数据不动）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：从未存在 / 已解绑时静默成功。同参数重调 link_link 可复活。

## 实体引用规则

实体引用（客户/项目/待办/账本/笔记/文件夹）必须先通过对应的授权查询消解；候选不唯一必须反问答用户，禁止猜 id。历史习惯只读，不可作为写入关联。 参数与建联时一致（relation 需带原 label/category 才能定位同一条）。

## 典型说法

- 「解除这笔流水与客户王五的关联」

## 确认流程

中风险：首次调用只返回预览。向用户转述该次预览中的参数与实际影响并取得确认；随后按返回的 `confirmHint.args` 调用 `confirm_preview`，再用同一业务参数和 relay 返回的一次性 `confirmToken` 重试。不要自行重建 hint。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

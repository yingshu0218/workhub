# `crm_addRelation`

> 域：`crm` · 风险级：**medium** · 写工具

## 能力

维护客户关系（canonical relation link）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `customerId` | string | 是 | — |  |
| `targetId` | string | 是 | — |  |
| `label` | string | 是 | — |  |
| `category` | enum(project / event / finance / person / other) | 否 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 副作用

写一条 kind=relation 的 link（canonical：两端任一侧都可见）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同 (targetId,label) 已有活 link 时 deduped=true 不重复写。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 customerId 与 targetId 都要消解为真实 id。

## 典型说法

- 「把王五设成李四的转介绍人」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

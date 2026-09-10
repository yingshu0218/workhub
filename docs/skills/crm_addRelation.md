# `crm_addRelation`

> 域：`crm` · 风险级：**medium** · 写工具

## 能力

维护客户关系（双向落两侧）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `customerId` | string | 是 | — |  |
| `targetId` | string | 是 | — |  |
| `label` | string | 是 | — |  |
| `category` | enum(project / event / finance / person / other) | 否 | — |  |

## 副作用

在 A、B 两侧客户的 relations[] 各写一条（同目标+语义判重）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同 (targetId,label) 重复调用不新增。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 customerId 与 targetId 都要消解为真实 id。

## 典型说法

- 「把王五设成李四的转介绍人」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

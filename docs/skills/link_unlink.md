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

## 副作用

软删一条 link 记录（两端实体数据不动）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：从未存在 / 已解绑时静默成功。同参数重调 link_link 可复活。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 参数与建联时一致（relation 需带原 label/category 才能定位同一条）。

## 典型说法

- 「解除这笔流水与客户王五的关联」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

# `crm_updateCustomer`

> 域：`crm` · 风险级：**medium** · 写工具

## 能力

编辑客户档案（姓名/公司/职位/tier/健康分档位/联系方式）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `customerId` | string | 是 | — |  |
| `name` | string | 否 | — |  |
| `company` | string | 否 | — |  |
| `title` | string | 否 | — |  |
| `decisionLevel` | enum(决策人 / 影响者 / 使用者 / 把关人) | 否 | — |  |
| `tier` | enum(S / A / B / 潜在) | 否 | — |  |
| `intimacyLevel` | enum(T1 / T2 / T3 / T4 / T5 / I6 / I7) | 否 | — |  |
| `tags` | array | 否 | — |  |
| `phone` | string | 否 | — |  |
| `wechat` | string | 否 | — |  |
| `email` | string | 否 | — |  |
| `address` | string | 否 | — |  |

## 副作用

更新客户字段（customers）。`intimacyLevel: null` 表示清除手动健康分档位、交算法兜底。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同一组字段重复提交结果一致。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 customerId 必填。客户关系（转介绍人等）请用 crm_addRelation，不在此内联。

## 典型说法

- 「把王五的层级改成决策人」
- 「王五升到 T2 了」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

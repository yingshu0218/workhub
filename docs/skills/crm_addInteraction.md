# `crm_addInteraction`

> 域：`crm` · 风险级：**medium** · 写工具

## 能力

记一条客户沟通日志（原子刷新最近联系时间）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `customerId` | string | 是 | — |  |
| `content` | string | 是 | — |  |
| `at` | number | 否 | — |  |
| `projectId` | string | 否 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 副作用

写入一条沟通记录（interactions）并在同事务内刷新客户的 lastContactAt（只前进、不倒退）；落库后广播 `customer:contacted`。

## 事件

- `customer:contacted`

## 幂等语义

非幂等：每次调用新建一条日志。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 customerId 必填且必须为消解后的真实 id。

## 典型说法

- 「今天和王五开了个需求会，进展顺利」
- 「补一条去年拜访过王五」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

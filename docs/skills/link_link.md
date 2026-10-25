# `link_link`

> 域：`link` · 风险级：**medium** · 写工具

## 能力

建立原子间关联（links 表，related / relation）

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

写一条 link 记录（幂等：同语义重复调用覆盖盖章）。无领域事件。关联随两端实体级联解绑/恢复。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：确定性 id，同语义重复调用不新增。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 fromId 与 toId 都要消解为真实 id。kind=related 用于一般关联（如流水↔客户）；kind=relation 用于客户间语义关系（必须带 label）。不支持 mention / attachment（分别由笔记保存与凭证流程托管）。

## 典型说法

- 「把这笔流水关联到客户王五」
- 「建立客户A与客户B的「转介绍人」关系」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

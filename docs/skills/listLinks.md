# `listLinks`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

查某实体的关联（双向合并）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `type` | enum(customer / todo / ledger / project / note / transaction / habit) | 是 | — |  |
| `id` | string | 是 | — |  |
| `kind` | enum(related / mention / relation / attachment) | 否 | — |  |

## 副作用

只读。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

id 须为真实 id（先经 resolveEntity 消解）；kind 缺省查全部；上限 50 条，超限截断并置 truncated=true。

## 典型说法

- 「王五都关联了哪些流水和笔记」
- 「客户A有哪些关系」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

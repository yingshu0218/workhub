# `getCustomer`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

读取单个客户档案摘要

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | string | 是 | — |  |

## 副作用

只读。返回基本档案 + intimacy 摘要 + relationCount（不含 relations 全量与附件）。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

customerId 须来自 resolveEntity 或 searchEntities。

## 典型说法

- 「看一下王五的档案」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

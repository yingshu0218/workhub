# `resolveEntity`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

把自然语言里的实体名消解为真实 id（写工具的前置）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `query` | string | 是 | — |  |
| `type` | enum(customer / project / todo / ledger / habit) | 是 | — |  |

## 副作用

只读，不落库、不产事件。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

候选按 id 去重；去重后唯一才静默消解，重名/命中超阈值返回 ambiguous 要求反问；空/过短输入前置拦截。

## 典型说法

- 「resolveEntity("深蓝科技","customer")」
- 「resolveEntity("家庭账本","ledger")」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

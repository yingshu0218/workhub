# `fin_createLedger`

> 域：`fin` · 风险级：**low** · 写工具

## 能力

新建账本

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | 是 | — |  |
| `currency` | enum(CNY / USD / EUR) | 否 | `"CNY"` |  |
| `openingBalance` | number | 否 | `0` |  |
| `closingCycle` | enum(月结 / 季结 / 年结 / 不封账) | 否 | `"月结"` |  |
| `isDefault` | boolean | 否 | `false` |  |

## 副作用

写入一条账本（ledgers）。isDefault=true 时先清其它账本 isDefault（全局唯一）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

非幂等：同名账本会重复创建。

## 实体引用规则

无实体引用；名称建议先 listLedgers 查重。

## 典型说法

- 「新建一个「家庭支出」账本，按月结」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

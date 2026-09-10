# `project_createProject`

> 域：`project` · 风险级：**low** · 写工具

## 能力

新建项目

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | 是 | — |  |
| `customerId` | string | 否 | — |  |
| `color` | string | 否 | — |  |
| `status` | enum(active / paused / archived) | 否 | `"active"` |  |
| `budget` | number | 否 | — |  |
| `note` | string | 否 | — |  |

## 副作用

写入一条项目（projects），默认状态 active。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

非幂等：同名项目会重复创建。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 customerId 若提供须为真实客户 id。

## 典型说法

- 「新建一个「Q4 出海」项目，挂到深蓝科技名下」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

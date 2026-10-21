# `habit_updateHabit`

> 域：`habit` · 风险级：**low** · 写工具

## 能力

编辑习惯（名称/图标/色板/节奏/目标时长/专注联动）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `habitId` | string | 是 | — |  |
| `name` | string | 否 | — |  |
| `icon` | string | 否 | — |  |
| `color` | string | 否 | — |  |
| `category` | string | 否 | — |  |
| `schedule` | string | 否 | — |  |
| `targetMinutes` | number | 否 | — |  |
| `motivationNote` | string | 否 | — |  |
| `crossModuleSync` | boolean | 否 | — |  |

## 副作用

更新习惯字段（habits）。历史打卡记录不受影响。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同一组字段重复提交结果一致。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 habitId 必填。打卡请用 habit_checkin（日志的确定性 id 与幂等都在那边），不在此内联。

## 典型说法

- 「把「跑步」的目标时长改成 40 分钟」
- 「早起习惯改成每周 5 次」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

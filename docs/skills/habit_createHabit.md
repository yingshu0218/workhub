# `habit_createHabit`

> 域：`habit` · 风险级：**low** · 写工具

## 能力

新建习惯（名称/图标/色板/节奏/目标时长）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | 是 | — |  |
| `icon` | string | 否 | — |  |
| `color` | string | 否 | — |  |
| `category` | string | 否 | — |  |
| `schedule` | string | 否 | — |  |
| `targetMinutes` | number | 否 | — |  |
| `motivationNote` | string | 否 | — |  |
| `crossModuleSync` | boolean | 否 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 副作用

写入一条习惯（habits）。默认值与界面「新建习惯」初值逐字段一致（图标 fitness_center、主色 #2563eb、节奏每日、目标 25 分钟、分类成长）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

非幂等：同名习惯会重复创建。

## 实体引用规则

无实体引用；新建前建议先 listHabits 查重。schedule 只接受「每日」「工作日」「每周N次」（N=1-7）。

## 典型说法

- 「帮我加一个每天跑步的习惯，目标 30 分钟」
- 「新建「工作日读书」习惯，每周 5 次」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

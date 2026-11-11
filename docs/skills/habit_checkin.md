# `habit_checkin`

> 域：`habit` · 风险级：**low** · 写工具

## 能力

习惯打卡 / 取消打卡

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `habitId` | string | 是 | — |  |
| `date` | string | 否 | — |  |
| `undo` | boolean | 否 | `false` |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 副作用

打卡：写入/复活一条习惯日志并广播 `habit:checked`（仅实际新建时）；undo=true 软删日志、不发事件。

## 事件

- `habit:checked`

## 幂等语义

幂等：同 habitId+date 重复打卡返回 `{ created:false }`，不重复入队、不重复发事件。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 habitId 必填。date 缺省=今天。

## 典型说法

- 「今天跑步打卡」
- 「取消今天跑步的打卡」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

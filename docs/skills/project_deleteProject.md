# `project_deleteProject`

> 域：`project` · 风险级：**high** · 写工具

## 能力

删除项目（不可逆，级联里程碑 + 解绑四表）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `projectId` | string | 是 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 副作用

软删项目并**级联软删其全部里程碑**；流水 / 待办 / 笔记 / 跟进**只解绑不删除**。返回 `sideEffects`（cascadedMilestones / unlinkedTransactions / unlinkedTodos / unlinkedNotes / unlinkedInteractions）。若只是阶段性结束，应优先建议 project_updateProject 归档。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：对已删项目重复调用返回可操作错误。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 projectId 必填。高风险；用户意图不明确时先反问「归档还是删除」。

## 典型说法

- 「把「Q4 出海」这个项目删掉」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

# `project_updateProject`

> 域：`project` · 风险级：**medium** · 写工具

## 能力

编辑项目（改名/归档/搁置/挂靠客户/预算）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `projectId` | string | 是 | — |  |
| `name` | string | 否 | — |  |
| `status` | enum(active / paused / archived) | 否 | — |  |
| `customerId` | string | 否 | — |  |
| `color` | string | 否 | — |  |
| `budget` | number | 否 | — |  |
| `note` | string | 否 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 副作用

更新项目字段（projects）。`status: "archived"` 即归档（项目不删除，历史关联保留）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同一组字段重复提交结果一致。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 projectId 必填；归档前建议先向用户确认。

## 典型说法

- 「把「Q4 出海」项目归档」
- 「这个项目先搁置」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

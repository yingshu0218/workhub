# `todo_createTodo`

> 域：`todo` · 风险级：**low** · 写工具

## 能力

新建待办（正文首行即标题）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `content` | string | 否 | — |  |
| `title` | string | 否 | — |  |
| `desc` | string | 否 | — |  |
| `priority` | enum(high / mid / low / none / P1 / P2 / P3) | 否 | `"none"` |  |
| `dueAt` | number | 否 | — |  |
| `customerId` | string | 否 | — |  |
| `listId` | string | 否 | — |  |
| `projectId` | string | 否 | — |  |
| `tags` | array | 否 | — |  |

## 副作用

写入一条待办（todos）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

非幂等：同标题会重复创建。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 customerId/projectId/listId 若提供必须为真实 id。dueAt 为毫秒时间戳。**正文优先用 content**（整体正文，标题 = 首行截 60 字、其余作备注）；title/desc 仍兼容但会被合并成同一正文，不要再当成两个独立字段使用。tags 为自由文本标签数组（与 UI 的 # 输入同款，去重保序、最多 12 个）。

## 典型说法

- 「周五前给深蓝出方案，高优先级」
- 「新建待办：季度复盘会
准备 Q3 数据」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

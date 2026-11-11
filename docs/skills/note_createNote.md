# `note_createNote`

> 域：`note` · 风险级：**low** · 写工具

## 能力

新建笔记

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `title` | string | 是 | — |  |
| `markdown` | string | 否 | `""` |  |
| `tags` | array | 否 | `[]` |  |
| `folderId` | string | 否 | — |  |
| `projectId` | string | 否 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 副作用

写入一条笔记（notes）。@提及与反向链接由编辑器解析，工具层不臆造（保持空数组）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

非幂等：同标题会重复创建。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 folderId/projectId 若提供须为真实 id（folderId 用 resolveEntity("noteFolder")）。

## 典型说法

- 「记一条笔记：深蓝科技需求要点如下…」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

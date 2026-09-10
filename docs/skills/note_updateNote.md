# `note_updateNote`

> 域：`note` · 风险级：**medium** · 写工具

## 能力

编辑笔记（标题/正文/标签/归属）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `noteId` | string | 是 | — |  |
| `title` | string | 否 | — |  |
| `markdown` | string | 否 | — |  |
| `tags` | array | 否 | — |  |
| `folderId` | string | 否 | — |  |
| `projectId` | string | 否 | — |  |

## 副作用

更新笔记字段（notes）。传 null 表示移出该归属（文件夹/项目）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：同一组字段重复提交结果一致。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 noteId 必填；folderId/projectId 目标须为真实 id。

## 典型说法

- 「把「需求要点」这条笔记挪到 Q3 复盘目录」

## 确认流程

中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

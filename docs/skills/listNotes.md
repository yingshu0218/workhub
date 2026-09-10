# `listNotes`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

列笔记（标题/标签/归属，**不含正文**）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `q` | string | 否 | — |  |
| `folderId` | string | 否 | — |  |
| `projectId` | string | 否 | — |  |
| `tag` | string | 否 | — |  |

## 副作用

只读。投影**不含 markdown 正文**（只给长度），防上下文膨胀；需要正文请转到界面查看。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

folderId/projectId 若提供须为真实 id；上限 50 条，超限截断并置 truncated=true。

## 典型说法

- 「Q3 复盘目录里有哪些笔记」
- 「带 #出海 标签的笔记」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

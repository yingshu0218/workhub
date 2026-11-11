# `note_createFolder`

> 域：`note` · 风险级：**low** · 写工具

## 能力

新建笔记文件夹

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | 是 | — |  |
| `requestId` | string | 否 | — | 稳定请求标识，首次提交前确定，重试复用。 |
| `generation` | string | 否 | — | 原数据世代，由查询返回。 |
| `confirmToken` | string | 否 | — | 按具体预览提示取得的一次性确认票据。 |

## 副作用

写入一条文件夹（noteFolders，单层平铺）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

非幂等：同名文件夹会重复创建。

## 实体引用规则

无实体引用；建议先 searchEntities 查重。

## 典型说法

- 「新建一个「Q3 复盘」笔记文件夹」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

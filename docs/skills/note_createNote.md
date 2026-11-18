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

## 请求上下文与权限

低风险直接写入在首次调用前必须提供稳定 requestId 与当前 generation。中/高风险首次预览若缺少这两项，服务端可补齐并返回实际值；之后的取票、查询回执与重试必须沿用原参数及返回的 requestId/generation。改变意图使用新 requestId 并重新预览。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。


## 副作用

写入一条笔记（notes）。@提及与反向链接由编辑器解析，工具层不臆造（保持空数组）。无领域事件。

## 事件

本工具不产生领域事件。

## 幂等语义

非幂等：同标题会重复创建。

## 实体引用规则

实体引用（客户/项目/待办/账本/笔记/文件夹）必须先通过对应的授权查询消解；候选不唯一必须反问答用户，禁止猜 id。历史习惯只读，不可作为写入关联。 folderId/projectId 若提供须为真实 id（folderId 用 resolveEntity("noteFolder")）。

## 典型说法

- 「记一条笔记：深蓝科技需求要点如下…」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

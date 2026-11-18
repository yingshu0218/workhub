# `get_activity`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

读取一条活动详情、允许读取的正文片段与关联摘要

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `view` | enum(relations / history / effects) | 否 | — |  |
| `generation` | string | 否 | — |  |
| `cursor` | string | 否 | — |  |
| `limit` | number | 否 | — |  |
| `id` | string | 否 | — |  |
| `operationId` | string | 否 | — |  |
| `requestId` | string | 否 | — |  |
| `query` | string | 否 | — |  |
| `identity` | string | 否 | — |  |
| `table` | enum(activities / customers / projects / todos / transactions / notes / attachments) | 否 | — |  |
| `contactId` | string | 否 | — |  |
| `topicId` | string | 否 | — |  |
| `category` | string | 否 | — |  |
| `sourceType` | enum(activity / task_change / legacy_finance) | 否 | — |  |
| `q` | string | 否 | — |  |
| `from` | anyOf | 否 | — |  |
| `to` | anyOf | 否 | — |  |
| `timeZone` | string | 否 | — |  |
| `referenceAt` | number | 否 | — |  |
| `status` | string | 否 | — |  |
| `type` | enum(income / expense) | 否 | — |  |
| `ledgerId` | string | 否 | — |  |
| `due` | enum(undated / today / overdue / all) | 否 | — |  |
| `depth` | number | 否 | — |  |
| `includeSource` | boolean | 否 | — |  |
| `sourceOffset` | number | 否 | — |  |
| `sourceLimit` | number | 否 | — |  |
| `fields` | array | 否 | — |  |
| `bodyOffset` | number | 否 | — |  |
| `bodyLimit` | number | 否 | — |  |
| `revision` | number | 否 | — |  |

## 参数使用说明

活动摘要详情用 fields:["summary"] 与 bodyLimit；续读时仅在 nextOffset 非 null 时传 details.summary.nextOffset 作为 bodyOffset，并复用响应 generation 与 revision。原始 source 是另一条分段通道：includeSource:true、sourceLimit；仅在 source.nextOffset 非 null 时将它作为 sourceOffset，并同样复用 generation 与 revision。两种 offset 都必须来自上一响应；source 只有 source:read 能力可返回。

## 请求上下文与权限

只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 读取活动摘要首段（参数模板）

```json
{
  "id": "<获授权查询返回的活动ID>",
  "fields": [
    "summary"
  ],
  "bodyLimit": 2000
}
```

### 读取原始来源首段（需要 source:read）

```json
{
  "id": "<获授权查询返回的活动ID>",
  "includeSource": true,
  "sourceLimit": 2000
}
```

### 续读摘要（参数模板）

```json
{
  "id": "<同一活动ID>",
  "generation": "<首段响应的generation>",
  "revision": 3,
  "fields": [
    "summary"
  ],
  "bodyOffset": 2000,
  "bodyLimit": 2000
}
```

把 revision=3 和 bodyOffset=2000 替换为首段返回的 details.summary.revision 与 nextOffset。

### 续读原始来源（需要 source:read）

```json
{
  "id": "<同一活动ID>",
  "generation": "<首段响应的generation>",
  "revision": 3,
  "includeSource": true,
  "sourceOffset": 2000,
  "sourceLimit": 2000
}
```

把 revision=3 和 sourceOffset=2000 替换为首段返回的 source.revision 与 nextOffset。


## 副作用

只读；正文按需分段返回，关联和历史有上限。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读；详细字段按记录 revision 读取，内容变化后需刷新查询。

## 实体引用规则

id 必须来自当前凭据获授权的活动查询；原始来源需额外 source:read 并显式设置 includeSource。工具只返回当前授权投影，不表示可读取源数据或全部关联记录。

## 典型说法

- 「读取当前授权范围内的一条活动详情」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

# `get_record`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

读取授权记录详情、特定正文片段、关联或审计历史

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

默认笔记列表/投影不含正文。读取笔记正文需 fields:["markdown"]；单次 bodyLimit 最大 4000。续读时带 generation、revision、bodyOffset。view 可为 relations 或 history，分页沿用 nextCursor。

## 请求上下文与权限

只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 读取笔记正文首段

```json
{
  "table": "notes",
  "id": "<note-id>",
  "fields": [
    "markdown"
  ],
  "bodyLimit": 2000
}
```

### 分页查看待办历史

```json
{
  "table": "todos",
  "id": "<todo-id>",
  "view": "history",
  "limit": 20
}
```


## 副作用

只读；正文、来源、关联和历史均按字段、权限与游标限幅。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读；正文续读必须绑定返回的 generation 与 revision。

## 实体引用规则

table 与 id 仅限凭据可读的活动、联系人、事项、待办、收支、笔记或附件。操作历史另受 operation:read 控制。

## 典型说法

- 「读取一篇笔记正文」
- 「查看一条待办的变更历史」
- 「核对一条记录的关联」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

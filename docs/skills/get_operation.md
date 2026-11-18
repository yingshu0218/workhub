# `get_operation`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

按操作编号或原请求编号读取当前客户端可见的操作回执与影响

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

按 requestId 查询时带原 generation；按 operationId 查询时使用当前凭据可见的 list_operations/get_operation 返回的 id。view=effects 需要 operation:read，并且只返回当前客户端可见且有权读取的效果。

## 请求上下文与权限

只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 核对未知结果（参数模板）

```json
{
  "requestId": "agent_req_example_01",
  "generation": "<原请求的数据世代>"
}
```

### 读取当前可见操作影响明细

```json
{
  "operationId": "<本客户端查询返回的operationId>",
  "view": "effects",
  "limit": 50
}
```


## 副作用

只读；回执、变更和效果明细按授权投影返回。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读；操作明细可能分页，游标绑定当前客户端与水位。

## 实体引用规则

Agent 凭据只能读取自己发起的操作；拥有者可读工作区记录，但仍不能替其他 Agent 撤回。

## 典型说法

- 「核对原 requestId 对应的操作是否已提交」
- 「读取当前凭据可见操作的 effects」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

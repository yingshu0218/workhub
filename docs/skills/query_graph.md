# `query_graph`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

从授权记录出发查询一至两层实体关联图

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

传 table、id、depth(1–2)；from/to 可限制带时间记录的范围。若 truncated=true 且 continuation.kind="focus_node"，continuation 只是续查建议，不是游标或 focus_node ID。选 items 中一个仍有用的节点，把它自己的 table/id 作为下一次 query_graph 的根，设置 depth:1；必要时沿用原 from/to。

## 请求上下文与权限

只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 从活动查询一层关联（参数模板）

```json
{
  "table": "activities",
  "id": "<获授权查询返回的活动ID>",
  "depth": 1
}
```

### 以返回的联系人节点为新根继续聚焦（参数模板）

```json
{
  "table": "customers",
  "id": "<上一响应中某个获授权节点的ID>",
  "depth": 1
}
```

table 必须复制该节点实际返回的合法类型，id 复制同一节点的 ID；此处 customers 仅为 schema 合法的合成模板值。


## 副作用

只读；最多返回 100 节点、200 条边，超限提供聚焦建议。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读；节点和边按每个表的读取能力过滤。

## 实体引用规则

根节点 table/id 必须来自当前凭据获授权的查询；每个端点仍按各自读取能力过滤，图查询不会扩大来源或整库读取权限。

## 典型说法

- 「从一条已授权活动查询其可见关联」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

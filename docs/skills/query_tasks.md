# `query_tasks`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

查询授权范围内的待办、截止情况和关联上下文

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

有效筛选为 q、status(todo/done/voided/all)、due(undated/today/overdue/all)、contactId、topicId、limit。此工具不按 from/to 日期区间筛选；due 的日界 timeZone 仅支持 Asia/Shanghai 与 UTC，未传时默认 Asia/Shanghai。其他时区会被拒绝；不要用 from/to 假装限制截止日期。

## 请求上下文与权限

只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 查询今天到期的待办（参数模板）

```json
{
  "status": "todo",
  "due": "today",
  "limit": 20,
  "timeZone": "Asia/Shanghai"
}
```

### 查询已作废待办（参数模板）

```json
{
  "status": "voided",
  "due": "all",
  "limit": 20,
  "timeZone": "UTC"
}
```


## 副作用

只读；每页最多 50 项，返回总匹配数和继续游标。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读；cursor 绑定相同筛选、客户端、世代与数据水位。

## 实体引用规则

contactId/topicId 使用当前凭据获授权查询返回的联系人/事项 ID；筛选不扩大读取能力，也不代表全部待办。

## 典型说法

- 「查询授权范围内今天到期的待办」
- 「按关键词搜索授权范围内的未完成任务」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

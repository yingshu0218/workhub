# `search_activities`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

按日期、关键词、联系人或事项查询活动时间线

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

使用 from/to、q、contactId、topicId、sourceType(activity/task_change/legacy_finance) 和 limit 控制范围。默认时区为 Asia/Shanghai；纯日期 YYYY-MM-DD 会按该时区解释，to 包含整天。下一页只复用响应的 nextCursor 与原筛选；游标失效时重新查询，不要假设已有整库结果。

## 请求上下文与权限

只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 按合成关键词与日期检索（参数模板）

```json
{
  "q": "示例关键词",
  "from": "2026-01-01",
  "to": "2026-01-31",
  "limit": 20,
  "timeZone": "Asia/Shanghai"
}
```


## 副作用

只读；返回最多 50 条有界投影，提供 generation、watermark 与继续游标。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读；游标绑定同一客户端、筛选、世代和数据水位。数据变化后须重新查询。

## 实体引用规则

contactId/topicId 使用当前凭据获授权查询返回的 ID；没有相应读取能力的实体不会出现在结果中，结果也不代表完整时间线。

## 典型说法

- 「搜索与用户指定联系人有关的授权活动」
- 「查看最近关于某合成关键词的时间线记录」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

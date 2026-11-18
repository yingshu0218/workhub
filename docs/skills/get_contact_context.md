# `get_contact_context`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

读取一个联系人的获授权上下文、近期活动、承诺和收支摘要

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

id 必填；from/to 只限定关联收支的日期范围，不筛选活动或待办。联系人、活动、待办和收支分别按各自能力过滤；缺少域能力时关联部分会省略或标记受限。

## 请求上下文与权限

只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 按已消解联系人查询（参数模板）

```json
{
  "id": "<当前凭据获授权查询返回的联系人ID>",
  "from": "2026-01-01",
  "to": "2026-01-31",
  "timeZone": "Asia/Shanghai"
}
```


## 副作用

只读；每类关联有界；缺少其他域能力时会省略或标记受限。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读；返回范围受该凭据能力限制。

## 实体引用规则

id 必须来自当前凭据可读取的联系人查询；不会扩大联系人或相关域授权，也不保证包含所有关联。

## 典型说法

- 「查看用户指定联系人的授权上下文」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

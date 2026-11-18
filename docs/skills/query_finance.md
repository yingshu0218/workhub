# `query_finance`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

按账本、收支类型、状态、日期或关联对象查询并汇总授权收支

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

使用 from/to、ledgerId、type(income/expense)、status、q、contactId、topicId 和 limit 缩小查询。默认 timeZone 为 Asia/Shanghai；纯日期 YYYY-MM-DD 按该时区解释，to 包含整天。纯日期也支持 UTC；其他时区请传带明确 UTC 偏移的日期时间。此查询没有 amount/minAmount/maxAmount 参数；明细 amountMinor 与汇总 incomeMinor/expenseMinor 均为最小货币单位。

## 请求上下文与权限

只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 查询合成日期范围内的支出（参数模板）

```json
{
  "type": "expense",
  "from": "2026-01-01",
  "to": "2026-01-31",
  "timeZone": "Asia/Shanghai",
  "limit": 20
}
```


## 副作用

只读；明细金额字段为 amountMinor，汇总为 incomeMinor/expenseMinor，响应标明 amountUnit:"minor"。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读；结果范围受 fin:read 及关联域能力约束。

## 实体引用规则

ledgerId、contactId、topicId 必须来自当前凭据获授权查询的真实记录；结果受逐域授权过滤，不表示可读取整库。金额字段使用最小货币单位，不要把展示金额当作 amountMinor。

## 典型说法

- 「按用户指定日期汇总已授权收支」
- 「查看授权账本中的待核对流水」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

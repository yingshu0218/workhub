# `preview_capture`

> 域：`read` · 风险级：**low** · 写工具

## 能力

预览新增活动及其联系人、事项、待办和收支的整组录入计划

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |
| `input` | object | 是 | — |  |

## 参数使用说明

requestId 与 generation 是顶层字段。input.contacts、input.topics、input.activities 是同级数组；活动可用 contactIds/topicIds 引用同次 input 中联系人/事项的 key；relations.fromContactId/toContactId 也可引用 input.contacts 中的 key。引用已有真实 ID 前须获授权核实。所有 key 在一次输入内保持唯一且不超过 80 字符。新联系人/事项需 name；新待办需 key 和 title。新流水字段为 key、existingId、fact、amountMinor、currency、ledgerId、type、summary、occurredAt、status、note、channel、duplicateDecision：新建实际流水必需 key、fact:"occurred"、正整数最小单位 amountMinor、currency(CNY/USD/EUR 且与账本相同)、已核实 ledgerId 和 type(income/expense)；summary 默认活动标题，occurredAt 默认活动时间，status 仅可为“已结算”或“待对账”，note/channel 可选。fact 虽接受 quote/invoice/expected 的 schema 值，但新建活动流水必须是 occurred；报价、开票或预计款不能作为已发生流水。若只关联已有流水，先核实身份并仅用 existingId；该路径只建立关联，不更新已有流水，不要混传新建字段。若预览发现疑似重复，先核对候选并让用户决定，只有明确决定新建才传 duplicateDecision:"new" 并重做预览。未来安排应建待办，不要伪装成已发生活动。下面是合成参数模板，不代表工作区数据，替换所有 ID/世代后再预览。

## 请求上下文与权限

必填顶层字段 requestId 与 generation；requestId 在本客户端和当前世代内固定绑定完整输入。结果未知先按原 requestId 查回执，不要换号重录。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 预览合成活动、关联和流水（参数模板）

```json
{
  "requestId": "agent_capture_example_01",
  "generation": "<当前数据世代>",
  "input": {
    "contacts": [
      {
        "key": "contact-1",
        "name": "示例联系人"
      }
    ],
    "topics": [
      {
        "key": "topic-1",
        "name": "示例事项"
      }
    ],
    "activities": [
      {
        "key": "activity-1",
        "title": "示例需求会",
        "occurredAt": "2026-01-15",
        "timePrecision": "date",
        "timeZone": "Asia/Shanghai",
        "contactIds": [
          "contact-1"
        ],
        "topicIds": [
          "topic-1"
        ],
        "transactions": [
          {
            "key": "transaction-1",
            "fact": "occurred",
            "amountMinor": 12000,
            "currency": "CNY",
            "ledgerId": "<获授权核实的CNY账本ID>",
            "type": "expense",
            "summary": "示例支出",
            "occurredAt": "2026-01-15",
            "status": "待对账",
            "note": "示例附注",
            "channel": "示例渠道"
          }
        ],
        "tasks": [
          {
            "key": "task-1",
            "title": "整理示例需求"
          }
        ]
      }
    ]
  }
}
```

合成模板。使用 existingId 时不重复新建对应记录；只有确认候选不是同一笔流水且用户明确决定新建时，才使用 duplicateDecision:"new"。仅预览不会提交业务事实。


## 副作用

保存待确认计划与 requestId；不提交业务事实。

## 事件

本工具不产生领域事件。

## 幂等语义

同 requestId、generation、客户端与输入返回原预览；改变输入需新 requestId。

## 实体引用规则

引用既有 ID 前先用当前凭据获授权的查询确认；新建联系人/事项可用 input.contacts/input.topics 中的稳定 key，并在 activities.contactIds/topicIds 中按 key 引用。预览不会授予额外读取能力。

## 典型说法

- 「先预览一条合成活动及其明确提供的关联」

## 确认流程

预览工具本身不提交业务事实，但会保存待确认计划。先检查完整 changes/影响，并按返回的 `confirmHint.args` 请求用户确认、取票和调用对应 `commit_*`。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

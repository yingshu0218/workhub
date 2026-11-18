# `preview_amend`

> 域：`read` · 风险级：**low** · 写工具

## 能力

预览对一组既有记录的修正计划

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |
| `input` | object | 是 | — |  |

## 参数使用说明

input.changes 每项包含 table、id、expectedRev、patch；引用关系变化使用相应 contactIds/topicIds 字段。以下是参数模板；patch 字段仍须受服务端支持的字段白名单约束，传入 schema 接受但服务端不支持的字段会报错。

## 请求上下文与权限

必填顶层字段 requestId 与 generation；requestId 在本客户端和当前世代内固定绑定完整输入。结果未知先按原 requestId 查回执，不要换号重录。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 预览一项待办修改（参数模板）

```json
{
  "requestId": "agent_amend_example_01",
  "generation": "<当前数据世代>",
  "input": {
    "changes": [
      {
        "table": "todos",
        "id": "<获授权查询返回的待办ID>",
        "expectedRev": 3,
        "patch": {
          "status": "done"
        }
      }
    ]
  }
}
```

仅预览修改。只有用户查看并确认完整 changes 后，才进入 confirm_preview → commit_amend。


## 副作用

保存待确认计划；基于 expectedRev 检查并显示全部变更，不提交业务事实。

## 事件

本工具不产生领域事件。

## 幂等语义

requestId 绑定本客户端、本世代和整组目标；变更内容时使用新 requestId 并重新查询版本。

## 实体引用规则

targets 的 id 与 expectedRev 必须来自当前凭据获授权的查询；只提交用户要求且受支持的字段。

## 典型说法

- 「先预览把一条已授权待办改为完成」

## 确认流程

预览工具本身不提交业务事实，但会保存待确认计划。先检查完整 changes/影响，并按返回的 `confirmHint.args` 请求用户确认、取票和调用对应 `commit_*`。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

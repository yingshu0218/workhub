# `preview_delete`

> 域：`read` · 风险级：**low** · 写工具

## 能力

预览删除指定记录及其级联、解绑影响

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |
| `input` | object | 是 | — |  |

## 参数使用说明

input.targets 为 1–100 项，每项包含 table、id、expectedRev。以下为合成参数模板；逐项核对预览的变化与副作用后再请求用户确认。

## 请求上下文与权限

必填顶层字段 requestId 与 generation；requestId 在本客户端和当前世代内固定绑定完整输入。结果未知先按原 requestId 查回执，不要换号重录。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 预览删除待办（参数模板）

```json
{
  "requestId": "agent_delete_example_01",
  "generation": "<当前数据世代>",
  "input": {
    "targets": [
      {
        "table": "todos",
        "id": "<获授权查询返回的待办ID>",
        "expectedRev": 3
      }
    ]
  }
}
```

仅预览，不会删除记录。


## 副作用

保存待确认计划；不立即删除，返回每个目标和影响。

## 事件

本工具不产生领域事件。

## 幂等语义

requestId 绑定完整目标集、版本与客户端；目标或版本变化后新建预览。

## 实体引用规则

每个 target 的 table、id、expectedRev 必须来自当前凭据获授权的查询/详情；用户确认具体影响前不得提交。

## 典型说法

- 「先预览删除一条已核实的待办会影响什么」

## 确认流程

预览工具本身不提交业务事实，但会保存待确认计划。先检查完整 changes/影响，并按返回的 `confirmHint.args` 请求用户确认、取票和调用对应 `commit_*`。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

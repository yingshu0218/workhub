# `preview_undo`

> 域：`read` · 风险级：**low** · 写工具

## 能力

预览撤销一项已提交操作会恢复或重做的变化

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |
| `input` | object | 是 | — |  |

## 参数使用说明

input.operationId 指向已提交操作；执行前检查完整 changes 与冲突提示。以下为参数模板，仅对本客户端获授权且已提交的操作有效；用户确认全部影响前不得 commit。

## 请求上下文与权限

必填顶层字段 requestId 与 generation；requestId 在本客户端和当前世代内固定绑定完整输入。结果未知先按原 requestId 查回执，不要换号重录。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 预览撤销操作（参数模板）

```json
{
  "requestId": "agent_undo_example_01",
  "generation": "<当前数据世代>",
  "input": {
    "operationId": "<本客户端查询返回的已提交operationId>"
  }
}
```


## 副作用

保存待确认撤销计划；检查后续依赖冲突，不立即改动业务数据。

## 事件

本工具不产生领域事件。

## 幂等语义

稳定 requestId 重放同一预览；如果目标已变化，按冲突错误重新查询，不跳过依赖检查。

## 实体引用规则

operationId 必须来自当前凭据可读取的 get_operation/list_operations；查询不到不代表可猜测或使用其他客户端的 ID。

## 典型说法

- 「先检查本人可见操作，再预览撤销」

## 确认流程

预览工具本身不提交业务事实，但会保存待确认计划。先检查完整 changes/影响，并按返回的 `confirmHint.args` 请求用户确认、取票和调用对应 `commit_*`。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

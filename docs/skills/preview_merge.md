# `preview_merge`

> 域：`read` · 风险级：**low** · 写工具

## 能力

预览合并两个联系人及其关联迁移；当前不支持合并项目/事项

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |
| `input` | object | 是 | — |  |

## 参数使用说明

input 需要 sourceId、targetId 和双方最新 revision；本工具目前只合并联系人，不支持项目/事项合并。以下 ID、版本和请求上下文均为参数模板，必须以授权查询结果替换。

## 请求上下文与权限

必填顶层字段 requestId 与 generation；requestId 在本客户端和当前世代内固定绑定完整输入。结果未知先按原 requestId 查回执，不要换号重录。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 预览两个联系人合并（参数模板）

```json
{
  "requestId": "agent_merge_example_01",
  "generation": "<当前数据世代>",
  "input": {
    "sourceId": "<来源联系人ID>",
    "targetId": "<目标联系人ID>",
    "sourceRev": 2,
    "targetRev": 4
  }
}
```


## 副作用

保存待确认合并计划；合并前核对联系人及双方关联影响。

## 事件

本工具不产生领域事件。

## 幂等语义

requestId 绑定源、目标、版本和客户端；改变任一项必须新预览。

## 实体引用规则

当前实现只接受 customers 联系人 ID。sourceId/targetId 与 sourceRev/targetRev 必须来自当前凭据获授权的联系人详情；项目/事项不能传给此工具。

## 典型说法

- 「先核实两个联系人，再预览联系人合并」

## 确认流程

预览工具本身不提交业务事实，但会保存待确认计划。先检查完整 changes/影响，并按返回的 `confirmHint.args` 请求用户确认、取票和调用对应 `commit_*`。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

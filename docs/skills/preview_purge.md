# `preview_purge`

> 域：`read` · 风险级：**low** · 写工具

## 能力

预览永久清理指定记录及其级联影响；目标可包含活动记录

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |
| `input` | object | 是 | — |  |

## 参数使用说明

input.targets 为 1–100 项，每项包含 table、id、expectedRev。与 preview_delete 区分：purge 是物理永久清理，可涉及活动记录，也可能扩展清理关联/附件。逐项确认目标身份和完整清理范围；若包含仍在使用的活动记录，必须明确向用户说明后再取得确认。以下只是活动记录参数模板，不表示当前工作区存在该记录。

## 请求上下文与权限

必填顶层字段 requestId 与 generation；requestId 在本客户端和当前世代内固定绑定完整输入。结果未知先按原 requestId 查回执，不要换号重录。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 预览永久清理一条活动（参数模板）

```json
{
  "requestId": "agent_purge_example_01",
  "generation": "<当前数据世代>",
  "input": {
    "targets": [
      {
        "table": "activities",
        "id": "<已核实的活动ID>",
        "expectedRev": 5
      }
    ]
  }
}
```

不执行清理。提交前必须展示服务端预览及其全部级联影响，并取得用户明确确认。


## 副作用

保存待确认计划；预览本身不清理数据，提交后永久清除计划目标及清理范围。

## 事件

本工具不产生领域事件。

## 幂等语义

requestId 绑定完整目标集、版本与客户端；任何变化都需重新预览。

## 实体引用规则

当前服务端允许清理任何已存在且有写权限的目标，包括未删除的活动记录；只有用户明确要求永久清理时使用。ID/revision 必须来自用户提供或当前凭据获授权的记录详情。get_record 不返回已删除记录；回收站目标的 ID/revision 需由拥有者从回收站界面核实提供。

## 典型说法

- 「先核实目标和影响，再预览用户明确要求的永久清理」

## 确认流程

预览工具本身不提交业务事实，但会保存待确认计划。先检查完整 changes/影响，并按返回的 `confirmHint.args` 请求用户确认、取票和调用对应 `commit_*`。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

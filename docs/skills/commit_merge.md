# `commit_merge`

> 域：`read` · 风险级：**high** · 写工具

## 能力

提交已确认的联系人合并计划

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |
| `previewId` | string | 是 | — |  |
| `confirmToken` | string | 否 | — |  |

## 参数使用说明

仅按 preview_merge 返回的 confirmHint.args 调用 confirm_preview 取票；用户明确确认完整影响后，携带原 requestId、generation、previewId 和 confirmToken。以下为参数模板。

## 请求上下文与权限

必填顶层字段 requestId、generation、previewId；confirmToken 由 relay 的 confirm_preview 签发并在 MCP 入参中随 commit 提交。四项都必须来自同一客户端、同一原预览。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 提交已确认联系人合并（参数模板）

```json
{
  "requestId": "agent_merge_example_01",
  "generation": "<原预览generation>",
  "previewId": "<原预览previewId>",
  "confirmToken": "<confirm_preview返回的一次性token>"
}
```


## 副作用

按预览原子迁移联系人关联并完成合并，返回持久回执。

## 事件

本工具不产生领域事件。

## 幂等语义

相同请求重试返回持久回执；目标版本变化须重新预览。

## 实体引用规则

只能提交本客户端 preview_merge 的有效联系人合并计划；当前不支持合并项目/事项。

## 典型说法

- 「用户确认联系人关联影响后提交合并」

## 确认流程

提交工具的执行权限为 high。先调用对应的 `preview_merge`，向用户转述具体计划并取得确认，再按预览返回的 `confirmHint.args` 调用 `confirm_preview`，最后带原 requestId/generation/previewId 和一次性 confirmToken 重试本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

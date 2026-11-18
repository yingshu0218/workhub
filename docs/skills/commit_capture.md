# `commit_capture`

> 域：`read` · 风险级：**medium** · 写工具

## 能力

提交已确认的活动录入计划

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |
| `previewId` | string | 是 | — |  |
| `confirmToken` | string | 否 | — |  |

## 参数使用说明

仅按 preview_capture 返回的 confirmHint.args 调用 confirm_preview 取票；只有用户明确确认完整影响后，才携带原 requestId、generation、previewId 与 relay confirmToken 调用本工具。以下是非真实的参数模板。

## 请求上下文与权限

必填顶层字段 requestId、generation、previewId；confirmToken 由 relay 的 confirm_preview 签发并在 MCP 入参中随 commit 提交。四项都必须来自同一客户端、同一原预览。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 提交已确认录入（参数模板）

```json
{
  "requestId": "agent_capture_example_01",
  "generation": "<原预览generation>",
  "previewId": "<原预览previewId>",
  "confirmToken": "<confirm_preview返回的一次性token>"
}
```


## 副作用

原子提交相应联系人、事项、活动及其它预览变更；返回持久回执。

## 事件

本工具不产生领域事件。

## 幂等语义

相同请求和预览的重试返回原回执；同一 requestId 不能改参数或换客户端。

## 实体引用规则

只提交同一 requestId/generation/client 的有效 preview_capture。

## 典型说法

- 「用户检查并确认整组预览后提交活动录入」

## 确认流程

提交工具的执行权限为 medium。先调用对应的 `preview_capture`，向用户转述具体计划并取得确认，再按预览返回的 `confirmHint.args` 调用 `confirm_preview`，最后带原 requestId/generation/previewId 和一次性 confirmToken 重试本工具。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

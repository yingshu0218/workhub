# `cancel_operation`

> 域：`read` · 风险级：**low** · 写工具

## 能力

撤回当前客户端自己的待确认操作

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `requestId` | string | 是 | — |  |
| `generation` | string | 是 | — |  |

## 参数使用说明

requestId 指向原预览，不是为撤回新建的编号；generation 必须沿用那次预览的数据世代。以下仅为参数模板，必须替换为本客户端实际预览返回的值。

## 请求上下文与权限

用原待确认操作的 requestId 与 generation；仅该预览发起客户端可撤回，不能撤回已提交操作。 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。

## MCP 入参示例

### 撤回自己的待确认操作（参数模板）

```json
{
  "requestId": "agent_req_example_01",
  "generation": "<原数据世代>"
}
```


## 副作用

将本人发起且仍待确认的操作标记为已撤回并清理计划；不影响其他客户端。

## 事件

本工具不产生领域事件。

## 幂等语义

同一 requestId/generation 的重复撤回返回已撤回回执；已提交操作不可取消。

## 实体引用规则

只能使用当前 Agent 凭据创建的原 requestId 与原 generation；拥有者网页不能代 Agent 撤回。已提交操作请走 preview_undo。

## 典型说法

- 「撤回我刚才发起但还没确认的录入」

## 确认流程

撤回只作用于本客户端自己的待确认操作，不需要确认票；执行前核对原 requestId 与 generation。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

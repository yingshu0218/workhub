# `searchEntities`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

兼容全局搜索（活动/客户/待办/流水/笔记/项目）；独立配对 Agent 当前不能调用，请使用按域查询工具

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `q` | string | 是 | — |  |
| `types` | array | 否 | — |  |

## 参数使用说明

此兼容工具目前不适用于后台配对的独立 Agent；不要用 types 参数尝试扩大能力。按数据域使用具名只读工具，例如客户用 resolve_contacts，事项用 resolve_topics，待办用 query_tasks，活动用 search_activities，笔记用 listNotes。

## MCP 入参示例

### 兼容调用形状（独立配对凭据会拒绝）

```json
{
  "q": "深蓝",
  "types": [
    "customer",
    "project"
  ]
}
```

仅用于仍获授权的兼容调用；独立 Agent 请选择上面的定域工具。


## 副作用

只读。返回投影白名单字段（不含 markdown/附件）。独立配对凭据的服务端权限映射当前不允许调用此工具；目录可见不代表有执行权限。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

兼容范围仅限 schema 中的 activity/customer/todo/transaction/note/project。独立 Agent 直接调用会被拒绝；请改用 resolve_contacts、resolve_topics、query_tasks、search_activities 或 listNotes 等有定域授权的查询。结果上限 20 条，超限截断并置 truncated=true。

## 典型说法

- 「搜索客户、待办或笔记中的「深蓝」」
- 「列出与「Q4 出海」事项有关的活动」

## 确认流程

低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

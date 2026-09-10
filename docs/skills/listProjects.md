# `listProjects`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

列项目（可按状态/挂靠客户过滤）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `status` | enum(active / paused / archived) | 否 | — |  |
| `customerId` | string | 否 | — |  |

## 副作用

只读。返回投影白名单（不含里程碑与关联全量）。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

customerId 若提供须为真实 id；上限 50 条，超限截断并置 truncated=true。

## 典型说法

- 「有哪些进行中的项目」
- 「深蓝科技名下有哪些项目」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

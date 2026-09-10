# `searchEntities`

> 域：`read` · 风险级：**low** · 读工具（只读，不产事件）

## 能力

全局搜索（客户/项目/待办/笔记/账本/习惯）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `q` | string | 是 | — |  |
| `types` | array | 否 | — |  |

## 副作用

只读。返回投影白名单字段（不含 markdown/附件）。

## 事件

本工具不产生领域事件。

## 幂等语义

纯读，天然幂等。

## 实体引用规则

结果上限 20 条，超限截断并置 truncated=true。

## 典型说法

- 「搜「深蓝」相关的客户和项目」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

# `fin_deleteTransaction`

> 域：`fin` · 风险级：**high** · 写工具

## 能力

删除流水（不可逆，级联清凭证存根）

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `transactionId` | string | 是 | — |  |

## 副作用

软删流水并**级联软删其全部附件存根**（transactions + attachments）。高风险、不可逆，返回 `sideEffects.cascadedAttachments` 供转述。

## 事件

本工具不产生领域事件。

## 幂等语义

幂等：对已删流水重复调用返回可操作错误。

## 实体引用规则

实体引用（客户/项目/待办/账本/习惯）必须先调 `resolveEntity` 消解；候选不唯一必须反问答用户，禁止猜 id。 transactionId 必填。执行前必须告知用户将一并删除的凭证数。

## 典型说法

- 「把刚才那笔重复的 120 删掉」

## 确认流程

低风险：直接执行，结果可撤销（undo）。

---
_本文件由 `scripts/gen-skills.mjs` 从 `src/agent/skillSource.ts`（agentOps zod schema）自动生成，请勿手改。_

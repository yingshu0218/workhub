# agentOps 门面 P1 第 1 步 — 交付说明

> Issue: #33 · 方案: docs/agent-bridge-skill-v0.4.md（v0.7）§9.7 第 1 步
> 分支: feat/agentops-facade · 作者: npc/CodeBuddy(glm-5.3-flash)

## 交付物

| 文件 | 内容 |
|---|---|
| src/agent/schema.ts | 7 个写工具的 zod 入参 schema + 风险分级（TOOL_RISK）+ 事件声明（TOOL_EVENTS 声明表） |
| src/agent/executor.ts | agentOps 执行器：zod 校验 → 落库（repositories 复合/原子函数）→ 事务 commit 后统一 emit |
| src/agent/createCustomerWithInit.ts | 自 modules/crm/hooks.ts 下沉的建档复合函数（逐行等价搬迁，供 executor 依赖，不反向依赖业务模块） |
| src/agent/__tests__/agentOps.alignment.test.ts | 事件对齐对照测试（21 条） |
| vitest.config.ts + package.json test 脚本 | 测试基建（vitest + fake-indexeddb，devDependencies） |

## 覆盖的方案要点

1. **事件单点收口**：emit 只在 executor 成功分支，永不在事务体内（测试 3 验证「先落库可观察、后 emit」）。
2. **断点 transaction:created 载荷对齐**：与 UI `TransactionFormDrawer:213` emit 逐字段一致（测试 1），无多余字段。
3. **§9.3 D5/D7**：status 缺省=待对账；occurredAt 落当天 00:00；ledgerId 无效 → 可操作错误「请先创建账本」，不静默落库。
4. **§9.5 bug1 断言**：agentOps 无 editTxn 编辑路径，仅 create 语义发事件（行为断言）。
5. **§9.5 bug2 对齐**：crm_addInteraction（含 projectId 项目跟进场景）统一 emit `customer:contacted`。
6. **§9.4 字段纪律**：channel 可缺省（显式传入才枚举校验）；金额两位小数/上限同 UI；客户默认 tier=A/决策人/60。
7. **消解前置校验**：customerId 指向不存在/已删客户 → 拒绝并提示先 resolveEntity（运行时兜底，消解器第 3 步落地）。
8. **relations 双向落两侧**（v0.2 裁决）：A/B 两侧 relations[] 各写一条，同 目标+语义 判重。
9. **todo_completeTodo 走 toggleTodoDone**（§9.3 D6）：status+completedAt 成对写。
10. **createCustomerWithInit 下沉**（§9.6 不变式）：agent 层不 import modules/crm hook。
11. **createRepository 工厂零改动**：repositories 纯写不变，事件全部在 agent 层出口。

## 口径说明

- agentOps 首版只服务 AI executor，不回写 UI 路径（架构裁决：P2 再收 UI/AI 双路漂移）。
- UI 侧两处既有 bug（TransactionFormDrawer 编辑误发、ProjectDetailPage 漏发）属「事件下沉」步骤（§9.7 第 2 步）的收口范围，本步不动 UI 代码，仅以测试固定 agent 侧行为。
- fin_recordTransaction 首版不含 Blob 附件通道（外部 Agent 无法构造 Blob），附件仍走 UI。
- 事件声明表以常量（TOOL_EVENTS 语义注释）+ 测试固化，P1 第 2 步下沉 repositories 时以此为对照基准。

## 自测

- `npm run lint` ✅
- `npx tsc -b` ✅
- `npm test` ✅ 21/21（vitest + fake-indexeddb）
- `npm run build` ✅

## 复审补强（P1 复审 ②/③/5.3/⑥ + 4/5.1，2026-09-10）

| # | 项 | 处置 |
|---|---|---|
| ② | `occurredAt` 范围校验（`z.string().date()` 放行 1900/9999） | schema 加 `occurredAtSchema`：格式 + 日期真实存在 + 范围 `[2000-01-01, 今天+1]`；3 条测试 |
| ③ | `crm_addInteraction` 把 `lastContactAt` 打回过去 | `saveInteractionAndTouchCustomer` 加可选 `touchAt`（默认 = `at`，UI 行为不变）；agentOps 传 `max(prev, at)`，**日志时间保留真实值**、仅客户最近联系时间不倒退；2 条测试 |
| 5.3 | `emitDeclared` 的 `tool` 是死参数，事件名硬编码 | 改为**从 `TOOL_EVENTS` 推导事件名**：声明表是唯一事实源，多给/少给 payload 均抛错；2 条测试 |
| ⑥ | `todo_completeTodo` 非幂等（重试推进 `completedAt` + 多入队） | 入参态已等于目标态时**直接 return、不落库**，返回 `{ changed: false }`；2 条测试 |
| 4 | §2.1「P1」易被读成「第 1 步」 | 方案文档 §2.1 表头补注（P1 = 整个 P1 期） |
| 5.1 | §2.1「repositories 复合函数下沉 emit」与 §9.6「事务外 emit」口径需唯一化 | 方案文档 §2.1 事件纪律补一句：emit 收口到 repositories 层函数**事务体之外** |

> 待拍板项（第三节 lastContactAt 走 a/b、第六节「点已 done 待办」期望行为）仍待小蓝确认；
> 本轮按 **a（工具层对齐 UI）+ 幂等（目标态语义）** 保守落地，均不改 UI 语义，若拍板走 b 再调。

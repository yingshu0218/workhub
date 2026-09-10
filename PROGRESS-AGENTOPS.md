# agentOps 门面 P1 第 1 步 — 交付说明

> Issue: #33 · 方案: docs/agent-bridge-skill-v0.4.md（v0.7）§9.7 第 1 步
> 分支: feat/agentops-facade · 作者: npc/CodeBuddy(glm-5.3-flash)

## 交付物

| 文件 | 内容 |
|---|---|
| src/agent/schema.ts | 7 个写工具的 zod 入参 schema + 风险分级（TOOL_RISK）+ 事件声明（TOOL_EVENTS 声明表） |
| src/agent/executor.ts | agentOps 执行器：zod 校验 → 落库（repositories 复合/原子函数）→ 事务 commit 后统一 emit |
| src/agent/createCustomerWithInit.ts | 自 modules/crm/hooks.ts 下沉的建档复合函数（逐行等价搬迁，供 executor 依赖，不反向依赖业务模块） |
| src/agent/__tests__/agentOps.alignment.test.ts | 事件对齐对照测试（11 条） |
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
- `npm test` ✅ 11/11（vitest + fake-indexeddb）
- `npm run build` ✅

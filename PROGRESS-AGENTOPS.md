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

---

# agentOps 门面 P1 第 2 步 — 事件下沉 repositories（交付说明）

> Issue: #33 · 方案: docs/agent-bridge-skill-v0.4.md §2.1 事件纪律 + §9.7 第 2 步 + §9.5 两个既有 bug
> 分支: auto/agentops-event-sink-* · 作者: npc/CodeBuddy(deepseek-v4.1-flash)

## 一句话

把 `transaction:created` 与 `customer:contacted` 的 emit，从「UI 内联 + agentOps 内联」两条独立路径，**收口到 repositories 复合函数（事务 commit 之后）这一条路径**；顺带修掉 §9.5 记录的两个既有 bug。

## 三边界落地

| 边界 | 实现 |
|---|---|
| ① create 门控 | `saveTransactionWithAttachments` 在事务内读 `prev` 判定新建/编辑，**仅新 id**（含墓碑重建）才 emit `transaction:created`；返回 `{ id, created }`。修 §9.5 bug1（旧 UI 编辑模式也 emit，重复触发奖杯评估） |
| ② interaction 统一 emit | `saveInteractionAndTouchCustomer` 在函数出口统一 emit `customer:contacted`；UI 两入口 + agentOps 三路径同源。修 §9.5 bug2（ProjectDetailPage 项目跟进漏发） |
| ③ 事务外硬规则 | 两个 emit 均在 `db.transaction(...)` resolve 之后、`syncEngine.requestSync()` 前后，**永不进事务体**（测试断言「emit 时记录已可读」） |

## 同源收口

- UI 侧移除内联 emit：`TransactionFormDrawer`（删 `transaction:created` 与 `eventBus` import）、`CustomerDetailPage`（删 `customer:contacted` 与 import）；
- agentOps 侧移除内联 emit：`executor.fin_recordTransaction` / `crm_addInteraction` 不再 emit（避免与 repositories 双发）；
- `createCustomerWithInit` 由 `@/agent/` 移入 `repositories/index.ts`（§9.6 不变式），`modules/crm/hooks.ts` 改为从 `@/repositories` re-export，UI 引用路径不变；**行为逐行等价、不新增事件**。

## 唯一事实源 + 防漂移

- `TOOL_EVENTS` 声明表保留两条（不因下沉删条目），新增 `SUNK_EVENTS` 标记已下沉事件；
- `agentLayerEvents(tool)` 推导「agent 层仍需 emit」的事件（P1 当前为空）；
- `emitDeclared` 对已下沉事件**直接抛错**（防双发漂移）；保留出口服务未来未下沉的 agent 层事件。

## 自测

- `npm run lint` ✅ / `npx tsc -b` ✅ / `npm test` **36/36** ✅ / `npm run build` ✅
- 新增 `src/agent/__tests__/eventSink.test.ts`（15 条）：create 门控三态、编辑不发、项目跟进发事件、客户不存在回滚不发、commit 先于 emit ×2、SUNK 防漂移 ×3、createCustomerWithInit 不新增事件 ×2。

## 影响面（回归口径）

- 事件**载荷逐字段不变**（断点对照测试仍绿）；
- 手工 UI 记账/记日志：事件发出次数、时机与载荷**不变**（原先发的仍发一次，只是发出方从 UI 挪到 repositories）；
- 编辑流水：由「误发」变为「不发」——**这是修复，不是回归**；
- 项目跟进：由「不发」变为「发一次」——**这是修复，不是回归**（`customer:contacted` 为孤儿事件，无消费者，无副作用）。

---

# agentOps 门面 P1 第 5 步 — 读写工具集补全（交付说明）

> Issue: #33 · 方案: docs/agent-bridge-skill-v0.4.md §9.6.1 / §9.7 第 5 步 / §2.2
> 分支: auto/agentops-relay-step4（基于 PR #124 分支 14634e7）· 作者: npc/CodeBuddy(deepseek-v4.1-flash)

## 一句话

补齐 agentOps 的**读写工具面**：打卡逻辑从 3 处内联收口为领域命令 `checkinHabit`/`uncheckHabit`，
新增 `habit_checkin` 写工具与 6 个读工具（投影白名单 + 条数上限），让桥的工具清单可支撑 §9.8 E2E 场景。

## 一、打卡收口（§9.6.1，原 3 处内联重复）

| # | 原位置 | 收口后 |
|---|---|---|
| 1 | `modules/habits/HabitsPage.tsx` 手工 toggle | `checkinHabit` / `uncheckHabit` |
| 2 | `modules/dashboard/cards.tsx` HabitLoopCard | 同上；软删由「按 `existing.id` 删」统一为确定性 `habitLogId` 派生 id |
| 3 | `shared/effects.ts` 专注→习惯联动 | `checkinHabit(..., { evidence })`（内建幂等，等价原「存在即 return」） |

收口口径：`checkinHabit` 返回 `{ created }`，**仅实际新建（含软删复活）才 emit** `habit:checked`，
事件在**事务 commit 之后**；`uncheckHabit` 软删确定性 id、**不 emit**。

## 二、读工具集（`src/agent/reads.ts`，§2.2）

| 读工具 | 投影（白名单） | 上限 |
|---|---|---|
| searchEntities(q, types?) | 复用 `searchAll` 6 实体投影；notes 走字段裁剪（id/title/tags，不含 markdown） | 20 |
| getCustomer(id) | 基本档案 + `intimacy` 摘要 + `relationCount`（**不含** relations 全量与附件） | 1 |
| listTransactions(filter) | id/ledgerId/type/amount/summary/status/occurredAt/customerId/projectId/todoId（不含附件） | 50 |
| listTodos(filter) | id/title/priority/status/dueAt/customerId/projectId | 50 |
| listLedgers() | id/name/currency/closingCycle/isDefault | 50 |
| listHabits() | id/name/category/schedule | 50 |

三条纪律：① 只走活记录（同 `useCollection` 过滤 `deleted`）；② 投影白名单；③ 超限**截断并返回 `truncated: true`**，绝不静默全量返回。读工具不产事件，不进 `TOOL_EVENTS`。

## 三、写工具 `habit_checkin`

- 走收口函数，**目标态 + 幂等**：重复调用返回 `{ created: false }`、不重复入队（外部 Agent 重试安全）；
- `undo: true` 走 `uncheckHabit`（软删、不 emit）；
- 习惯不存在 → 可操作错误，不静默落库；
- 白名单域 `habit`；`habit:checked` 已随收口下沉（`SUNK_EVENTS` 现 3 条）。

## 四、自测

- `npx tsc -b` ✅ / `npm run lint` ✅ / `npm test` **65/65** ✅ / `npm run build` ✅
- 新增 `src/agent/__tests__/step5.tools.test.ts`（16 条）；
  同步更新 `eventSink.test.ts` 中「已下沉事件数」断言（2 → 3）。

## 五、影响面

- 打卡行为对 UI **语义等价**（幂等 id、事件次数与时机不变），仅把重复实现收敛为一份；
- 读工具为**新增能力**，不改任何既有 UI 路径；
- 未触碰 schema / 同步引擎 / `createRepository` 工厂。

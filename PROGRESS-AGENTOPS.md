# agentOps P1 — 交付说明（第 1~6 步）

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


---

## P1 第 4 步 — 本地 Relay + 安全边界 + CSP 注入（2026-09-10）

> 方案：`docs/agent-bridge-skill-v0.4.md` §9.1 / §9.6 / §10.1

| 文件 | 内容 |
|---|---|
| `relay/ws-server.mjs` | 最小 RFC6455 WebSocket 服务端（node:http 升级握手 + node:crypto 算 accept key；掩码解帧、分片续帧、ping/pong、close 握手）。**零新增依赖**（§A1 对码口径维持：package.json 不引 ws/express） |
| `relay/mcp-relay.mjs` | 标准 MCP 路由：`initialize`（token 校验）/`tools/list`/`tools/call`/`ping`；`ConfirmTokenStore`（一次性、5 分钟 TTL、核销即删、`sweep` 清过期）；`safeEqual` 时序安全比较 |
| `relay/index.mjs` | 入口：WS 监听 `127.0.0.1:8787`（`WORKHUB_RELAY_PORT`/`WORKHUB_RELAY_TOKEN` 可覆盖）+ `--stdio` 同进程 stdio MCP 入口；浏览器角色经 `?role=browser&token=` 连出配对；**只转发**（不 import repositories/agentOps） |
| `src/agent/bridge.ts` | 浏览器侧桥：Outbound WS 连出 + 自动重连；`tools/list` 走 `listVisibleTools(domains)`（白名单关闭的域不出现）+ `zodToJsonSchema` 生成 `inputSchema`；`tools/call` 走 `dispatchAgentTool` 唯一入口；中风险无 `confirmToken` 只回预览材料 |
| `src/agent/jsonSchema.ts` | 最小 zod→JSON Schema（object/enum/array/optional/default/refine 包装），与 `skillSource` 生成器同口径 |
| `src/agent/install.ts` | 按 settings `ai` 段连/断桥（缺省关，零影响）；`main.tsx` 在 Bootstrap 中装配并在卸载时断开 |
| `vite.config.ts` | `cspRelayPlugin`（`apply:'serve'`）：dev 注入 `ws://127.0.0.1:8787` 到 `connect-src`；生产 CSP 不含 `ws:` |
| `src/modules/settings/AiBridgeSection.tsx` + SettingsPage 新标签 | 启用开关 / relay 地址 / token 生成·复制·重置 / 按域白名单开关；全部落 settings `ai`（本地、不进同步） |
| `package.json` | 新增 `relay` / `relay:stdio` / `gen:skills` 脚本 |

**硬约束落地**：① 桥仅监听 `127.0.0.1`；② 无 token 连接/initialize 一律拒绝；③ 白名单关闭的域在 `tools/list` 不出现；④ 中风险无 confirmToken 不可执行（预览拦截）；⑤ relay 零特权、不持数据。

## P1 第 6 步 — skill 文件首版（与 MCP tools schema 同源）

| 文件 | 内容 |
|---|---|
| `src/agent/skillSource.ts` | skill/MCP schema 的**唯一生成源**：15 个工具（8 写 + 7 读）的名称/summary/副作用/幂等/实体规则/示例 + zod schema 引用；只依赖 schema 常量，不 import db |
| `scripts/gen-skills.mjs` | 用 esbuild 打包 `skillSource.ts` 后生成 `docs/skills/<tool>.md`（参数表/副作用/事件/幂等/引用规则/示例/确认流程）+ `docs/skills/README.md`（总览+协议与安全）+ `docs/skills/mcp-tools.json`（MCP `tools/list` 静态快照） |
| `docs/skills/` | 15 份工具文档 + README + mcp-tools.json（自动生成，勿手改） |

**单源保证**：`skill.parity.test.ts` 断言「`executor.AGENT_TOOLS` ↔ `skillSource.ALL_TOOL_SKILLS` ↔ `mcp-tools.json`」三方工具集与风险/域完全一致，任何「加工具没写 skill」或反向遗漏都会测试失败。

## 自测（P1 第 4 / 6 步）

- `npm run lint` ✅ / `npx tsc -b` ✅ / `npm run build` ✅
- `npm test` ✅ **97/97**（原 65 + relay 17 + bridge 9 + skill.parity 6 + csp 4 + aiSettings 4 − …）
- `node scripts/gen-skills.mjs` ✅ 生成 15 工具
- `node scripts/check-icons.mjs` ✅ 112 引用齐全

## P1 剩余

- ✅ 第 7 步（E2E 场景实机联调）已交付，P1 七步全部落地。
- 后续 P1 收尾补强与 P2 动作扩面见本文档下方「agentOps P1 收尾 + P2 动作扩面 — 交付说明」。

---

# agentOps P1 收尾 + P2 动作扩面 — 交付说明

> Issue: #33 · 方案: docs/agent-bridge-skill-v0.4.md（v0.8）§9.7 / §六 P2
> 分支: auto/agentops-event-sink-1789045094（PR #124，沿用不新建）
> 目标: 「把剩下的开发工作一次性做完，我再来审计」

P1 七步已在前序提交落地。本轮补齐**P1 收尾的四处缺口**与**P2 的动作扩面**，
并把方案里写着「待拍板 / 下一步」的项全部收口，使 agentOps 成为一条**能真正被
外部 Agent 端到端使用**的通路，而不是「测试全绿但真实用法走不通」的半成品。

## 一、P1 收尾：四处「测试全绿但真实用法走不通」的缺口

前序 128 条测试全绿，但下面四处只有**起真实 relay、按真实用法走一遍**才会现形。
本轮逐条修复并补了**会在回退时立刻挂掉**的回归测试（做了变异验证）。

| # | 缺口 | 症状（真实用法） | 处置 |
|---|---|---|---|
| 1 | **确认流程是死循环** | `preview` 会正确拦下中风险操作，但票据只能由 relay 签发，而 relay **没告诉 Agent 去哪儿取票**，非 `--dev` 下「预览 → 用户确认 → 执行」物理上走不通 —— 确认闸门退化成「永远执行不了」而非「需要确认」 | relay 新增内置 MCP 工具 **`confirm_preview`**：① 浏览器回预览时 relay 记下 `(tool,args)`；② Agent 将结果转述用户确认后调 `confirm_preview` 取票；③ relay 校验「该组参数确实被预览过」才签发一次性 confirmToken。**票据绑定参数**，堵死「拿确认票执行另一组参数」 |
| 2 | **未知工具的错误有误导性** | 白名单闸门在「是否注册」之前：模型幻觉出一个工具名，会收到「不在能力白名单内（域：未知）」，Agent 会以为是自己权限不够而反复重试 | 分发层调整判定顺序，未注册工具返回「未知工具：X。当前可用工具：…」；白名单拒绝仍保留原语义 |
| 3 | **高风险分级缺失** | 方案 §四.4 定义了 `high`（二次确认 + 副作用清单），但 `RiskLevel` 只有 `low`/`medium`，删除类动作无处安放 | `RiskLevel` 扩为三档；删除类定为 `high`；预览载荷额外标 `irreversible: true`，执行结果返回 `sideEffects`（受影响记录数） |
| 4 | **默认账本唯一性两处内联** | UI（`LedgerFormDrawer.save()`）与 agentOps 各写一份「先清其它 isDefault 再落库」。一旦漂移出「双默认账本」，`TransactionFormDrawer` 的缺省账本取 `find(l => l.isDefault)` 是**取第一个命中**，记账会静默挂到不确定的账本上 | 收口为 `repositories.clearOtherDefaultLedgers(keepId?)`，UI 与 AI 共用；补测试断言「建完只剩一个默认账本」 |

## 二、新增领域命令层 `src/domain/`：消除 UI/AI 动作编排的两份实现

第 2 步已把**事件**收口到 repositories，但**动作编排**仍是 UI 一份、AI 一份。
最典型的病灶是记账：`TransactionFormDrawer` 与 `fin_recordTransaction` 各写一遍
`dayjs(...).startOf('day')` 与缺省账本取值。而 §7.1 的验收恰恰要求
「AI 记的账 vs 手工记的账逐字段一致」——两份实现下这个验收只能靠巧合成立。

`src/domain/index.ts` 提供动作级唯一实现：

| 导出 | 作用 | 消费方 |
|---|---|---|
| `normalizeOccurredAt(date?)` | 记账时间口径（仅日期 → 落当天 00:00） | `TransactionFormDrawer` + `fin_recordTransaction` |
| `resolveDefaultLedgerId()` | 缺省账本策略 `isDefault → 唯一账本 → 反问` | `recordTransaction`（UI 快捷记账与 AI 同路径） |
| `recordTransaction(input)` | 记一笔（无附件）的完整编排 | agentOps executor |
| `createLedger(input)` | 建账本（含默认全局唯一 + 排序位） | agentOps executor（UI 走 `LedgerFormDrawer`，共用 `clearOtherDefaultLedgers`） |

口径澄清：**领域层不产事件**。事件仍一律由 repositories 复合函数在事务 commit 后发出，
领域层只做编排，保持 §2.1「事件永在事务之后」与「repositories 纯写」两条不变式。

顺带对齐：`fin_recordTransaction` 的 `ledgerId` 由**必填改为可缺省**。
理由即 §9.4 的对齐原则——UI 记账表单在「全部账本」视图下本就是**自动选默认账本**，
工具层强制必填会让 AI 必须先反查账本；而「无账本 / 多账本无默认」两种场景，
由领域层策略给出的可操作提示更准确（两种情形文案不同）。

## 三、P2 动作扩面：从「能建」到「能改、能删」（15 → 27 个工具）

P1 面上 AI 能建、不能改、更不能删——建错一条客户/待办只能靠人工到界面里收拾。
而 UI 早有编辑/删除入口且已有级联语义。本轮把动作面与 UI 对齐。

**新增 9 个写工具 + 3 个读工具**：

| 工具 | 域 | 风险 | 落库路径 |
|---|---|---|---|
| `todo_updateTodo` | todo | low | `todoRepo.put`（nullable 三态：未传=不动 / null=清空 / 值=设置） |
| `todo_deleteTodo` | todo | **high** | `todoRepo.softDelete` |
| `crm_updateCustomer` | crm | medium | `customerRepo.put`（含 `intimacyLevel: null` 清除手动档位） |
| `project_createProject` | project | low | `projectRepo.put` |
| `project_updateProject` | project | medium | `projectRepo.put`（含归档/搁置） |
| `note_createNote` | note | low | `noteRepo.put` |
| `note_updateNote` | note | medium | `noteRepo.put` |
| `note_createFolder` | note | low | `noteFolderRepo.put` |
| `habit_deleteHabit` | habit | **high** | `deleteHabitCascade`（级联清日志，返回条数） |
| `listProjects` / `listNotes` / `listNoteFolders` | read | low | 只读投影 |

**四条纪律**（与 P1 写工具同源，测试逐条固定）：

1. **不新增领域事件**：这些动作在 UI 同入口也不发事件，事件声明表保持窄（测试断言 `TOOL_EVENTS` 为空）；
2. **删除走既有级联函数**：不新写删除逻辑；删除后返回 `sideEffects` 供 Agent 转述用户；
3. **幽灵记录一律可操作错误**：对不存在/已删记录「成功」是最危险的一类假阳性；
4. **关联校验前置**：挂靠到不存在的客户/项目/文件夹一律拒绝，不产生悬挂引用（图里不出现指向已删节点的边）。

**白名单域新增 `project`**：项目是跨模块主题容器，关掉它不应连带关掉笔记读写，故独立成域。

**消解器扩展**：`ResolvableType` 增 `note` / `noteFolder`——否则「把这条笔记挪到 Q3 复盘目录」
只能靠猜 id。

**读限幅**：`listNotes` 投影**不含 markdown 正文**（只给 `markdownLength`）。
理由：外部 Agent 读全量笔记正文会瞬间撑爆上下文（§10.3 token 开销口径），
需要正文时用户会主动把内容贴给 Agent，而不是让 Agent 去全量拉。

## 四、顺带修复：待办深链定位「已完成」条目不可见

穿透入口（客户时间线鱼骨 / CRM 活动流）**最常指向已完成的待办**，
而 `focused` 的 `useEffect` 里一律 `setChipDone(false)`，已完成条目仅在勾选
「已完成」Chip 时可见（Issue #111 口径）——表现为「点进去了、但目标行不见」。
下方新建兜底那段注释写着「已完成同步勾上」，实际被上游的隐式重置抹掉。
改为按目标记录的实际状态决定是否勾上该 Chip。

## 五、验证

- `npm run lint` ✅ / `npx tsc -b` ✅ / `npm run build` ✅（含 `check:icons`）
- `node scripts/gen-skills.mjs` ✅ **幂等**（连续两次产出 md5 一致），27 个工具
- `npm test` ✅ **175/175**（128 → 175，本轮新增 47 条）
  - `step8.p2tools.test.ts`（23）：P2 扩面四类纪律逐条
  - `step8.domain.test.ts`（11）：时间口径唯一 / 缺省账本策略 / 默认唯一性收口
  - `confirm.flow.test.ts`（8）：预览载荷与取票契约
  - `confirm.nondev.test.ts`（4）：**起不带 `--dev` 的真实 relay 子进程**验证取票闭环
  - `e2e.acceptance.test.ts` 扩至 9：新增 ⑤ P2 动作经真实 relay 全链路可达
- **变异验证**（证明回归测试不是摆设）：去掉 `confirm_preview` 的工具暴露 / 去掉预览记录缓存，
  对应测试立刻失败；恢复后全绿。

## 六、口径说明与遗留

- relay 的 `--dev`（预览自动附票）**仅为本地自动化**保留；真实用法走 `confirm_preview` 取票。
  两者并存不冲突：`--dev` 不改变协议，只免掉一次往返。
- confirmToken 由 relay 签发、**核销即删**（TTL 5 分钟）。relay 依此在不冒充用户确认的前提下，
  把「用户确认」的可信边界交给 Agent 的转述，同时用「票据绑定预览参数」堵死越权路径。
  这是方案 §10.1「relay 只是通道，不是安全边界」口径下的唯一可行设计。
- **relay 启动方式仍是本地独立进程**（`npm run relay` / `npm run relay:stdio`），
  未接入 CNB 流水线——流水线接入涉及「谁来跑、跑在哪」，属需要用户拍板的事项，本轮未擅自决定。
- P3 项（Node 侧车 MCP Server 形态、离线规则模板兜底、多步编排与跨会话）未动。

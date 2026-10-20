# agentOps 服务端化方案（AI 操作点：浏览器 → VPS 数据中心）

> 状态：**v0.5 · P1-P4 全链路闭环**（P1/P2 2026-10-14；P3 2026-10-15 凌晨；P4 2026-10-15 完成并综合测试通过。唯一遗留：正式站白名单开启由部署 env 决定，基础设施已随镜像就位）
> 背景：阿蓝 2026-10-14 拍板架构方向 —— 网页版（VPS）= 数据同步中心 + **AI 的操作点**；
> AI 写入直达中心，经既有 LWW 同步分发到所有客户端。本方案回答「怎么落地」。
> 关联：`docs/agent-bridge-skill-v0.4.md`（浏览器桥 v0.7，本方案的前置与过渡形态）。
>
> **P1 完成记录（2026-10-14）**：`src/storage/`（types + DexieAdapter + 可切换单例 +
> workspace 常量）；executor/reads/resolver/domain/repository/todo-hooks/intimacy-config
> 全部去 Dexie 直连，改经 `storage.*`；门禁测试 `src/storage/__tests__/boundary.test.ts`
> 锁定执行链不得回潮。
>
> **P2 完成记录（2026-10-14）**：
> 1. **storage 重组**：`dexie.ts` 改纯工厂（依赖注入，`type-only` 引用 db 形状）、
>    新 `index.ts`（零 db 单例入口 + 未注册兜底动态加载）、新 `browser.ts`（全仓唯一
>    import db 的 storage 文件，main.tsx eager 注册）——服务端 bundle 物理上带不进 Dexie；
> 2. **协议纯函数收口**：新 `sync/remoteNormalize.ts`（SYNC_TABLES / pbCollection /
>    escapePbFilterValue / json 字段表 / rawJsonFromRemote / reviveRemoteJsonFields /
>    isTombstone / stripPbMeta），mergeRemote.ts 与 pocketbaseAdapter.ts 改消费 +
>    re-export（旧引用不破，字段表 ↔ collections.json 一致性锁跟随指向新文件）；
> 3. **PocketBaseAdapter**（`storage/pocketbase.ts`，P2 只读）：分页拉全 + localId 映射 +
>    pb 元数据剥除 + json 双重编码还原 + 软删真值统一 + 401 重登一次；写原语抛可操作错误；
> 4. **服务端读执行器**（`agent/serverReads.ts`）：10 个读工具独立打包入口
>    （`build:server` → `dist-server/server-executor.mjs`，esbuild，bundle 内
>    **零 dexie/零 react**——动态兜底 import 声明 external，intimacy 纯读取层拆
>    `intimacy/direct.ts`，quickCaptureTodoTitle 方向反转到 todo/title.ts，
>    todo/domain 的 backfill* 拆 `todo/backfill.ts`）；
> 5. **relay 内置执行角色**（`relay/server.mjs` serverExecutor 选项 + RelayHandle.handle
>    公开）：tools/list = 服务端 ∪ 浏览器 ∪ confirm_preview（重名服务端优先；
>    浏览器离线有服务端工具 → 照常返回，无 → 维持 -32001）；tools/call 按 handles 分流；
> 6. **serve.mjs 开关**：`WORKHUB_SERVER_EXECUTOR=1` + `WORKHUB_PB_URL/ACCOUNT/PASSWORD`
>    显式启用（默认关闭，§7.5 拍板）；初始化失败降级为无执行器模式并告警。
> 7. **验证**：tsc ✅ / lint ✅ / build ✅ / build:server ✅（bundle Node 可加载、
>    dexie/react 零残留）/ 全量 vitest **773 passed / 0 failed**（新增 15 条：
>    pocketbaseAdapter 5 + serverReads.parity 6 + relay 路由 4）。
> 8. **测试站真实验收（2026-10-14 完成）**：部署到 devtest（`/opt/nexus-relay`，env
>    `WORKHUB_SERVER_EXECUTOR=1` + `WORKHUB_PB_URL=http://127.0.0.1:9002`，**匿名读**——
>    adapter 改为凭据可选，PB 集合公开读时 env 零凭据；备份
>    `/opt/nexus-relay-backup-20261014-195823.tar.gz`）。验收四项全过：① tools/list =
>    10 服务端读工具 + confirm_preview（浏览器桥离线可用）② listTodos 真实读 PB
>    ③ resolveEntity 消解正常 ④ 写工具正确回落浏览器桥（离线可操作错误）。
>    ⚠️ **拓扑修正**：测试站 relay 实为 systemd nexus-relay @ `127.0.0.1:9100`，
>    公网 9001 是 nginx 反代（`/etc/nginx/conf.d/nexus.conf`）。
>    ⚠️ **排查教训**：`mcp-stdio-shim.mjs --verify` 的凭据来自 `~/.workhub/relay.json`
>    （本地指向正式站），stdin/参数不传时**验的是正式站**——验收测试站须显式
>    `--url/--token` 或裸 WS 客户端。
>
> **P3 完成记录（2026-10-15）**：
> 1. **写原语**：PocketBaseAdapter 增幂等 upsert（localId 判存 → PATCH/POST，body.id =
>    sha256ToBase36_15(localId)，与同步引擎同协议；**无 LWW 拒绝**——服务端是当下确认的
>    写意图，墓碑由上游 mustExist 拦）+ transaction 逐操作即时落盘（PB 无跨表事务，
>    不伪装原子性，LWW 保证收敛）；PB 写协议纯函数收口 remoteNormalize
>    （sha256ToBase36_15/toPayload/stripLocalOnlyFields）；
> 2. **全量执行器**：serverReads.ts 扩为读+写 27 工具——写工具经 executor **同一份
>    dispatch**（repositories 复合函数语义，关联关系与界面操作一致）；
> 3. **confirmFlow.ts 共享闸门**：needsPreview/previewEnvelope 两端共用（无票 preview
>    信封与浏览器桥逐字段一致）；relay 对服务端工具透传 meta.confirmToken + preview 回包
>    rememberPreview（否则取票死循环）；
> 4. **白名单服务端化**：WORKHUB_AI_DOMAINS env（默认全关），与浏览器白名单相互独立；
> 5. **依赖净化**：repositories 拆 localAdmin.ts（settingsRepo/focusSessionRepo/存档
>    导入导出等浏览器本地管理，消费方改路径）；todo/cascade.ts 拆 deleteTodoCascade；
>    写链 syncEngine 直调改经 storage.requestSync()（DexieAdapter 转发 / PB no-op）；
>    **bundle 纯净度 dexie/react/db 零残留**；
> 6. **测试站端到端验收通过**：preview → confirm_preview 取票 → 带票写入客户
>    （ws-main:cus:XNqkQr-HzF）→ low 工具直写待办并关联真实客户 id → resolveEntity/
>    listTodos 读回一致 → PB 直查 localId 镜像与 SyncMeta 盖章正确（客户端可收敛）；
>    假票据被 relay 拒、幽灵客户 id 被弱引用校验拒（防线真实有效）；
> 7. **执行器 PB 身份**：自注册服务账号 `agent@nexus.local`（users 集合 createRule 开放
>    自注册；凭据仅存服务器 /etc/nexus-relay.env，env mode 640）。⚠️ 教训：**匿名读
>    受 listRule 限制读不到全量**（P2 期间 listTodos count=0 是残缺视图）——凭据鉴权
>    才是正确形态，正式站 P4 沿用服务账号方案。
> 8. 验证：780 passed / 0 failed（+2 pbAdapter 写路径、parity 扩为路由边界+闸门用例、
>    todoRowDetail ②固定 sleep 改 vi.waitFor 修全量并发 flaky）。
>
> **P4 完成记录（2026-10-15）**：
> 1. **agent_events 事件流**（§5.4-A 落地）：PB 新集合（登录可写可读、update/delete
>    仅超管——事件不可改删）；eventBus 加 setEventForwarder（注入式转发，浏览器端
>    不注入行为零变化）；PocketBaseAdapter.recordEvent 落库（失败不阻断写操作本身）；
>    客户端 drainAgentEvents（sync 引擎每轮 pull 后 replay 到本地 eventBus，游标
>    db.meta，重复 emit 由评估侧幂等兜底）——奖杯/EXP 评估零改动；
> 2. **镜像化**：Dockerfile 构建阶段 build:server + COPY dist-server；compose 权威副本
>    登记执行器 env 五件套（默认全关，正式站开启 = 部署时改 env，符合 §7.5 拍板）；
> 3. **浏览器桥终局（决策点 4）**：保留为 fallback 不退役（服务端执行器不可用时桥仍
>    是完整能力面；设置页入口不动）；
> 4. **验证**：791 passed / 0 failed（+5 agentEvents）；测试站综合测试通过——
>    low（habit_checkin 直执行）/ medium（fin_recordTransaction 全票据流程，领域层
>    「多账本无默认」可操作错误正常给出）/ high（todo_deleteTodo irreversible 流程）
>    三风险级端到端，PB 直查 agent_events 两条领域事件（habit:checked +
>    transaction:created）完整落库，listTransactions 读回 amount/customerIds 一致。
>
> **P1-P4 全链路最终形态**：Agent 经 MCP 连 relay → 全部 27 工具（读+写）在 VPS
> 服务端执行器执行（直读/直写 PB 中心，走 repositories 复合函数语义）；中/高风险
> 走 preview→confirm 票据闸门；领域事件落 agent_events 供各客户端评估奖杯/EXP；
> 浏览器桥保留为 fallback；正式站基础设施已随镜像就位，开启 = env 三行 + 白名单。

## 0. 一句话

把 27 个 agentOps 工具的**执行体**从「某台设备的浏览器页面」迁到「VPS 上与 relay 同进程的服务端执行层」，执行层直写 PocketBase；**业务编排逻辑通过存储适配层复用一份实现**，不在两端各写一份。

## 1. 目标与非目标

**目标**

1. Agent 7×24 可用：不再依赖某台设备开着页面并启用桥；
2. AI 写入 = 服务端数据：写入直达 PB 中心，客户端经既有同步引擎收敛；
3. 单一事实源不破：UI、浏览器桥、服务端执行层三方共用同一套动作编排；
4. 安全边界不放宽：token 鉴权 / 域白名单 / 中高风险确认票据全部保留。

**非目标（本期不做）**

- 不改同步协议本身（LWW / 墓碑 / 心跳不动）；
- 不把 PocketBase 换掉或升级部署形态；
- 不做 Agent 的实时推送优化（客户端感知服务端变更沿用既有 pull 节奏，见 §5.5）。

## 2. 现状盘点（2026-10-14 侦查结论，含硬约束）

| # | 事实 | 出处 | 对本方案的影响 |
|---|---|---|---|
| 1 | 执行器 865 行，**十几处直用 Dexie**（`db.customers.get` 等），`import { db } from '@/db/db'` | `src/agent/executor.ts:3,234,299,340,387,474,503,541,572,594,623,648,689` | 服务端化前必须先去 Dexie 直连 |
| 2 | domain 层同样直用 Dexie（`db.ledgers.toArray/get`） | `src/domain/index.ts:21,45,93,135` | 同上 |
| 3 | `Repository<T>` 接口已抽（get/list/put/softDelete），但工厂 `createRepository` **只注入 Dexie 表**，全仓唯一实现 | `src/repositories/repository.ts:25-91` | 「存储无关」只是接口形状上的，适配层是欠的债 |
| 4 | 浏览器桥职责清晰：`agentops:call` → 白名单 → 风险 preview → `dispatchAgentTool` | `src/agent/bridge.ts:130-184` | preview/confirm 编排可抽共享，两端复用 |
| 5 | relay 确认票据在 **relay 侧签发/核销**（一次性、绑定参数指纹、防重放） | `relay/mcp-relay.mjs:82-106` | 服务端执行层复用同一票据机制，无需新设计 |
| 6 | PB hooks 已有 goja JS 基建：server_received_at 盖戳、墓碑标记、cron 清理 | `pb_setup/pb_hooks/main.pb.js` | 证明 hooks 通道可用，但只适合轻量逻辑 |
| 7 | 业务集合 `id`/`localId`/`updatedAt` required，客户端生成 id；**用 API 造数据缺字段 = HTTP 400** | 项目记忆（实测踩过） | 服务端直写 PB 必须带全同步元数据 |
| 8 | id 规则带 workspace 前缀：`ws-main:txn:xxxxx`（`DEFAULT_WORKSPACE_ID`） | `src/repositories/repository.ts:94-96` | 服务端沿用同一 `newId` |
| 9 | 事件（`transaction:created` 等）emit 收口在 repositories 复合函数事务后，消费者（奖杯/EXP 评估）在**浏览器端** eventBus | `PROGRESS-AGENTOPS.md` + AGENTS.md §6.1 | 服务端执行后浏览器收不到事件 → §5.4 专门处理 |

## 3. 选型对比

### 3.1 执行层放哪

| 选项 | 说明 | 优势 | 代价 | 结论 |
|---|---|---|---|---|
| **A. 嵌入 relay 同进程** | 执行器作为 relay 的内置执行角色（不走 WS，函数直调），随 `serve.mjs` / docker entrypoint 部署 | 零新增部署单元；票据机制就地复用（签发与核销同进程）；同源访问 PB（127.0.0.1:8090） | relay 进程从「零特权纯转发」变为「持业务执行权」——**安全边界语义变化**，需在文档与测试中明确 | ✅ **推荐** |
| B. 独立 Node 服务 | 单独进程 + 单独反代路径 | 隔离清晰 | 多一个部署单元 + 多一跳鉴权 + 与 relay 的票据核销跨进程，违背「尽量少组件」 | ❌ |
| C. PB hooks（goja） | 编排逻辑写进 `pb_hooks/*.pb.js` | 离数据最近 | goja 无 npm/TS、无法复用现有 TS 代码、865 行 executor 无法搬迁、测试基建缺失 | ❌（仅保留轻量校验用途） |

### 3.2 业务编排如何复用（核心难点）

| 选项 | 说明 | 优势 | 代价 | 结论 |
|---|---|---|---|---|
| **A. StorageAdapter 抽象** | executor / domain 去 Dexie 直连，改依赖统一存储接口；浏览器端实现 DexieAdapter，服务端实现 PocketBaseAdapter | 单一事实源真正成立（AGENTS.md §6.2）；顺带还清事实源 #3 的债；与 Tauri SQLite 迁移（阶段 2）共用同一抽象 | 一次性改造量：executor 865 行 + domain 147 行的 `db.*` 全部替换；需测试全量锁定 | ✅ **推荐** |
| B. 服务端独立实现一份编排 | 服务端执行器直写 PB、自己写编排 | 上手快 | 27 个工具两份实现必漂移，直接违反 §6.2；级联/口径改动要同步两处 | ❌ |
| C. 分域渐进：读工具+低风险写先上服务端，复杂写留浏览器桥 | 按 `TOOL_RISK` 分批 | 风险小、每步可验收 | 「复杂写留在浏览器」与 7×24 目标长期矛盾；两套执行路径并存期更长 | 作为 **A 的推进节奏**吸收（见 §6 阶段） |

## 4. 推荐架构

```
Agent 工具(Codex/Hermes/WorkBuddy/opencode…)
   │ MCP stdio
   ▼
relay/mcp-stdio-shim.mjs（不变）
   │ WSS
   ▼
relay（VPS，serve.mjs / docker entrypoint 同进程）         ── token 鉴权 · 白名单 · 确认票据（全部不变）
   │
   ├─ role=browser ──► 浏览器桥 agentBridge（保留，过渡期 fallback）
   │                     └─ DexieAdapter ─► IndexedDB（该设备本地）
   │
   └─ role=server（新增，内置执行器，函数直调）
                         └─ PocketBaseAdapter ─► PocketBase 127.0.0.1:8090（唯一事实源）
                                                 └─ 既有 LWW 同步 ─► 各客户端
```

要点：

1. **relay 增加内置执行角色**：`tools/call` 到达时，若该域在**服务端白名单**内且执行器就绪 → 本地执行；否则回落浏览器桥（桥在线时）。回落顺序在响应里标注 `executor: 'server' | 'browser'`，便于排查与验收。
2. **浏览器桥不删**：过渡期作为 fallback（服务端执行器部署前它就是今天唯一路径）；终局去留见 §7 决策点 4。
3. **schema 零改动**：`src/agent/schema.ts` 的 zod schema、`skillSource.ts`、`docs/skills/` 生成链全部原样复用——Agent 侧看到的工具清单不变。

## 5. 关键设计点

### 5.1 StorageAdapter 接口（新抽象，§3.2-A 的落点）

```ts
// src/storage/types.ts（新建；现有 Repository<T> 接口保留为上层糖）
export interface StorageAdapter {
  get<T>(table: string, id: string): Promise<T | undefined>
  list<T>(table: string): Promise<T[]>                 // 已过滤 deleted
  put<T>(table: string, record: PutInput<T>): Promise<void>
  softDelete(table: string, id: string): Promise<void>
  transaction<T>(tables: string[], fn: () => Promise<T>): Promise<T>  // 服务端实现可为顺序执行 + 失败补偿
}
```

- 浏览器端 `DexieAdapter`：薄封装现有 Dexie 事务 + syncQueue 入队逻辑（`repository.ts:48-89` 原样搬入）；
- 服务端 `PocketBaseAdapter`：PB JS SDK 写入，**写入时补齐同步元数据**（见 5.2）；
- executor / domain 全部改为 `storage.get('customers', id)` 形态，`db.*` 直连清零，由 grep 门禁锁定（CI 加一条「`src/agent|domain` 禁 import `@/db/db`」）。

### 5.2 PocketBaseAdapter 的 LWW 硬约束（事实源 #7）

服务端直写每条记录必须自带：`id`（`newId` 同规则）、`localId`、`updatedAt`（epoch ms）、`rev`（按服务端现值 +1）、`deleted`。缺任一 = HTTP 400。适配层内部统一盖章，调用方无感。

### 5.3 白名单与确认票据

| 机制 | 现状（浏览器桥） | 服务端执行层 |
|---|---|---|
| token 鉴权 | relay 层，不变 | 不变 |
| 域白名单 | settings `ai.domains`（浏览器 IndexedDB） | **服务端配置**（docker env 或 PB `module_configs` 一条记录），与浏览器白名单**相互独立**——两把闸门各管各的执行体 |
| 中高风险 preview → confirm → execute | bridge.ts 内编排 | 抽成共享模块（`src/agent/confirmFlow.ts`），两端复用；票据签发/核销仍在 relay（同进程直调，跨进程问题不存在） |

### 5.4 事件与奖杯（唯一真正的开放问题）

现状：`transaction:created` 等事件在浏览器端 emit、浏览器端 eventBus 消费（奖杯/EXP 评估）。服务端执行后浏览器**收不到**事件，奖杯不会动。

| 选项 | 说明 | 结论 |
|---|---|---|
| **A. 服务端事件落 PB `agent_events` 集合**，客户端 pull 时消费并走本地评估 | 改动最小：奖杯评估代码不动，只是事件源多一个；天然离线友好 | ✅ **推荐**（评估逻辑最终仍跑在各客户端，接受「各端各自评估」的既有语义） |
| B. 奖杯/EXP 评估整体服务端化 | 语义最干净 | 牵动游戏化全线，另立方案，不绑本次 |

### 5.5 客户端感知节奏

服务端直写 PB 后，客户端靠既有 pull 收敛。既有触发：30s 心跳、online 事件、本地写入后 requestSync。**可接受**（本工具定位是工作台，分钟级收敛足够）；后续若要秒级，另加 PB SSE 订阅，不阻塞本方案。

## 6. 阶段划分（每阶段独立可验收，遵守「一次提交只做一件事」）

| 阶段 | 内容 | 验收口径 |
|---|---|---|
| **P1 还债**：StorageAdapter 抽象 | executor/domain 去 Dexie 直连；DexieAdapter 落地；CI 门禁禁直连 | `npm test` 全绿 + 现有 21 条 agentOps 对齐测试不动一行断言通过；UI 行为零变化 |
| **P2 服务端执行器上线（只读）** | PocketBaseAdapter + relay 内置执行角色；**只开读工具**（投影白名单/限幅口径照搬） | `tools/list` 正常；从 VPS 直读与浏览器直读结果一致；桥不在线也能列出并执行读工具 |
| **P3 写工具迁移** | 写工具按风险分批上（low → medium → high）；确认票据走共享 confirmFlow；白名单服务端化 | 中高风险在无票据时返回 preview（与浏览器桥行为逐字段一致）；写入经 PocketBaseAdapter 落 PB、客户端可收敛 |
| **P4 终局** | 事件集合（§5.4-A）；浏览器桥降级/退役拍板 | 全部 27 工具 7×24 可用；无浏览器在线时中高风险确认流程仍走得通 |

## 7. 待拍板决策点（一次列全）

1. **执行层位置**：relay 同进程（推荐，§3.1-A）？—— 接受「relay 不再零特权」的语义变化即可。
2. **编排复用**：StorageAdapter 抽象（推荐，§3.2-A）？—— 代价是 P1 一次性改造 executor+domain。
3. **事件传播**：`agent_events` 集合 + 客户端各自评估（推荐，§5.4-A）？还是奖杯服务端化另立方案？
4. **浏览器桥终局**：P4 保留为 fallback（推荐），还是服务端稳定后直接退役（设置页的「AI Agent 桥」入口随之简化）？
5. **服务端白名单默认值**：默认全关（安全优先，推荐）还是默认全开（自用工具站图省事）？

## 8. 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| P1 改造波及面大（executor 865 行 + domain），改坏 UI 路径 | 高 | 现有 21 条对齐测试 + 716 条全量测试锁定；P1 提交不含任何行为变更 |
| 服务端直写与客户端 LWW 冲突（同记录并发改） | 中 | LWW 本就为此设计；服务端写入走同一盖章规则即可，无新增冲突面 |
| relay 持执行权后，relay 被攻破的影响从「转发」升级为「直写数据库」 | 中 | token ≥16 位 + 服务端白名单默认全关（决策点 5）+ 票据机制不变；正式站全程 HTTPS |
| 服务端执行层与浏览器执行结果漂移（如日期时区：服务器 UTC vs 客户端 GMT+8） | 中 | **`normalizeOccurredAt` 等口径函数显式传时区**（服务端固定 Asia/Shanghai）；P3 验收加「两端同参执行结果逐字段一致」用例 |
| PocketBaseAdapter 直写绕过 hooks 的墓碑标记？ | 低 | hooks 挂在 `onRecordCreate/UpdateRequest`（HTTP 层）；适配层走 PB SDK HTTP API 同样触发，实测确认即可 |

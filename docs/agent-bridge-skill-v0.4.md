# AI Agent 自然语言操作 —— 终稿方案 v0.4「应用内 Agent 桥 + skill 暴露」

> 版本：v0.4（终稿候选）
> 前序：v0.1（四层骨架）→ v0.2（三方裁决收敛）→ v0.3（事件声明表终稿 + 下沉三边界）→ **v0.4（意图层外包外部 Agent，执行载体定案）**
> 状态：待小蓝拍板。确认前不动工。
> Ref: #33

---

## 〇、v0.3 → v0.4 变更摘要（本版唯一改动维度：意图理解层外包）

| # | 变更项 | v0.3 | v0.4 | 裁决来源 |
|---|---|---|---|---|
| E1 | 意图理解层（L1） | 内置 LLM Provider（OpenAI 兼容，浏览器直连） | **整块移除**。意图理解与工具选择外包给外部 Agent（workbuddy / codebuddy / hermes），应用零 LLM 代码、零 API Key、零 CORS 问题 | 小蓝明确定调「不是接 LLM，是让 Agent 调用」 |
| E2 | 执行载体 | 未定（Node 侧车 MCP Server vs 应用内桥） | **应用内 Agent 桥为 P0 主路径**（WebSocket 优先，HTTP fallback）；Node 侧车降级为 P3 可选。理由见 §三：数据层 Dexie/IndexedDB 纯浏览器运行时，侧车直读不可行 | deepseek 审计（对码核验 `db.ts` / `sync/engine.ts`） |
| E3 | 读写边界 | 未定 | **默认「应用在线才能操作」**——权威数据在应用内 IndexedDB，桥跑在应用进程内天然如此；离线规则模板兜底押 P3 | deepseek 审计 + 三方默认口径 |
| E4 | 能力白名单配置页 | P2 | **提前为 P0 前置**（外部 Agent 形态下不是可选项，是硬边界） | deepseek 审计 |
| E5 | L0 会话上下文 | 内置面板会话（page 级仅内存） | **保留为「桥会话」**——升为桥级单例 store，暂存外部 Agent 多轮澄清/补字段态；仍不入 Dexie/同步 | deepseek 审计（原 v0.2 D4 语义不变，仅归属从面板改到桥） |
| E6 | 确认机制载体 | 应用内预览卡 | 中/高风险操作的预览内容由桥以结构化文本返回 → 外部 Agent 转述用户确认 → 用户确认后 Agent 再调执行工具。**风险分级与强制二次确认语义不变** | deepseek 审计 |
| E7 | skill 文件 | 无此概念（MCP tools schema 即描述） | **新增：面向外部 Agent 的能力说明文件**，与 MCP tools schema 双轨（schema 给机器校验，skill 给 Agent 推理上下文），含读限幅、域前缀命名、幂等标注、强制 resolveEntity 流程 | deepseek 审计 §三 |

**不变式（v0.3 全部结论原样保留，一个不砍）**：

- agentOps 门面 = 写操作单点收口（schema 校验 + 风险分级 + 领域事件收口 + create 门控 + 事务外 emit 硬规则）
- v0.3 事件声明表终稿（P1 四条写工具事件 + `quicknote:convert` P2 占位）
- 事件下沉三边界：①create/edit 门控（仅新 id 才 emit `transaction:created`）②interaction 统一 emit（项目跟进也算客户联系，已裁决文档化）③**事件一律在落库事务 commit 之后发，永不进事务体**
- 语义引用消解：候选池走活记录、按 id 去重、**去重后 id 唯一才自动消解**，重名/命中超阈值必反问，空/过短输入前置拦截；Project 归档沉底、Customer 不沉底（无归档字段）
- 强原子链 `saveTxnAndInteractionAndTouch`（记账+关联+补拜访），先 `transaction:created` 后 `customer:contacted`，均在事务外；其余多步意图默认弱关联 + 逐条勾选
- 验收断点挂 `transaction:created`（`customer:contacted` 是孤儿事件仅保留契约，不挂钩奖杯/EXP 断言）
- `fuzzyMatch/fuzzySort` 从 MatchCombobox 提升到 shared（P1 显式任务）；`createCustomerWithInit` 下沉 repositories；打卡抽共享 `checkinHabit`（打卡幂等与 toggle 取消分离）

---

## 一、架构定稿（外部 Agent 调用形态）

```
外部 Agent（workbuddy / codebuddy / hermes，自带 LLM 意图理解）
  ↓ 1. 读 skill（机器可读能力说明）+ MCP tools 清单
  ↓ 2. 意图理解 + 工具选择；实体引用先调 resolveEntity，歧义必反问用户
  ↓ 3. 写操作先调 preview 系工具拿确认材料 → 转述用户确认 → 再调执行
应用内 Agent 桥（WebSocket 127.0.0.1，HTTP fallback）
  ↓ 唯一暴露面 = agentOps 门面（含 resolveEntity / preview / 白名单过滤），无任何 bypass 裸写工具
agentOps（校验 + 风险分级 + 事件收口 + create 门控 + 事务外 emit）
  ↓
repositories（纯存储）→ 同步引擎 / eventBus → 奖杯、仪表盘联动
```

分工：

- **外部 Agent**：意图理解、多轮对话、工具编排、面向用户的转述与确认交互。应用不感知也不限制 Agent 用什么模型。
- **Agent 桥**：本地服务端点 + 协议适配（MCP over WebSocket），只做「外部协议调用 ↔ agentOps 方法」的一对一转发。**不做意图理解、不做数据直写、不持有任何绕过 agentOps 的能力**。
- **agentOps 门面**：与 v0.3 完全一致，是全系统唯一写入口。桥的边界就是 agentOps 的边界。
- **repositories**：纯存储，不产事件（`createRepository` 工厂不动；事件下沉只落 `repositories/index.ts` 复合函数，沿 v0.3 裁决）。

与内置 LLM 版（v0.3 L1）的关系：v0.3 的 L1/Provider/API Key/CORS 裁剪四件全部移除。若未来需要无外部 Agent 的兜底形态，内置面板可作为 P3 的「第二调用方」复用同一 agentOps——接口层不为它预留任何特殊结构。

## 二、工具面（agentOps 暴露给桥的全部工具，P1 范围）

### 2.1 事件声明表（v0.3 终稿，原样保留）

| 写工具 | 落库函数 | 必发事件 | 期 |
|---|---|---|---|
| fin_recordTransaction | saveTransactionWithAttachments | `transaction:created`（仅 create 新 id） | P1 |
| crm_addInteraction | saveInteractionAndTouchCustomer | `customer:contacted`（统一 emit，含项目跟进） | P1 |
| crm_saveTxnAndInteractionAndTouch | 组合原子函数（新增，单事务） | 事务外先 `transaction:created` 后 `customer:contacted` | P1 |
| habit_checkin | checkinHabit（新抽共享函数，幂等） | `habit:checked`（仅实际新建打卡时） | P1 |
| crm_createCustomer / updateCustomer / addCustomerRelation（双向落两侧）/ fin_createLedger / todo_* | customerRepo.put 等 | 无既有事件，不加新的 | P1 |
| note_convertQuickNote / note_createQuickNote | quickNoteRepo.put | `quicknote:convert` | **P2 占位** |

事件纪律硬规则（原样保留）：repositories 复合函数下沉 emit；`createRepository` 工厂保持纯写；事件永在事务 commit 后发；每个动作一条「agentOps emit vs UI emit」对照测试。

### 2.2 读工具（新增设计，外部形态硬要求）

外部 Agent 比内置 UI 更容易滥读。每个读工具声明**投影字段白名单 + 条数上限**，防止把 17 张表拉出去当上下文：

| 读工具 | 返回投影（白名单） | 上限 |
|---|---|---|
| searchEntities(q, types?) | 复用 `searchAll` 6 实体投影（notes 已有字段裁剪先例）：id/name/title/关键摘要字段 | 20 |
| resolveEntity(query, type) | 候选列表：id + label + 归档标记（≤10，超出强制反问） | 10 |
| getCustomer(id) | 基本档案字段 + tier/健康分摘要，**不含** relations 全量与附件 | 1 |
| listTransactions(filter) | 金额/日期/状态/customerId/ledgerId，不含附件 Blob | 50 |
| listTodos / listLedgers | 同域最小投影 | 50 |

所有读工具只走活记录（useCollection 同源过滤 `deleted`）。

### 2.3 命名与幂等纪律

- 写工具一律**域前缀**：`fin_*` / `crm_*` / `todo_*` / `habit_*` / `note_*`——外部 Agent 不可控，工具名歧义会被幻觉放大。
- 每个写工具的 skill 描述标注**幂等语义**（如 habit_checkin 返回 `{ created: boolean }`，重复调用是否产生新记录一目了然），供 Agent 决策是否重复调用。
- skill 里**强制要求「先 resolveEntity 再调用写工具」**：关联入参只接受消解后的 id，禁止塞原始字符串——这是「判 id 不判 label」在外部调用形态下的唯一落地方式。写工具收到非 `resolveEntity` 产出的 id 形态时直接拒绝并返回规范提示。

## 三、执行载体定案（本版核心裁决）

**事实基准（对码核验）**：

- `src/db/db.ts`：17 张表 + 附件 Blob 全存 IndexedDB，纯浏览器运行时；
- `repository.ts` / `repositories/index.ts`：写路径 `db.<table>.transaction` + `syncEngine.requestSync()`；
- `sync/engine.ts`：`window.addEventListener` / `navigator.onLine` / `setInterval`，绑死浏览器 API；
- 全仓无 Node 侧入口、无独立 server 层。

**裁决：应用内 Agent 桥为 P0 主路径，Node 侧车 MCP Server 不做 P0。**

- Node 侧车直读 IndexedDB 不可行：附件是 Blob、同步引擎绑死浏览器 API、repository 耦合 `@/db` 单例。若侧车要动真数据，须做「浏览器内导出快照 + 回写合并」，等于自造一套 LWW 对账——违背 Local-First 零破坏，引数据一致性坑。
- 桥形态：应用运行时内起本地服务端点（WebSocket 优先，HTTP fallback），按 MCP 工具协议暴露 agentOps。Agent 连上即插即用。
- 数据一致性由现有 repository 盖章 + 同步引擎自动保证，无需新机制。

**读写边界**：默认语义「应用在线才能操作」。应用不在线就没有权威数据可读写，离线规则模板兜底押 P3。

## 四、安全边界（外部形态硬边界，P0 前置）

1. **监听地址**：桥端点只绑 `127.0.0.1`，不暴露局域网。
2. **接入凭据**：首次启用时生成随机 token，Agent 连接必须携带；token 存 settings `ai` 段（本地 singleton，不进同步队列，沿用 `sync.password` 先例），设置页可重置。
3. **能力白名单配置页提前为 P0 前置**：设置页按域（fin/crm/todo/habit/note/读/写）开关工具；白名单外的工具对桥不可见（不仅拒绝调用，tools 清单里就不出现）。外部 Agent 形态下这不是可选项，是硬边界。
4. **确认机制**：低风险 = 执行 + undo；中风险 = 桥返回结构化预览材料 → Agent 转述用户确认 → 用户确认后 Agent 调 execute（桥为每个 preview 签发一次性 confirmToken，超时作废）；高风险 = 二次确认 + 副作用清单（级联删除列受影响记录数）。**风险分级与二次确认语义与 v0.3 完全一致，仅交互载体改为经 Agent 转述**。
5. **桥零特权**：桥不直接 import repositories 写函数，只能调 agentOps；agentOps 对所有来源（桥、未来内置面板、UI）执行同一套校验与事件收口。

## 五、skill 文件（面向外部 Agent 的能力说明）

新增 `docs/skills/`（机器可读，随版本发布），每个工具一份：

- 名称 + zod 参数 schema（与 agentOps 校验同源一套 schema）
- 副作用说明 + 风险级别 + 幂等语义
- 实体引用规则：人名/公司名 → 必须先 `resolveEntity`，候选不唯一必须反问用户，禁止猜 id
- 确认流程说明：中/高风险先调 preview 系工具、向用户转述、确认后再 execute
- 典型说法示例（「记一笔 120 晚饭」「补一条今天拜访了深蓝科技」→ 工具链）

受众双轨：MCP tools schema 给机器校验，skill 文档给 Agent 推理上下文。两者由同一 zod schema 生成，杜绝双份漂移。

## 六、分期（v0.4 口径）

- **P0（方案骨架 + 硬边界前置）**：
  1. v0.3 四条不变（agentOps 事件声明清单 / 消解 id 去重纪律 / 请求裁剪改为「读工具投影白名单」立项 / relations 双向落两侧）
  2. 新增前置：**能力白名单配置页** + **桥安全规范**（127.0.0.1 + token + 一次性 confirmToken）
- **P1（本期交付，按序）**：
  1. agentOps 门面 + 事件对齐测试（第一步，未完成不碰工具）
  2. 事件下沉 repositories（v0.3 三边界：create 门控 / interaction 统一 emit / 事务外硬规则）
  3. 消解器（id 去重 / 阈值反问 / 空输入拦截 / Project 归档沉底）+ `resolveEntity` 工具
  4. 应用内 Agent 桥（WebSocket 127.0.0.1 + HTTP fallback + token 接入）
  5. 读工具集（投影白名单 + 条数上限）
  6. 写工具集：财务记账（唯一账本缺省 / 多账本反问 / status 枚举锁死默认已结算）、CRM 四件套（建客户含首联下沉 / 记沟通 / relations 双向落两侧 / 查询）、待办
  7. 强原子链 `saveTxnAndInteractionAndTouch`
  8. skill 文件首版（覆盖以上全部工具）
  - 编辑/删除/高风险变更押 P1 后半或 P2
- **P2**：多模块全量动作、UI/AI 事件漂移收口（共享领域命令）、会话历史落 settings `ai` 段（含 `mergeSettings` / `settingsRepo.save` 分段合并扩展）、撤销栈、级联删除预览卡列受影响数、`quicknote:convert` 工具落地、内置 AI 面板（若需要，复用 agentOps 作第二调用方）
- **P3**：Node 侧车 MCP Server（可选形态）、离线规则模板兜底、多步编排与跨会话

## 七、验收标准（P1 写死）

1. **事件对齐**（断点：`transaction:created`）：经桥走 `fin_recordTransaction` 记一笔，与手工 UI 记账的 `transaction:created` 载荷逐字段一致，奖杯/EXP 引擎行为无差异（对照测试覆盖）。`crm_addInteraction` 的 `customer:contacted` 对照测试降级为「emit 调用发生」级断言（孤儿事件，无消费者）。
2. **消解正确性**：同 label 重名客户必反问不自动消解；去重后唯一 id 才静默消解；写工具拒绝未经 resolveEntity 的字符串关联。
3. **强原子链**：`saveTxnAndInteractionAndTouch` 中任一步失败，事务整体回滚，无半条链；两事件均在事务 commit 后按序发出。
4. **安全边界**：桥仅监听 127.0.0.1；无 token 连接被拒；白名单关闭的域不出现在 tools 清单；中风险操作无 confirmToken 不可执行。
5. **读限幅**：任一读工具返回条数与字段均不超 skill 声明的白名单与上限。
6. **数据不出端**：token 仅存本地 settings `ai` 段且不进同步队列；桥无任何外发数据通道（仅被动连接）。
7. **Local-First 零破坏**：现有 UI 全部功能回归无差异；schema 零破坏；`createRepository` 工厂保持纯写。

---

## 八、遗留待拍板（v0.4 口径，已被 §九 取代，仅存档）

> ⚠️ 本节 2 项拍板均已被 §9.9 取代，保留仅为追溯 v0.4 原始口径，勿据此动工。

1. **MCP 协议细节**：桥对 Agent 暴露的协议形态按「MCP over WebSocket（stdio 不适用于浏览器运行时）」理解是否准确，或有指定 Agent（workbuddy/hermes）的私有协议需优先兼容——建议 P1 第 4 步动工前由小蓝指定一个先行接入的 Agent 实测。
2. **桥会话生命期**：桥级单例会话态（多轮澄清暂存）的过期策略（按连接断开即清 vs 空闲 N 分钟过期）——P1 实现时默认「连接断开即清」，无异议即按此定。

---

## 九、v0.6 定稿（承接原 v0.5 修订，2026-09-10 三方终审：hy4-preview / deepseek-v4-flash / glm-5.3-flash）

> 触发：小蓝要求三方「讨论出最终方案，并验证是否符合预想」。本节为**唯一有效口径**，与前文冲突处一律以本节为准。

### 9.1 ⛔ P0 硬错纠正：v0.4/v0.5 的「应用内 WebSocket 桥」在纯浏览器运行时不成立

**事实基准（hy4-preview 对码核验）**：

- 全仓 `grep -rn "WebSocket\|ws://\|127.0.0.1" src/` **零命中**——不存在任何服务端端点代码；
- `package.json` 依赖仅有 dexie / react / vite 等浏览器侧包，**无 ws / socket.io / express / node:http 任何一个**；
- `src/db/db.ts` 17 张表 + 附件 Blob 全落 IndexedDB；`sync/engine.ts` 绑死 `window.addEventListener('online')` 与 `navigator.onLine`；
- 结论：**浏览器 JS 无法 `listen()`。浏览器只能作为 WebSocket 的「客户端」发起外连，无法作为「服务端」被 Agent 连入。** v0.4 §三「应用运行时内起本地服务端点（WebSocket 优先，HTTP fallback）」在物理上不可实现，v0.5 全盘继承了这个错误。

**v0.6 纠正**：桥的形态由「应用内监听端口」改为**反向连接（Outbound）**——应用主动外连一个本地 relay，Agent 也连同一个 relay，二者在 relay 上配对：

```
外部 Agent（workbuddy / codebuddy / hermes）
        │
        ▼  stdio / WebSocket
┌──────────────────────────────────────────┐
│ 本地 Relay（MCP over WebSocket，Node 进程）│ ← 唯一需要新起的进程，绑 127.0.0.1 + token
│   · 与浏览器之间是「浏览器主动连出的 WS」  │
│   · 与 Agent 之间是 stdio 或 WS          │
└──────────────────────────────────────────┘
        ▲ 浏览器主动连出（Outbound WebSocket）
        │
寻鸽工作台页面（IndexedDB / repository / agentOps 全在此进程内）
```

- **数据不动，指令动**：权威数据始终在浏览器 IndexedDB 里，agentOps 在页面进程内执行写库；relay 只转发「工具调用请求 / 结果」，绝不持有数据。这保留了 v0.4「Node 侧车直读 IndexedDB 不可行」的正确裁决，同时修掉了「浏览器能监听端口」的错误假设。
- **为什么不是「Node 侧车直连数据库」**：附件是 Blob、同步引擎绑 `window/navigator`、repository 耦合 `@/db` 单例——v0.4 §三的三条理由依旧成立，不重开。
- **为什么不是「应用内监听」**：见上，浏览器无 `listen` 能力。
- **CORS/CSP 前置**：`index.html` 的 CSP 为 `connect-src 'self' blob: https: http:`——`ws://127.0.0.1` 不在白名单内，需在桥落地时补 `ws:`（同 commit）。这是 v0.4/v0.5 完全没核到的硬阻塞点。
- **HTTPS 部署场景**：生产跑在 `https://` 时浏览器**禁止**连 `ws://`（混合内容），relay 必须走 `wss://` 或仅限 dev 模式。v0.6 定：**relay 首版仅服务 dev/本地自用，不做生产暴露**。

### 9.2 前提链纠正：skill/MCP 不是「第一件事」，是「最后一件」

小蓝原话「这样子的前提就是要把 skill 和 mcp 配置了」。**方向对，但顺序反了**。正确依赖链（不可跳步）：

```
agentOps 门面（写操作唯一收口：zod 校验 / 风险分级 / 事件收口 / create 门控 / 事务外 emit）
   ↓ 没有它，relay 转发过去的就是裸写库
Relay + 安全边界（127.0.0.1 + token + 能力白名单 + 一次性 confirmToken）
   ↓ 没有它，Agent 连不进来
读/写工具集 + resolveEntity 消解器
   ↓ 没有它，工具面是空的
skill 文件 + MCP tools schema（同一套 zod schema 生成，杜绝双份漂移）
   ↓ 最后一步，Agent 靠它理解意图
```

**只配 skill/MCP 而没有 agentOps = 把 17 张表裸暴露给外部 Agent。** 这是本轮对用户预想的**唯一实质性修正**。

### 9.3 对 main 最新代码的第二轮漂移核验（hy4-preview 对码，v0.5 之后又有 4 处新增漂移）

| # | v0.5 口径 | main 现状（对码） | v0.6 修正 |
|---|---|---|---|
| **D4** | 事件总线「8 个事件」 | `eventBus.ts` 实为 **9 个**（新增 `moduleConfig:changed`，Issue #34） | 声明表按 9 事件对齐；**agentOps 不 emit 它**（配置属人工决策，不开放给 Agent） |
| **D5** | 记账默认 `status='已结算'` | `TransactionFormDrawer` 新建恒为 **`status: '待对账'`**（:192） | 记账工具默认 **待对账**，与 UI 逐字段一致；不臆造 |
| **D6** | 待办完成「改 status」 | Issue #74 已收口为领域函数 **`toggleTodoDone`**（status + completedAt 成对写入，三入口统一） | `todo_completeTodo` 必须走 `toggleTodoDone`，禁止自行拼字段 |
| **D7** | 未提账本缺省失败语义 | `ledgerId` 为空时 UI 直接 `setError('请先创建账本')` | 无账本时工具返回**可操作错误**，不静默落库 |

另复核确认（无误，维持 v0.5）：D1 首联待办已删（`CustomerInitOptions` 仅剩 `openingLog` / `linkTransactionId`）、D2 `Customer.stage/industry` 已删、D3 `Ledger.isDefault` 已实装（缺省策略 `isDefault → 唯一账本 → 反问`）。

### 9.4 必填/可缺省字段纪律（v0.5 缺失，P1 写工具会直接踩）

| 工具 | 必填 | 可缺省（带兜底） |
|---|---|---|
| `fin_recordTransaction` | `summary`、`amount`(>0，≤9,999,999,999，两位小数)、`channel`(微信/支付宝/银行卡/现金/对公转账 五选一)、`ledgerId` | `type`(默认 expense)、`occurredAt`(默认今天 00:00)、`status`(默认 **待对账**)、`tags`/`note`/`customerId`/`todoId`/`projectId` |
| `crm_createCustomer` | `name` | `tier`(默认 A)、`decisionLevel`(默认 决策人)、`healthScore`(默认 60，钳 0-100)、`tags`(走 `normalizeTags`)、`openingLog`/`linkTransactionId` |
| `todo_createTodo` | `title` | `priority`(默认 P2)、`status`(默认 todo)、`dueAt`/`customerId`/`listId`/`projectId` |
| `crm_addInteraction` | `customerId`(须 resolveEntity 产出)、`content` | `type`(默认 电话)、`at`(默认 now)、`projectId` |

### 9.5 两个被 v0.4/v0.5 忽略的既有 bug（顺带修，成本极低）

1. **edit 误发 `transaction:created`**：`TransactionFormDrawer.tsx:207` 在编辑模式也 emit，会重复触发奖杯评估。事件下沉时按 v0.3 边界①「仅新 id 才 emit」一并修掉。
2. **项目跟进不发 `customer:contacted`**：`ProjectDetailPage.tsx:602` 调 `saveInteractionAndTouchCustomer` 但不 emit。按 v0.3 裁决②「项目跟进也算客户联系，统一 emit 并文档化」补齐。

### 9.6 最终架构（v0.6 唯一口径）

```
外部 Agent（自带 LLM 意图理解）
   ↓ 读 skill + MCP tools 清单 → 选工具 → 先 resolveEntity → 中/高风险先 preview
本地 Relay（Node 进程，127.0.0.1 + token；与浏览器之间是浏览器主动连出的 WS）
   ↓ 只转发，零特权，不 import repositories
浏览器页面内 agentOps（zod 校验 + 风险分级 + 事件收口 + create 门控 + 事务外 emit）
   ↓
repositories（createRepository 工厂保持纯写）→ 同步引擎 / eventBus → 奖杯 / 仪表盘
```

**不变式（一条不砍）**：事件永在事务 commit 之后；`transaction:created` 仅新建 id 才发；消解按 id 去重、去重后唯一才静默消解、重名/超阈值必反问；写工具拒绝未经 `resolveEntity` 的字符串关联；`createCustomerWithInit` 下沉 repositories；`fuzzyMatch/fuzzySort` 从 MatchCombobox 提升到 shared；打卡抽 `checkinHabit`（打卡与取消分离）。

### 9.7 P1 推进顺序（v0.6 修订）

1. **agentOps 门面 + 事件对齐测试**（断点 `transaction:created`，含 §9.5 两个 bug 修复）
2. 事件下沉 repositories（三边界：create 门控 / interaction 统一 emit / 事务外硬规则）
3. 消解器 + `resolveEntity`（id 去重 / 阈值反问 / 空输入拦截 / Project 归档沉底）
4. **本地 Relay**（Node 进程 + token + 白名单 + confirmToken）+ **CSP 补 `ws:`**
5. 读写工具集（按 §9.3/§9.4 修正版；含 `toggleTodoDone`）
6. skill 文件首版（与 MCP tools schema 同源 zod 生成）
7. 跑通 E2E 场景 = P1 主干验收

### 9.8 E2E 验收场景（沿用 v0.5，补强断言）

> 加客户「深蓝科技·王五」→ 给王五记一笔 2000 支出（账本走 isDefault 缺省，status=待对账）→ 读回该客户账目与沟通记录 → 建待办「周五回访王五」→ 查待办列表确认存在。

补强断言：① 经 relay 记一笔 vs 手工记账，`transaction:created` 载荷逐字段一致且奖杯/EXP 无差异；② 编辑该笔流水**不得**再触发 `transaction:created`；③ 读工具返回条数/字段不超白名单；④ 无 token 连接被拒；白名单关闭的域不出现在 tools 清单。

### 9.9 待拍板（1 项，不阻塞前 3 步）

**Relay 与 Agent 之间的协议形态**：stdio（CNB CodeBuddy 等本地 CLI Agent 主流）优先，还是 WebSocket（远程/多客户端）优先？建议 **stdio 优先 + WS 同进程并存**，第 4 步动工前由小蓝指定一个先行实测的 Agent（workbuddy / hermes / codebuddy 任一）即可定。

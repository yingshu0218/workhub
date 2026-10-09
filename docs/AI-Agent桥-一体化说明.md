# AI Agent 桥 · 一体化使用说明

> Issue #33「把 relay 整合进项目」——**relay 已内嵌进项目，不再需要单独部署、单独进程、单独端口。**
> 本文是唯一需要看的操作说明；`docs/relay-服务器部署说明.md`（独立部署形态）已作废。

## 一句话

relay 现在和前端**同源**：dev 由 Vite 挂 `/relay`，生产由项目自带脚本挂 `/relay`。
你**不需要**再开第二个终端跑 relay、不需要记 8787 端口、不需要 Docker / Nginx / systemd，
也不需要为它专门改 CSP 或重新构建。

```
浏览器页面 ──ws(s)://<当前站点>/relay──► relay（与站点同进程/同源）
                                            ▲
外部 Agent ──stdio / WS(标准 MCP)───────────┘
```

## 日常开发（最常用）

```bash
npm run dev
```

即可。控制台会打印：

```
[relay] 已内嵌于 dev server：/relay（同源，无需额外端口/进程）
[relay] 接入 token：xxxxxxxx
```

然后：

1. 浏览器打开 `npm run dev` 输出的地址（如 `http://localhost:5173`）；
2. 系统设置 → **AI Agent 桥** → 打开「启用 AI 桥」；
3. **relay 地址留空**（留空 = 自动使用当前站点的 `/relay`）；
4. 「能力白名单」按需打开域（财务 / CRM / 待办 …）；
5. 让 Agent（workbuddy / codebuddy 等）连 relay 即可。

> ⚠️ **顺序有个反直觉处，实测踩过**：「接入 token」输入框是**只读**的 —— 页面侧 token 由应用在
> 首次启用时随机生成，**你想「把控制台打印的 token 填进页面」是填不进去的**。可行顺序只有一条：
> **先在页面启用桥、点「复制」拿到页面 token T → 再用 `WORKHUB_RELAY_TOKEN="T"` 重启站点**。
> 两者不一致时 UI 只会显示「连接中…/连接失败」，不会告诉你差在哪（详见「token 轮换注意」）。

> 想让 Agent 用 stdio 本地连接：另开终端 `npm run relay:stdio`（仅调试用，非必需）。

## 生产 / 服务器部署

站点现在由**项目自带的静态服务脚本**托管，它同时把 relay 挂在同源 `/relay`：

```bash
npm run build                                   # 产出 dist/
PORT=9001 WORKHUB_RELAY_TOKEN="<≥16位随机串>" npm run serve
```

- 站点：`http://<服务器>:9001`
- relay：**同源** `ws://<服务器>:9001/relay`（配 HTTPS 后自动是 `wss://<服务器>/relay`）

应用里地址同样**留空**即可。无需 Nginx 反代、无需 Docker、无第二进程。

> 若你已有自己的静态托管（Nginx 等），也可只跑 relay 独立进程：
> `WORKHUB_RELAY_TOKEN=xxx npm run relay`，应用里填 `ws://<relay 地址>/`。
> 这条老路仍被保留兼容，但**不再需要**。

### 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `PORT` | `npm run serve` 监听端口 | `9001` |
| `HOST` | `npm run serve` 监听地址 | `0.0.0.0` |
| `WORKHUB_RELAY_TOKEN` | relay 接入 token（**建议显式指定**） | 随机生成并打印 |
| `WORKHUB_RELAY_PATH` | relay 挂载路径 | `/relay` |
| `WORKHUB_RELAY_HOST` / `--public` | 独立 relay 进程绑非回环地址的安全闸门 | 仅 `127.0.0.1` |

## 安全边界（内嵌后**原样保留**）

1. **token 鉴权**：Agent 连接必须携带 token；无 token 的 `initialize` 被拒。
2. **能力白名单**：关掉的域在 `tools/list` 里**直接不出现**（Agent 看不见工具）。
3. **中风险确认票据**：记账等中风险操作先回预览，Agent 转述用户确认后经 `confirm_preview` 取一次性票（**票据绑定参数**，防「预览 A 执行 B」）。
4. relay 不持有数据、不 import repositories，只转发「工具调用请求/结果」；数据始终在浏览器 IndexedDB。

## 通用性验收（换任意 Agent 前先跑这个）

`scripts/acceptance.mjs` 以「从未适配本项目的纯标准 MCP Agent」视角做协议级验收
（§10.4 口径：零应用代码 import、只说标准 JSON-RPC/MCP、零第三方依赖）：

```bash
# 1. 启动站点 + relay（dev 或 serve 均可），并在浏览器里启用 AI 桥
npm run serve        # PORT=9001 WORKHUB_RELAY_TOKEN=<token>

# 2. 跑验收
node scripts/acceptance.mjs --url ws://127.0.0.1:9001/relay --token <token>
```

覆盖条款：未鉴权/错 token 被拒 → 正确 token 握手 → tools/list schema 完整性与
`confirm_preview` 在列 → 工具调用有响应 → 桥离线时返回**可操作错误**（而非空清单/挂起）。
退出码 0 = 全部通过。桥离线时脚本会提示「先打开应用并启用 AI 桥」，
此时条款 ③④（工具清单与调用探测）自动跳过，其余照常验收。

## token 轮换注意（重要）

token 有**三个落点，值必须完全一致**（不一致时 UI 只显示「连接中…/连接失败」，不会告诉你差在哪）：

| 落点 | 位置 |
|---|---|
| relay 侧 | `WORKHUB_RELAY_TOKEN`（缺省时启动随机生成并打印） |
| 页面侧桥 | 设置 → AI Agent 桥 → **只读**输入框（页面首次启用时随机生成） |
| Agent 侧 | `~/.workhub/relay.json`（由 `npm run agent:setup -- --token <T>` 写入） |

三者是同一份值的三处副本，**不会自动同步**：

- **在设置页「重置 token」后，必须用新 token 重启 relay**（`npm run serve` / `npm run relay`
  时更新 `WORKHUB_RELAY_TOKEN`），否则桥会静默重连失败，UI 只有 status error 提示；
- 接了 Agent 的话还要重跑一次 `npm run agent:setup -- --token <新 token>`（它负责更新第三个落点）；
- 建议操作顺序：设置页重置并复制新 token → 重启 relay 携带新 token → 重跑 `agent:setup` →
  桥自动重连成功；
- relay 侧不校验「旧 token 是否仍在用」——轮换后旧 token 立即失效（这正是目的）。

## 与「独立进程形态」的关系

| 形态 | 命令 | 何时用 |
|---|---|---|
| **内嵌（推荐，默认）** | `npm run dev` / `npm run serve` | 一切日常场景 |
| 独立进程 | `npm run relay` / `relay:stdio` | 只调试 relay 本身、或你有自己的静态托管 |

两种形态共用同一份内核 `relay/server.mjs`，行为一致（同一套测试覆盖）。

## 外部 Agent 接入（两种接法）

relay 的 Agent 端点是**裸 WebSocket**（`ws(s)://<站点>/relay`），而标准 MCP 只有 stdio 与
Streamable HTTP 两种传输 —— **没有一家客户端支持「连裸 ws://」**（它会按 Streamable HTTP 发
POST，relay 只认 Upgrade 握手，直接 426）。所以 Agent 侧需要一层 stdio 桥把 JSON-RPC 帧搬过来：
项目自带 `relay/mcp-stdio-shim.mjs`，对 Agent 而言就是一台普通 MCP 服务器。

| 路线 | 做法 | 适用 |
|---|---|---|
| **一键（推荐）** | `npm run agent:setup -- --url <relay 地址> --token <T>` | 自动写入各 Agent 工具（Codex / Hermes / opencode / Claude Code / Cursor …）的配置 + 规则 + 技能。**凭据集中存 `~/.workhub/relay.json`，token 不落进任何可入库的配置文件** |
| 手动 | Agent 的 MCP 配置里写 `node <项目路径>/relay/mcp-stdio-shim.mjs --url <…> --token <T>` | 不想跑脚本、或只想接一个工具 |

> 设置页「AI Agent 桥」现在把这两条**生成好供复制**（地址取当前站点同源 `/relay`、token 已填）。
> 一键接入的完整说明（写了哪些文件、怎么卸载、怎么排障）见 `docs/一键接入-Agent说明.md`。

**常见坑（四条，逐条对应一个可操作动作）**：

| 现象 | 原因 | 处理 |
|---|---|---|
| 配了 `http(s)://<站点>/relay` 连不上 | relay 是 **WebSocket 端点**，不是 HTTP 端点（客户端会按 Streamable HTTP 发 POST，relay 只认 Upgrade 握手，回 426） | 地址写 `ws://` / `wss://`；shim 对缺协议名的写法会自动补 `ws://` 并补 `/relay` |
| `接入 token 无效` | 三个落点不一致（多半是重置过页面 token） | 按「token 轮换注意」一节：重启 relay 带上新 token，并重跑 `agent:setup` |
| `工具清单不可用：寻鸽工作台未连接 relay` | 桥没启用、或服务器上那个页面没开着 | 打开站点 → 设置 → AI Agent 桥 → 启用；**这不是配置错误，别改参数** |
| 想用 `npm run relay:stdio` 直接给 Agent | 那是「自己单独起一个 relay 进程」的入口 | 日常内嵌形态下 Agent 要连的是**站点里的** relay，走 shim 转发（见「与独立进程形态的关系」） |

## 远程场景：Agent 在本机、站点在服务器（★ 常见形态）

这是「**Agent 本机 ≠ 项目宿主**」的标准拓扑。**关键点：Agent 只连服务器的 relay，不用管数据在哪台机器** ——
数据只在服务器上那个浏览器页面的 IndexedDB 里，relay 零特权、只转发调用。

```
本机（你的 Agent / Codex / Cursor …）
  └─ stdio ─► node <项目路径>/relay/mcp-stdio-shim.mjs ─► wss://<站点域名>/relay
                                                              │（服务器上，与站点同源）
  ┌───────────────────────────────────────────────────────────┘
  └─ 服务器上有一个浏览器页面开着站点、且已启用 AI 桥 ──► agentOps ──► 该页面的 IndexedDB
```

**四个前置条件（缺一不可）**：

1. 服务器站点在跑，且 relay 同源可用（**测试环境** `http://8.153.19.221:9001` 由宿主 nginx 把 `/relay`
   转到独立 relay 进程；**正式环境**是 `https://team.fpigeon.fun` —— 见 `docs/开发测试环境说明.md`）；
2. 服务器上**有一个浏览器页面开着站点并启用了桥**（状态「已连接 relay」）。
   ⚠️ 桥只在「有页面开着」时在线；**关掉页面 = 桥离线**，Agent 会拿到「应用未连接」的**可操作错误**；
3. 本机能访问到站点域名/端口（防火墙放行，WebSocket Upgrade 不被反代吃掉）；
4. 本机侧持有与 relay 一致的 token（见「token 轮换注意」的三个落点）。

**先验链路、再配 Agent**（不接 Agent 也能自检）：

```bash
# 项目自带的连通性自检：连 relay → 列工具 → 结果打到 stderr
node relay/mcp-stdio-shim.mjs --url wss://<站点域名>/relay --token <T> --verify
# 或让 agent:setup 代跑（真起 shim、走一次 MCP 握手 + tools/list）
npm run agent:setup -- --check
```

拿到「工具清单不可用：寻鸽工作台未连接 relay」= **relay 通了，但服务器页面没开/没启用桥** ——
这不是配置错误，别改参数、别反复重试。

## 分层测试（换任意 Agent、或改动链路后按层跑）

| 层 | 命令 | 盯什么 |
|---|---|---|
| **L1 离线单测** | `npx vitest run src/agent/__tests__` | 代码本身：桥 / relay / stdio shim / 确认票据 / 白名单 |
| **L2 协议级验收** | `node scripts/acceptance.mjs --url <relay> --token <T>` | 以「从未适配本项目的纯标准 MCP Agent」视角跑 11 项条款，退出码 0 = 全通（见「通用性验收」） |
| **L3 真实 Agent**（语义层） | 接上 Agent 后按下方冒烟顺序 | 读回的数据对不对、该反问时是否反问、确认转述是否清晰 |
| **L4 端到端回归** | `npm test` | 全量；**改动链路后必跑** |

**L3 冒烟顺序（由低风险到高风险，逐步验证）**：

| 步骤 | 调用 | 风险 | 预期 |
|---|---|---|---|
| 1 | `tools/list` | — | 工具清单完整；**关掉的域直接不出现**（不是调用时才拒） |
| 2 | `resolveEntity` | low | 只读消解；候选不唯一必须**反问**，不许猜 id |
| 3 | `todo_createTodo` | low | 直接落库（**非幂等**，同参数会重复创建） |
| 4 | `fin_recordTransaction` | **medium** | 必须走确认闸门四步（见下） |

**medium 确认闸门（正向 + 负向都要验）**：

```
① 无票调用 → 只回 preview 材料（不落库），含 confirmHint 指向 confirm_preview
② Agent 把参数逐字转述给你 → 你确认
③ Agent 调 confirm_preview（参数与①完全一致）→ relay 校验「这组参数确实被预览过」→ 签发一次性 confirmToken
④ 以①完全相同的参数重试，携带 confirmToken → 真正执行
```

负向四条必须同时验：无预览直接取票被拒 / 用「预览 A」的票执行参数 B 被拒（**票据绑定参数**）/
同一张票用第二次被拒（一次性、防重放）/ `high` 风险（如 `todo_deleteTodo`）的预览载荷带 `irreversible: true`。

## skill 与 MCP 连接器：一次说清（最容易混淆的一点）

| 概念 | 是什么 | 怎么给 Agent |
|---|---|---|
| **MCP 连接器** | **调用通道** —— Agent 真正发 `tools/call` 的地方 | 配 stdio 桥那条命令（或 `agent:setup`），指向 relay |
| **skill** | **给 Agent 的说明书**：有哪些工具、参数怎么写、哪些要先确认 | `docs/skills/`（读文件即可），或让 Agent 先 `tools/list` 自举 |
| 工具 schema | 运行期真源，skill 由它**单源生成** | `tools/list` 返回；静态快照 `docs/skills/mcp-tools.json` |

一句话：**skill 不是调用通道**。Agent 读 skill 知道「怎么调」，真正调还是走 MCP 连接器。
两者都要有：**连接器负责能调通，skill 负责调得对。**

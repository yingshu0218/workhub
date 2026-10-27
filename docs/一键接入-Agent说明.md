# 一键接入任意 Agent

> 一条命令，把「寻鸽工作台」的 37 个业务工具 + 项目规则 + 桥使用技能，塞进你本机**已有**的 Agent 工具里。
>
> 对标飞书 CLI 的 `npx @larksuite/cli@latest install`：探测 → 写配置 → 提示重启。

## 最省事：一条指令，整段复制给任意 Agent（**连服务器，不连本机**）

```bash
npm run agent:setup -- --print-prompt
```

它现场向站点签发一枚**一次性配对码**（5 分钟、只能兑换一次），打印出一段文本，整段贴给任何 Agent 即可。
文本里只有：服务器地址 + 那枚短码 + 三步操作。**没有长期 token，也没有任何本机路径。**

```
Agent ──MCP over HTTP（Authorization: Bearer <token>）──► https://<站点>/relay/mcp
                                                            │
                                            服务器上的 relay ──► 那台浏览器里开着的页面（IndexedDB）
```

## 配对模型：token 怎么既不暴露、又能让任意 Agent 用上

**为什么必须有「配对码」这一步**：MCP 客户端只支持 stdio 与 Streamable HTTP，**没有一家支持裸 WebSocket**。
远程 Agent 连服务器只有一条正路 —— `https://<站点>/relay/mcp` + `Authorization: Bearer <token>`。
而长期 token 一旦写进那条可复制的文本，聊天记录、剪贴板、工单、截图就都成了凭证副本。

**所以：文本里放短码，token 由 Agent 自己换。**

| 步骤 | 谁做 | 凭证形态 |
|---|---|---|
| ① 签发短码 | 本机跑 `--print-prompt`（持已有 token 才签得出来） | 6 位短码，5 分钟、一次性 |
| ② 兑换 | Agent 自己 `curl POST /relay/pair` | 换到长期 token（只进 Agent 自己的配置/密钥存储） |
| ③ 连接 | Agent 用 `POST /relay/mcp` + Bearer | 标准 MCP over HTTP |

三条性质缺一不可，缺任何一条这个机制就形同虚设：**只能兑换一次**、**会过期**、**签发必须持 token**
（最后一条保证「只有能登录站点的人才能给自己发码」）。兑换失败一律同一句「无效或已过期」——
不给枚举者任何「这个码曾经存在过」的区分信息，并且每个 IP 每分钟限 10 次。

### 传输支持矩阵（MCP 客户端只认前两种，第三种不是标准）

| 传输 | 在哪 | 状态 | 说明 |
|---|---|---|---|
| **Streamable HTTP** | `https://<站点>/relay/mcp` | ✅ 本轮新增 | stateless：`POST` 单次 JSON-RPC → `application/json`；不发 `Mcp-Session-Id`；不提供 `GET` SSE 流（回 405，规范允许）。**远程 Agent 的唯一正路** |
| **stdio** | 本机 | ✅ 既有 | 进程间管道，**服务器侧无法提供**。两条路径：`relay/mcp-stdio-shim.mjs`（WS→stdio）与 `node relay/index.mjs --stdio` |
| 裸 WebSocket | `wss://<站点>/relay` | ✅ 内部用 | 页面桥 `/relay?role=browser` 与自研客户端用；**不是 MCP 标准传输**，写进 Agent 配置只会失败 |

**协议版本协商**：服务端支持 `2024-11-05` 与 `2025-03-26`，**回客户端请求的那个版本**。
⚠️ 不能一律回 `2024-11-05` —— Streamable HTTP 是 `2025-03-26` 才引入的，严格按版本走的客户端
会据此退回老的 HTTP+SSE 双端点协议（先 `GET` 拿 endpoint 再 `POST`），表现是「url 配对了却连不通」。
`capabilities.tools.listChanged` 如实声明为 `false`：没有任何传输实现推送工具变更，
声明 `true` 会让客户端等一个永远不会来的通知、从而不刷新工具清单。

### 服务器侧端点（本轮新增）

| 端点 | 方法 | 鉴权 | 作用 |
|---|---|---|---|
| `<路径>/mcp` | POST | `Authorization: Bearer <token>`（或 `?token=`） | 标准 MCP over HTTP（stateless）。GET 回 405（不建 SSE 流） |
| `<路径>/pair/new` | POST | Bearer token | 签发一次性配对码 |
| `<路径>/pair` | POST `{code}` | 短码本身 | 兑换长期 token |

`<路径>` 默认 `/relay`，由 `WORKHUB_RELAY_PATH` 决定；生产宿主 `scripts/serve.mjs` 与 dev 的 vite 插件都已挂上，
「本地能连、线上不能连」这类传输差异不会留到部署后才发现。

> ⚠️ **`--` 不能省**：`npm run agent:setup --url …`（少了 `--`）会被 npm 当成自己的配置项吃掉，
> 脚本一个参数都收不到。旧版会**静默复用旧凭据**（看起来像「它没识别出我给的地址」）；
> 现在会显式告警，并且连 `--dry-run` 这种布尔开关也会被一并取回（否则「预览」会变成真写）。

## 本机 Agent 的另一种接法（stdio shim，仍然支持）

Agent 与工作台在同一台机器、且不想走 HTTP 时，可以继续用 stdio shim：配置里只写 `command + args`，
token 由 `relay/mcp-stdio-shim.mjs` 从 `~/.workhub/relay.json`（600）读取后透传 —— Agent 侧看不到 token。
它连的仍然是**服务器上的** relay（`wss://<站点>/relay`），只是多了一层本地进程做传输转换。

```bash
npm run agent:setup -- --transport local --port 5173 --token <relay 打印的 token>
```

跑完**重启你的 Agent 工具**。就这些。

---

## 它到底写了什么

三件套，与飞书 CLI 的分工一致：

| 件 | 作用 | 落点 |
|---|---|---|
| **MCP** | 把 relay 桥挂成该工具的一个 MCP 服务器 | 各工具自己的配置文件 |
| **规则** | 让 Agent 知道本项目的栈 / 纪律 / 禁区 | `AGENTS.md`（**单一事实源**，不复制第二份） |
| **skills** | 讲清「怎么用这座桥」（确认流程 / 消解纪律 / 读限幅） | 各工具的技能目录 |

按探测结果逐个处理，**没装的直接跳过**：

| 工具 | 探测依据 | MCP 落点 | 规则 | 技能 |
|---|---|---|---|---|
| WorkBuddy | `~/.workbuddy` | `~/.workbuddy/mcp.json` | `AGENTS.md`（原生读） | `.workbuddy/skills/` |
| CodeBuddy | `~/.codebuddy` | `~/.codebuddy/mcp.json`（条目带 `type: "stdio"`） | `AGENTS.md`（原生读） | `.codebuddy/skills/` |
| Codex | `~/.codex` · `codex` | `~/.codex/config.toml` | `AGENTS.md`（原生读） | — |
| Hermes | `~/.hermes` · `hermes` | `~/.hermes/config.yaml`（YAML 的 `mcp_servers:`） | `AGENTS.md`（原生读） | `.agents/skills/` |
| opencode | `~/.config/opencode` · `opencode` | `opencode.json`（项目根） | `AGENTS.md`（原生读） | `.opencode/skills/` |
| Claude Code | `~/.claude` · `claude` | `.mcp.json` | `CLAUDE.md`（薄壳 → AGENTS.md） | `.claude/skills/` |
| Gemini CLI | `~/.gemini` · `gemini` | `~/.gemini/settings.json` | `GEMINI.md`（薄壳 → AGENTS.md） | — |
| Cursor | `~/.cursor` · `cursor-agent` | `.cursor/mcp.json` | `.cursor/rules/workhub.mdc` | — |

新增一家工具 = 在 `scripts/agent-setup.mjs` 的 `TARGETS` 表加一行，不用改流程。

## 为什么必须有 `relay/mcp-stdio-shim.mjs`

**relay 的 Agent 端点是裸 WebSocket**（`ws(s)://<站点>/relay`），而主流 Agent 的 MCP 客户端
只实现两种**标准**传输：stdio 与 Streamable HTTP。**没有一家支持裸 WebSocket** ——
把 `wss://` 地址直接写进 Agent 配置，客户端会按 Streamable HTTP 发 POST，relay 只认 Upgrade 握手，直接 426。

所以配置里写的其实是这个 shim：

```
Agent ──stdio(换行 JSON-RPC)──► shim ──WS(ws/wss)──► relay ──► 浏览器页面里的 agentOps
```

它对 Agent 而言就是一台**普通 MCP 服务器**（`node relay/mcp-stdio-shim.mjs`），
内部把消息原样转发给 relay。这样四个工具全都用同一种接法，换工具零适配。

## 选址：两种接入方式

```bash
# ① 本地：指向本地跑起来的站点（dev 端口通常是 5173，serve 默认 9001）
npm run agent:setup -- --transport local --port 5173 --token <token>

# ② 远程：指向已部署的站点（任何机器、任何网络都能连）
npm run agent:setup -- --url wss://<你的域名>/relay --token <token>
```

**凭据只存一处**：`~/.workhub/relay.json` 的 `{ url, token }`。
切环境就是改这一个文件（或重跑命令），**所有 Agent 配置里都不出现 token** ——
项目级配置（`opencode.json` / `.mcp.json`）是可以入库的，往里写密码等于泄密。

**刻意不设默认地址**：本项目处于开发/测试阶段，站点地址会变，代码里写死等于给所有人埋一个指向临时环境的隐性依赖。

> `token` 有两个持有方：relay 启动时（`npm run dev` 控制台打印 / `WORKHUB_RELAY_TOKEN`）与页面侧桥（设置页）。
> 在设置页「重置 token」后**必须**重跑本命令并重启 relay，否则桥会静默重连失败。

## ⚠️ 配不出来的那部分（必须人工）

relay 只是通道，**工具的实现在浏览器页面进程内**（要访问 IndexedDB，而 relay 零特权、不持数据）。
所以必须：

1. 打开站点；
2. **设置 → AI Agent 桥 → 启用桥**（地址留空 = 自动用当前站点的 `/relay`）；
3. 让「能力白名单」按需打开域（关掉的域在 `tools/list` 里直接**不出现**）。

没做这三步时：`tools/list` 返回 `-32001 工具清单不可用：寻鸽工作台未连接 relay`。
**这不是配置错误**，别改参数、别反复重试 —— 去把页面打开。

## 常用命令

```bash
npm run agent:setup -- --print-prompt     # 打印「一条指令」（零凭证，整段贴给任意 Agent）
npm run agent:setup                      # 复用已有凭据，重跑一次（幂等，无改动时零写入）
npm run agent:setup -- --dry-run         # 只预览，一个文件都不落盘
npm run agent:setup -- --only codex,hermes
npm run agent:setup -- --check           # 连通性自检：真起 shim 走 MCP 握手 + tools/list
npm run agent:setup -- --skills full     # 另投 37 个逐工具技能（通常不需要，见下）
npm run agent:setup -- --uninstall       # 把写入的全部摘干净（含凭据文件与技能目录）
npm run agent:setup -- --help
```

## 设计取舍（几个「为什么不是那样」）

**为什么默认不投 37 个逐工具技能？**
MCP 的 `tools/list` 本身就把 37 个工具的名称 / 描述 / schema 交给 Agent 了。
再写成 37 份技能是**重复投喂**，只会抬高每次请求的固定成本。所以默认只投一份元技能，
只讲 MCP schema 表达不了的四件事：桥在线是前置条件、中风险确认四步、实体消解不许猜 id、读工具会截断。
需要时 `--skills full` 才全投。

**为什么只写 `AGENTS.md` 一份规则？**
Codex / Hermes / opencode 原生读 `AGENTS.md`，它是跨工具的通用标准。
Claude Code / Gemini / Cursor 写的是**薄壳**（只写一句「规则在 AGENTS.md，请以它为准」），
避免同一套纪律维护 N 份、然后各自漂移。

**为什么改前留备份、且第二次跑零写入？**
脚本会碰用户级配置文件（`~/.codex/config.toml` 等），所以：
① 只动「托管块」标记之间的内容与 `mcpServers.workhub` 这一个键，用户自己的配置一个字节不动；
② 任何被修改的已有文件先复制成 `<file>.bak-workhub-agent-setup`；
③ 内容没变就不落盘 —— 于是重复运行**不产生任何 diff**（`--dry-run` 也因此可信）。

**为什么不用 YAML 库去改 Hermes 配置？**
本项目有「零新增运行时依赖」的硬口径（方案 §A1）。这里只需处理一种极窄形状（顶层 map + 二级 map），
遇到行内 flow 写法等无法安全解析的形状就**显式报错**让用户手动处理 —— 宁可失败，也不写坏用户的配置文件。

**为什么配对码不是「放宽鉴权」？**
它确实是 relay 上的**第二种凭证**，所以三道约束按「不许放宽」的标准写死：
① 签发要 Bearer token（只有已持有 token 的一方——页面或本机 CLI——才发得出码）；
② 兑换即作废 + 5 分钟过期（重放窗口被压到「抢在同一次兑换之前」）；
③ 每 IP 每分钟 10 次 + 失败统一话术（不给枚举者区分信息）。
代价也要如实记：短期码给攻击者留了「5 分钟内猜中」的理论窗口（6 位 32 字符表 ≈ 1e9 组合，
每秒 10 次 ≈ 需要 3 年）。真要更强，下一步是把码绑到「签发方的公网出口 IP」。



## 排障

| 症状 | 原因 | 处治 |
|---|---|---|
| `tools/list` 报「工具清单不可用」 | 页面没开 / 桥没启用 | 打开站点 → 设置 → AI Agent 桥 → 启用 |
| `--print-prompt` 报签码 404 | 线上镜像还没带 `/relay/mcp` 这版 | 先部署新镜像（`docker compose pull && up -d`），再重跑 |
| `POST /relay/mcp` 回 401 | 没带 `Authorization: Bearer` 或 token 不对 | 先 `POST /relay/pair` 用短码换 token，再带上 |
| `POST /relay/mcp` 回 405 | 用 GET 去连了（本端点不建 SSE 流） | 改用 POST 发 JSON-RPC |
| 报「接入 token 无效」 | 凭据与 relay 不一致（多半是重置过 token） | 重跑 `agent:setup -- --token <新 token>` 并重启 relay |
| 报「relay 不可达」 | 站点没起 / 地址错 / 反代没放行 WebSocket Upgrade | 先 `npm run agent:setup -- --check` 定位是哪一段断了 |
| Agent 里看不到 `workhub` 服务器 | 没重启 Agent 工具 | 重启；Hermes 可试 `/reload-mcp`，opencode 可试 `/mcp reload` |
| Hermes 看不到 `.agents/skills/` 的技能 | Hermes 需在 `skills.external_dirs` 里带上该目录 | 在 `~/.hermes/config.yaml` 补上，或改用 `~/.hermes/skills/` |
| opencode 报 `mcp` 结构不认 | 你的 opencode 是 V2（`mcp.servers` 结构） | `--opencode-schema v2` |
| 仓库搬了位置 | 配置里写的是绝对路径 | 重跑 `agent:setup` |

## 相关测试

| 套件 | 盯住什么 |
|---|---|
| `src/agent/__tests__/stdioShim.test.ts` | shim 真起进程走全链路；stdout 零坏行；桥离线/relay 不可达都**有响应**而非挂起 |
| `src/agent/__tests__/agentSetup.test.ts` | 托管块与 YAML 合并不越界、幂等、`--uninstall` 不误删用户条目、**token 不出现在可入库文件里** |

## 生成物与入库

`agent:setup` 产出的都是**本机派生**（含绝对路径，换机器即失效），已在 `.gitignore` 里排除：
`.agents/` `.opencode/` `.claude/skills/` `.workbuddy/skills/` `opencode.json` `.mcp.json`
`CLAUDE.md` `GEMINI.md` `.cursor/mcp.json` `.cursor/rules/workhub.mdc`。

**团队共享的是两处事实源** —— `AGENTS.md`（手写，必须提交）与 `docs/skills/`（由 `npm run gen:skills` 生成），
其余各人在自己机器上重跑一次命令即可。

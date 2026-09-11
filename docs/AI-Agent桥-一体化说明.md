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
3. **relay 地址留空**（留空 = 自动使用当前站点的 `/relay`），token 填控制台打印的那个；
4. 「能力白名单」按需打开域（财务 / CRM / 待办 …）；
5. 让 Agent（workbuddy / codebuddy 等）连 relay 即可。

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

token 有**两个持有方**：relay（启动时经环境变量/打印获得）与页面侧桥（设置页保存）。
两者是**同一份值的两处副本**，不会自动同步：

- **在设置页「重置 token」后，必须用新 token 重启 relay**（`npm run serve` / `npm run relay`
  时更新 `WORKHUB_RELAY_TOKEN`），否则桥会静默重连失败，UI 只有 status error 提示；
- 建议操作顺序：设置页重置并复制新 token → 重启 relay 携带新 token → 桥自动重连成功；
- relay 侧不校验「旧 token 是否仍在用」——轮换后旧 token 立即失效（这正是目的）。

## 与「独立进程形态」的关系

| 形态 | 命令 | 何时用 |
|---|---|---|
| **内嵌（推荐，默认）** | `npm run dev` / `npm run serve` | 一切日常场景 |
| 独立进程 | `npm run relay` / `relay:stdio` | 只调试 relay 本身、或你有自己的静态托管 |

两种形态共用同一份内核 `relay/server.mjs`，行为一致（同一套测试覆盖）。

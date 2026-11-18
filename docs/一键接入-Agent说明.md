# Agent 接入

本项目按个人使用设计。新设备或 Agent 的主路径是「后台签发一次性配对码 → 连接端兑换独立凭据 → 本机安全保存 → 单独撤销」。

## 新设备配对

1. 拥有者登录站点，打开「设置 → Agent 接入」，输入接入名称（例如“工作电脑 Codex”），按需调整能力并生成配对码。码只显示一次，有效期 10 分钟；兑换、过期或撤销后都不能再用。
2. 通用 MCP 客户端无需安装本仓库：向站点 Relay 发送一次性兑换请求：

   ```http
   POST https://<站点>/relay/agent/pair/redeem
   Content-Type: application/json

   {"code":"<后台显示的配对码>"}
   ```

   响应包含 `token`、`credentialId` 和可直接连接的 MCP `url`。客户端应把 token 立刻保存到目标设备的系统安全凭据库，再以该 `url` 和 `Authorization: Bearer <token>` 连接；不要打印、转述 token，也不要写到项目级配置或聊天。

3. 若目标设备已有本仓库副本，并希望自动更新已检测到的本机 Agent 配置，可选用安装器：

   ```bash
   npm run agent:setup -- --url wss://<站点>/relay --pair --only codex
   ```

   后台生成的一次性短码可以交给预期接入的 Agent 兑换；它限时且只能消费一次。使用 CLI 时在终端隐藏输入处粘贴短码，不要把它放进命令行参数。长期 token 不得回显到对话、终端或日志。若希望把同一份本机凭据配置到所有已检测到的客户端，可省略 `--only codex`；若要让 Codex 和 Hermes 使用可分别撤销的凭据，请为两者各生成一个后台名称，并分两次分别指定 `--only codex`、`--only hermes`。

4. 使用安装器时，CLI 通过 Relay 兑换，并将每次配对的 token 保存到独立文件 `~/.workhub/agents/<credentialId>.json`。凭据目录权限为 0700、文件权限为 0600。生成的 MCP 配置只包含文件路径，不包含 bearer token；token 不进入进程参数、终端输出或日志。完成后重启对应 Agent。

CLI 只自动修改探测到的客户端；`--only` 可选择目标。自检和后续配置可使用服务器响应中的凭据编号：

```bash
npm run agent:setup -- --url wss://<站点>/relay --credential-id <credentialId> --only codex --check
```

独立连接保留各自的文件和服务端记录。只撤销某一项不会轮换共享秘密，也不会影响其他凭据。后台“已兑换”只表示 PocketBase 已消费短码并签出凭据，不代表设备已经保存、完成配置或当前在线。

## MCP 客户端备用接入方式

安装器不会声称能自动修改任意远端客户端。通用客户端直接用上面的 HTTP 兑换协议，不需要仓库；响应里的 `url` 是 MCP endpoint，token 只存入目标设备的安全凭据库，并由客户端在请求中发送 `Authorization: Bearer`。

若客户端只支持 stdio，可在目标设备本地配置 MCP server，命令指向仓库的 `relay/mcp-stdio-shim.mjs`，环境变量 `WORKHUB_RELAY_CRED_FILE` 指向本机凭据文件。仅支持远程 Streamable HTTP 的客户端，应由它自己的本机安全凭据库读取 token。若目标设备没有仓库副本，先由客户端直接调用兑换端点并将 token 安全保存到该客户端可访问的凭据库；不要把 token 复制到配置文本。

## 失败恢复

- 配对码无效、过期、已兑换或已撤销：回后台重新生成，不要重复使用旧码。
- 兑换响应丢失或 Relay/PocketBase 返回服务故障：结果可能未知。先查看后台记录；如果已兑换或无法确认，撤销该接入再重新配对。系统不保存明文 token 用于重放。
- 兑换成功但本机凭据文件写入失败：检查文件是否已安全保存；若不能连接，后台撤销这条可能已签发的接入，再生成新码。
- 文件已保存但客户端配置失败：用 `--credential-id <id>` 重跑所选客户端配置或 `--check`，不会再次兑换短码。
- 取消待配对记录会清除短码；撤销后后续 HTTP、WebSocket 与 stdio 请求都将被拒绝。历史凭据记录保留，后台列表支持分页查找。

## 安全与兼容边界

配对码由 PocketBase 0.40.2 的安全随机 API 生成：字符表为 `ACDEFGHJKLMNPQRSTUVWXYZ23456789`，长度 33，约 163.5 bit 熵。服务端只存短码 SHA-256；短码兑换在 PocketBase 事务内一次性消费并发行独立 token，服务端只存 token 散列。匿名 PocketBase 兑换接口单独限制 2048 字节请求体，并按其 socket 来源 IP 限流；Relay 限速是额外保护，不能替代直达 PocketBase 的限制。PB 进程经重启后，未过期的短码继续有效且使用原过期时间；已兑换、过期、撤销或旧恢复世代短码不能复活。

`pairedAt` 表示服务端兑换时间。它不作为客户端落盘或在线状态。恢复世代、token 能力、部署域及逐请求撤销仍由现有 PocketBase 凭据认证控制。

后台会先探测 `/relay/agent/pair/status`。若 Relay 没有独立凭据执行器（例如未连接该执行器的 Vite dev/preview），页面会禁用发码并说明该环境暂不支持；即使直接请求兑换端点，Relay 也会在调用 PocketBase 前返回 503，不消费配对码或签发不可用凭据。

### 旧版共享浏览器桥

「旧版 AI 浏览器桥（共享凭据兼容）」仅保留给现有浏览器桥客户端。它的共享凭据不能按 Agent 单独撤销，不能作为新设备主路径。旧的 `/relay/pair`、`/relay/pair/new` 接口只承担兼容语义；新的后台命名配对使用 `/relay/agent/pair/redeem`，不会回退到共享 token 或 owner 会话。

### 工具发现与执行权限

`tools/list` 和随仓库生成的 `docs/skills/` 是工具目录，不是授权结果。服务端每次请求仍按该 Agent 的独立能力、部署白名单、数据世代和客户端身份检查；看到某个工具不代表它可以执行。遇到 `FORBIDDEN` 时请让拥有者在「设置 → Agent 接入」调整该客户端的能力，不要用其它参数或工具绕过。

独立 Agent 当前不能执行兼容工具 `searchEntities`（即使参数带 `types` 也会拒绝）。按数据域改用 `resolve_contacts`、`resolve_topics`、`query_tasks`、`search_activities`、`query_finance` 或 `listNotes` 等具名查询。习惯工具只读历史数据；读取 `listHabits` 需要已有 `habit:read`，当前配对界面不再提供该能力，习惯写入/打卡已退役。

## 常用命令

```bash
npm run agent:setup -- --url wss://<站点>/relay --pair --only codex
npm run agent:setup -- --credential-id <id> --only codex --check
npm run agent:setup -- --print-prompt       # 打印不含短码与长期凭据的说明
npm run agent:setup -- --dry-run            # 预览非兑换配置写入
npm run agent:setup -- --skills-only --only codex,hermes,claude,opencode,workbuddy,codebuddy
npm run agent:setup -- --uninstall          # 移除本脚本托管的配置与当前所选凭据
npm run agent:setup -- --help
```

`--skills-only` 只刷新项目里的技能说明，不读取或修改 MCP 配置、凭据；Codex 与 Hermes 共用 `.agents/skills`。脚本只更新带本项目署名或匹配已核验旧模板的技能，用户自定义文件会保留。单目标卸载也不会删除另一目标共用的技能目录。

若之前启用过逐工具技能，使用 `--skills-only --skills full --only codex,hermes` 可刷新这两类客户端的完整工具页；已核验属于本项目的四个退役习惯写页会在技能刷新时清理。

`--check` **不是只读检查**：命令会先写入/更新所选凭据与 MCP 客户端配置，再通过本机 stdio shim 做握手和 `tools/list`。只想核验现有连接时，在已经配置的 MCP 客户端里刷新连接并调用 `tools/list`；这不会重写本机配置。不要将 bearer token 放入命令行。

不要使用 `--token` 命令行参数；脚本拒绝该参数。测试或隔离环境可设置任务专用 `WORKHUB_AGENT_HOME` 和 `WORKHUB_PROJECT_ROOT`，无需改写 `HOME` 或真实客户端配置。

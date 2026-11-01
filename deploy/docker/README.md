# Web 版一体化镜像（前端 + relay + PocketBase）

> 部署到 VPS，浏览器打开即用。**不含手机端 / 桌面端（Tauri）**。
> 镜像由 CNB 流水线构建并推到 CNB 制品库，服务器只 `docker pull`。

## 镜像在哪

```
docker.cnb.cool/blueteam0715/workhub:latest          # main 分支的最新构建
docker.cnb.cool/blueteam0715/workhub:<短提交SHA>      # 对应某个提交（可追溯）
docker.cnb.cool/blueteam0715/workhub:v1.2.2          # 打 v* tag 时产的固定版本
```

仓库已设为**公开**，Docker 制品的可见性随仓库公开 —— **`docker pull` 无需登录**，服务器上不需要保存任何凭据。

## 怎么跑

```bash
docker run -d --name workhub \
  -p 8080:80 \
  -v /srv/workhub/data:/data \
  -e WORKHUB_RELAY_TOKEN='<≥16 位随机串>' \
  -e PB_SUPERUSER='admin@example.com' \
  -e PB_SUPERUSER_PASSWORD='<≥8 位，首次启动用它建超管>' \
  -e PB_IMPORT_COLLECTIONS=1 \
  --restart unless-stopped \
  docker.cnb.cool/blueteam0715/workhub:latest
```

然后浏览器开 `http://<服务器>:8080`；PocketBase 管理台在同源 `/_/`。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PUBLIC_PORT` | `80` | **容器对外唯一端口**（容器内由入口脚本做同源路由） |
| `WORKHUB_RELAY_TOKEN` | 随机 | Agent 桥的接入 token。**生产必须显式给**，否则每次重建都换 |
| `PB_SUPERUSER` / `PB_SUPERUSER_PASSWORD` | 空 | 两者**同时提供**时，启动前自动 `superuser upsert`（幂等）。缺省则跳过 |
| `PB_IMPORT_COLLECTIONS` | `0` | 设 `1` 时，**仅当 `collections.json` 里声明的集合一个都不存在**（= 全新空库）才导入 |
| `PB_DATA_DIR` | `/data/pb_data` | PB 数据库目录 —— **必须挂卷**，否则重建即丢数据 |
| `PB_HTTP` | `127.0.0.1:8090` | PB 监听地址（容器内回环，不对外） |
| `PORT` / `HOST` | `9001` / `127.0.0.1` | 内部 serve.mjs 的端口/地址（不对外） |
| `WORKHUB_ADMIN_USER` / `WORKHUB_ADMIN_PASSWORD` | 空 / 空（compose 默认） | **兜底管理员**：容器启动时幂等创建该账号（`createRule` 是 Locked，只能由服务端建）。⚠️ **两者一配齐，首启自助注册就不会出现**（账号已存在）—— 默认留空即走页面自助注册；要用兜底就显式填这两项，密码自定 |

### 卷

只有 `/data` 一个：里面是 PB 的 `pb_data`（库 + 上传物）与 `pb_migrations`。
**其它东西都在镜像里**（前端产物、relay、PB 二进制、pb_hooks），换镜像即换代码。

## 路由（为什么只需要暴露一个端口）

| 路径 | 去处 |
|---|---|
| `/api` 、`/api/**` | PocketBase |
| `/_` 、`/_/**` | PocketBase（管理台） |
| `/setup/status` 、`/setup/user` | `scripts/serve.mjs`（首启自助注册，见下节） |
| 其余（含 `/relay` 与 WebSocket 升级） | `scripts/serve.mjs`（`dist/` 静态站 + 同源 relay） |

**同源是硬要求**：前端用相对路径请求 `/api/...`，PB 与页面不同源会跨域并撞 CSP。
所以不要在容器外再套一层只转发 `/` 的反代 —— 那会把 `/api` 也带走。

## 首启初始化（自助设账号）

全新空库（`users` 集合 0 条）第一次打开站点，页面显示「初始化工作台」：填用户名（3–32 位，
字母/数字/下划线/点/横线）、密码（≥8 位）、确认密码 →「创建并进入」，建完直接登录。

- **只在首启窗口可用**：判据是「`users` 为空」。建出第一个账号后 `/setup/user` 一律 409，
  接口自动失效，没有额外开关要关。
- 创建动作走**超管凭据**（`PB_SUPERUSER` / `PB_SUPERUSER_PASSWORD`，容器内继承，页面拿不到）。
  这两项没配 → 接口回 503，页面回落到普通登录表单。
- 登录标识始终是**邮箱**：前端把用户名补成 `<用户名>@workhub.local` 再登录，`identityFields` **不需要**改动。
  首启时后端会 best-effort 补一个 `username` 展示字段，补不上也不影响建号。
  已有部署无需跑 `patch:users-auth`（该脚本按旧口径写 `identityFields`，在 PB 0.40 上会失败）。
- 与 `WORKHUB_ADMIN_USER/PASSWORD` **不冲突，但前者优先**：配了就会先建出 `admin` 账号，
  首启引导随即不再出现。二者取一的建议见上一节环境变量表。

## 排错

| 现象 | 多半是 |
|---|---|
| 容器起来但页面 404 | `/app/dist/index.html` 缺失 → 镜像构建有问题，去看 CNB 构建日志 |
| `/api/health` 502 | PocketBase 没起来 → 看容器日志里 `[entry]` 与 PB 自己的输出 |
| 页面能开但数据全空、控制台 404 | `/api` 没被代理到 PB → 确认用的是本入口（而不是直接把 `serve.mjs` 当 entrypoint） |
| 每次重建都要重新配 Agent 桥 | `WORKHUB_RELAY_TOKEN` 没显式设置（缺省是随机生成） |
| 重建后数据没了 | `/data` 没挂卷 |
| **站点能开，但一张业务表都没有**（`/api/collections` 里只有 `users`） | 首启空库判据被 PB 自建的 `users` 集合误判 → 补救步骤见 `docs/Docker镜像构建与部署.md` §5.3 |
| `docker pull` 报 **401 Unauthorized** | 机器上 `config.json` 里的凭据**已失效**（发出后不会回退匿名）→ 重新 `-u cnb` 登录；别去查仓库可见性 |
| 用 `curl -H 'Host: …' https://127.0.0.1/...` 测站点得到 404 | 该写法**只改 HTTP 头、不改 TLS 的 SNI**，nginx 按 SNI 路由到了默认 server → 要用真域名测 |

## 为什么手机端（Tauri）不在这个镜像里

- `.dockerignore` 把 `src-tauri/` 挡在构建上下文之外（Rust 壳、原生图标都不进镜像）；
- `vite.config.ts` 的 `tauriCspPlugin` **按 `TAURI_ENV_PLATFORM` 自判**，容器构建里该变量不存在 → 插件空转，产物就是纯 Web 版；Dockerfile 里还显式清了一遍做防御；
- `src/platform/env.ts` **保留**：它是纯 `window` 判定的运行环境探测，Web 端也在用，删了会连带 Web 构建一起坏。

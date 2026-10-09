# Docker 镜像构建与部署（Web 版）

> 面向「**正式环境**」的交付通道：代码推 CNB → **CNB 流水线构建 docker 镜像** → VPS 上 `docker pull` 运行。
> 测试环境的源码部署（`devtest` / `scripts/deploy.mjs`）是另一条通道，两者互不影响。
>
> 容器自身的运行参数（环境变量 / 卷 / 路由 / 排错）见 [`deploy/docker/README.md`](../deploy/docker/README.md)。

## 1. 这个镜像是什么

一个容器跑起完整的 Web 版工作台：

```
容器对外只暴露一个端口（PUBLIC_PORT，默认 80）
  ├─ /api 、/api/**      → PocketBase（127.0.0.1:8090）
  ├─ /_  、/_/**         → PocketBase 管理台
  └─ 其余（含 /relay 与 WS 升级）→ scripts/serve.mjs（dist/ 静态站 + 同源 relay）
```

**只有 2 个业务进程**（PocketBase + node），没有 nginx、没有进程管理器 —— 同源路由由
`deploy/docker/entrypoint.mjs` 一个文件承担。之所以能这样，是因为本项目早先把「站点 + relay
同域」收进了 `scripts/serve.mjs`（见该文件头部注释：就是为了免掉 Docker + Nginx + systemd）。

**不含手机端 / 桌面端（Tauri）**，排除方式见下节。

## 2. 怎么排除手机端（Tauri）

三处保证，缺一都可能让 Tauri 内容混进镜像：

| 手段 | 位置 | 作用 |
|---|---|---|
| 挡在构建上下文之外 | `.dockerignore` 的 `src-tauri/` | 物理上进不了镜像（Rust 壳、Cargo 依赖、各平台图标都不在） |
| 插件自判 | `vite.config.ts` 的 `tauriCspPlugin` | 只在 `TAURI_ENV_PLATFORM` 存在时生效；容器构建不设该变量 → 空转 |
| 防御性清空 | `Dockerfile` 构建阶段的 `ENV TAURI_ENV_PLATFORM=` 等 | 即便外层有意设过，也保证是纯 Web 构建 |

⚠️ **不要把 `src/platform/` 也排除掉**：`src/platform/env.ts` 是纯 `window` 判定的运行环境探测
（`isTauri()` / `isWeb()`），**Web 端也在用它**（例如生产构建里据此跳过 Service Worker），
删了会连带 Web 构建一起坏。它只是「被两端共用」，不是「Tauri 专属」。

## 3. CNB 流水线

定义在仓库根 `.cnb.yml`，两个触发器：

| 触发 | 产物 tag |
|---|---|
| push 到 `main` | `:latest` + `:<短提交SHA>` |
| 推 `v*` tag | `:<tag名>` + `:<短提交SHA>` |

镜像地址：`docker.cnb.cool/<组织>/<仓库>`（本项目即 `docker.cnb.cool/blueteam0715/workhub`）。
**推 CNB 自有制品库不需要任何登录**，流水线内置触发者凭据。

两个刻意的设计：

- **`lock(wait: true)` 串行化**：连续两次 push 会并发构建，若「旧」构建最后推完，`latest` 会**静默退回旧镜像**。加锁让它们排队，保证最新的最后落地。
- **先推 sha 再推 `latest`**：中途失败时 `latest` 不会指向一个没推全的镜像。
- **tag 推送不触发 GitHub 镜像**：那是刻意的 —— tag_push 事件下检出的是该 tag 所在提交，会把 GitHub 的 `main` 推回退（详见 `.cnb.yml` 里 mirror 段的说明）。tag 的同步由「每日 03:00 兜底 + 通常伴随的 main 推送」覆盖。

> ⚠️ CNB 的**顶层键匹配的是「分支名或 Tag 名」**：写 `main: tag_push:` 匹配的是「名叫 main 的 Tag」，
> 会永不触发**且不报错**。要匹配所有 v 开头的 tag，只能写 `"v*":`。

## 4. 构建验证

```bash
# ① 看构建状态（拿到构建号 sn）
cnb build get-build-logs --repo blueteam0715/workhub --sha <完整提交SHA>

# ② 看失败阶段的完整日志
cnb build get-build-status --repo blueteam0715/workhub --sn <sn>
cnb build get-build-stage  --repo blueteam0715/workhub --sn <sn> \
  --pipelineId <sn>-001 --stageId stage-1

# ③ 查制品与 tag 溯源（要看到 revision = 提交 SHA 才算对）
cnb registries list-packages    --slug blueteam0715/workhub --type docker
cnb registries list-package-tags --slug blueteam0715/workhub --type docker --name workhub
```

⚠️ **不要用 digest 判断「两个 tag 内容是否一致」**：同一个提交走 `main` 与 `v*` 两条流水线会产出
**digest 不同、内容相同**的镜像（`COPY` 带入的时间戳等元数据不同，`docker build` 默认不可复现）。
要证明是同一份东西，比三样：`annotations.revision` 一致、目标产物字节数一致、产物里的特征标记一致。

## 5. 在 VPS 上部署

```bash
# 登录（用户名必须是 cnb 这个固定值；填个人账号名会被拒且报错为空原因）
AT=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.cnb/token')))['access_token'])")
printf '%s' "$AT" | sudo docker login docker.cnb.cool -u cnb --password-stdin

sudo docker pull docker.cnb.cool/blueteam0715/workhub:latest
sudo docker run -d --name workhub -p 8080:80 -v /srv/workhub/data:/data \
  -e WORKHUB_RELAY_TOKEN='<≥16 位>' \
  -e PB_SUPERUSER='<超管邮箱>' -e PB_SUPERUSER_PASSWORD='<≥8 位>' \
  -e PB_IMPORT_COLLECTIONS=1 \
  --restart unless-stopped \
  docker.cnb.cool/blueteam0715/workhub:latest
```

**首次启动会做三件事**（幂等，可安全重复）：建/更新超管（若给了凭据）→ 等 PB 就绪 →
库内还没有业务集合时导入 `pb_setup/collections.json`。

⚠️ **`/data` 必须挂卷**，PB 的库与上传物都在里面。不挂卷则容器重建即丢数据。

## 6. 与其它部署通道的关系

| 通道 | 目标 | 怎么更新 |
|---|---|---|
| **源码部署**（`scripts/deploy.mjs` → `devtest`） | 测试/开发 | `git pull` + `npm run build` + scp 产物 |
| **镜像部署**（本文档） | 正式环境 | `docker pull` + 重建容器 |

两条通道**互不影响**：镜像通道只把「Web 产物 + relay + PocketBase」打进容器，
不改服务器上的源码目录、也不碰测试环境的 nginx / systemd 单元。

## 7. 排错速查

| 现象 | 多半是 |
|---|---|
| CNB 流水线不触发 | 顶层键写成了 `main: tag_push:` —— 那匹配的是「名叫 main 的 Tag」 |
| `docker login` 报 404 | 地址写成 `cnb.cool` 了，正确是 `docker.cnb.cool` |
| `docker login` 报**空原因**的 `unauthorized` | 用户名填成了个人账号名，必须用 `-u cnb` |
| 服务器拉镜像 401，但老镜像能拉 | 机器上 `/root/.docker/config.json` 里有**失效凭据**，被发出后**不会回退匿名** → 重新 `-u cnb` 登录，别去查仓库可见性 |
| `permission denied … docker.sock` | 当前用户不在 docker 组，加 `sudo`（`login` 与 `pull` 要用同一个 sudo 上下文） |
| 页面开了但 `/api` 全 404 | 容器外又套了只转发 `/` 的反代，把 `/api` 也带走了 —— 别套 |

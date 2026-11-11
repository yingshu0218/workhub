# ─────────────────────────────────────────────────────────────────────────────
# 寻鸽工作台 · Web 版一体化镜像（前端 + relay + PocketBase）
#
#   用途：部署到 VPS，浏览器打开即用。
#   入口：容器对外只暴露一个端口，由 deploy/docker/entrypoint.mjs 做同源路由 ——
#         /api、/_/            → PocketBase（管理台在 /_/）
#         其余（含 /relay 与 WS 升级）→ scripts/serve.mjs（dist/ 静态站 + 同源 relay）
#   同源是硬要求：前端用相对路径请求 `/api/...`，PB 与页面不同源就会跨域 + 撞 CSP。
#
# ⚠️ **手机端 / 桌面端（Tauri）被刻意排除**，三条保证：
#   1) `.dockerignore` 把 `src-tauri/` 挡在构建上下文之外 —— 物理上进不了镜像；
#   2) `vite.config.ts` 的 `tauriCspPlugin` 是**按环境变量自判**的（`TAURI_ENV_PLATFORM`），
#      容器里该变量不存在 → 插件空转，产物就是纯 Web 版；下面还显式清了一遍做防御；
#   3) `src/platform/env.ts` **保留**（Web 端也在用它做环境判定），它不是 Tauri 专属。
#
# 架构：多阶段。构建阶段装全套 devDeps 出 dist；运行阶段只留 node + PB 二进制 + 产物。
#       **运行阶段不带 node_modules** —— relay/ 与 scripts/serve.mjs 只用 `node:` 内置模块。
# ─────────────────────────────────────────────────────────────────────────────

ARG PB_VERSION=0.40.2

# ══════════════════════════ 阶段一：构建 Web 产物 ══════════════════════════
FROM node:22-bookworm-slim AS web

WORKDIR /app

# 先只拷依赖清单，让 npm ci 单独成层、可被缓存
COPY package.json package-lock.json ./
RUN npm ci

# 再拷其余源码（src-tauri / docs / design / .git 等已被 .dockerignore 排除）
COPY . .

# 防御性清空 Tauri 相关环境变量：即便外层有意设过，这里也保证是纯 Web 构建
ENV TAURI_ENV_PLATFORM= \
    TAURI_ENV_ARCH= \
    TAURI_ENV_FAMILY= \
    TAURI_ENV_PLATFORM_VERSION=

# check:icons + tsc -b + vite build
RUN npm run build

# P3/P4：服务端执行器（agent/serverReads.ts → dist-server/server-executor.mjs，esbuild 单文件）。
# 与 dist 同属构建产物：agentOps 服务端执行器（27 工具直读/直写 PB 中心）运行时加载。
RUN npm run build:server

# ══════════════════════════ 阶段二：运行 ══════════════════════════
FROM node:22-bookworm-slim AS runtime

ARG PB_VERSION
ARG TARGETARCH
ARG GIT_REVISION=""

# PocketBase 官方二进制。用 TARGETARCH 而不是写死 amd64 —— 换 arm64 机器不用改文件
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates unzip; \
    rm -rf /var/lib/apt/lists/*; \
    case "${TARGETARCH:-amd64}" in \
      amd64) PB_ARCH=amd64 ;; \
      arm64) PB_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip"; \
    unzip -q /tmp/pb.zip -d /app; \
    rm -f /tmp/pb.zip; \
    chmod +x /app/pocketbase; \
    /app/pocketbase --version

WORKDIR /app

# 前端产物：只拷构建阶段的 dist，源码不进运行镜像
COPY --from=web /app/dist ./dist

# 服务端执行器（agentOps P3/P4）：serve.mjs 在 WORKHUB_SERVER_EXECUTOR=1 时动态加载
COPY --from=web /app/dist-server ./dist-server

# 运行时真正会被执行的文件
COPY relay ./relay
# ⚠️ 这里按文件名逐个拷：**新增被 serve.mjs import 的脚本必须同步加一行**，
# 否则运行期 ERR_MODULE_NOT_FOUND，容器直接退出（2026-11-01 已踩：setupRoutes.mjs）。
COPY scripts/serve.mjs ./scripts/serve.mjs
COPY scripts/setupRoutes.mjs ./scripts/setupRoutes.mjs
COPY deploy/docker/entrypoint.mjs ./entrypoint.mjs

# PocketBase 的初始化物料（hooks 生效；collections 供首次启动按需导入）
COPY pb_setup/pb_hooks ./pb_hooks
COPY pb_setup/pb_migrations ./pb_migrations
COPY pb_setup/collections.json ./pb_setup/collections.json

COPY package.json ./

# PB 的数据库 / 上传物是**运行期状态**，必须挂卷。
# 声明成 VOLUME 是为了裸跑 `docker run` 时状态也不会丢在容器层里。
VOLUME ["/data"]

ENV NODE_ENV=production \
    PUBLIC_PORT=80 \
    PORT=9001 \
    HOST=127.0.0.1 \
    PB_HTTP=127.0.0.1:8090 \
    PB_DATA_DIR=/data/pb_data \
    PB_MIGRATIONS_DIR=/app/pb_migrations \
    PB_HOOKS_DIR=/app/pb_hooks \
    PB_COLLECTIONS=/app/pb_setup/collections.json

EXPOSE 80

LABEL org.opencontainers.image.title="nexus-workspace-web" \
      org.opencontainers.image.description="寻鸽工作台 Web 版（前端 + relay + PocketBase）；不含 Tauri 手机端/桌面端" \
      org.opencontainers.image.source="https://cnb.cool/blueteam0715/workhub" \
      org.opencontainers.image.revision="$GIT_REVISION"

ENTRYPOINT ["node", "/app/entrypoint.mjs"]

/**
 * Vite 插件：把 Relay 内嵌进 dev server（Issue #33「整合进项目」）。
 *
 * 此前 dev 用 relay 是「另开一个进程 + 另开一个端口（8787）+ 额外放行 CSP」：
 *   `npm run relay`  ←→  `npm run dev`   两件事、两个端口、CSP 还得单独注入 ws 源。
 *
 * 现在改为：relay 直接挂在 Vite dev server 的 http server 上，路径 `/relay`（同源）。
 * 好处（全部是用户实际卡点的消解）：
 *   1. **一条命令**：`npm run dev` 同时跑前端 + relay，不用再开第二个终端；
 *   2. **同源**：页面连 `ws://localhost:5173/relay`，不跨域、不需 CSP 放行额外 ws 源；
 *   3. **端口归一**：不再有 8787 这个「要记住的端口」，桥地址可留空自动推导（见 bridge.ts）。
 *
 * 安全边界不变：token 鉴权、能力白名单、中风险确认票据三道闸门原样保留。
 * token 通过 `WORKHUB_RELAY_TOKEN` 指定（缺省随机生成并打印到 dev 控制台）。
 */
import { createRelay } from '../relay/server.mjs'

/**
 * @param {object} [opts]
 * @param {string} [opts.token]
 * @param {string} [opts.path]
 * @param {boolean} [opts.autoIssueConfirm] dev 便利：预览响应自动附一次性 confirmToken（自动化联调用）
 */
export function relayPlugin(opts = {}) {
  const path = opts.path ?? '/relay'
  const autoIssueConfirm = opts.autoIssueConfirm ?? process.env.WORKHUB_RELAY_AUTO_CONFIRM === '1'
  let relay = null
  /** @type {import('vite').ViteDevServer['httpServer'] | null} */
  let httpServer = null

  const upgradeHandler = (req, socket, head) => {
    // 只接管 /relay；命中其它路径时把 socket 交回给 Vite 自己的处理者（HMR 走 /，不能抢）
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== path && url.pathname !== `${path}/`) return
    } catch {
      return
    }
    relay?.handleUpgrade(req, socket, head)
  }

  return {
    name: 'workhub-relay',
    apply: 'serve',
    configureServer(server) {
      relay = createRelay({ token: opts.token ?? process.env.WORKHUB_RELAY_TOKEN, autoIssueConfirm, path, log: (m) => server.config.logger.info(m) })
      httpServer = server.httpServer
      if (!httpServer) return
      httpServer.on('upgrade', upgradeHandler)
      // HTTP 传输（`/relay/mcp` 远程 Agent 直连、`/relay/pair*` 配对码）在 dev 也挂上，
      // 否则「本地能连、线上不能连」这类传输差异只会在部署后才暴露
      server.middlewares.use((req, res, next) => (relay?.handleHttp(req, res) ? undefined : next()))
      server.config.logger.info(`[relay] 已内嵌于 dev server：${path}（同源，无需额外端口/进程）`)
      server.config.logger.info(`[relay] 接入 token：${relay.token}`)
      server.config.logger.info(`[relay] 浏览器侧：「AI Agent 桥」地址留空即用当前站点（推荐），或填 ws://<本机>${path}`)
    },
    closeBundle() {
      /* noop：仅 dev 生效 */
    },
    configurePreviewServer(server) {
      // `npm run preview` 同样内嵌，便于本地验证生产构建（同源 /relay）
      relay = createRelay({ token: opts.token ?? process.env.WORKHUB_RELAY_TOKEN, autoIssueConfirm, path, log: (m) => server.config.logger.info(m) })
      httpServer = server.httpServer
      if (!httpServer) return
      httpServer.on('upgrade', upgradeHandler)
      server.middlewares.use((req, res, next) => (relay?.handleHttp(req, res) ? undefined : next()))
      server.config.logger.info(`[relay] 已内嵌于 preview server：${path}`)
      server.config.logger.info(`[relay] 接入 token：${relay.token}`)
    },
  }
}

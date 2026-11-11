#!/usr/bin/env node
/**
 * 一体化静态服务 + Relay（Issue #33「整合进项目」的生产形态）。
 *
 * 此前生产要让「站点」和「relay」在服务器上同域可用，需要 Docker + Nginx 反代 + systemd，
 * 或者把 relay 绑公网（破安全红线），并且前端还得单独定制构建期 CSP（`VITE_RELAY_WS`）。
 *
 * 现在：**一个 Node 进程同时托管 `dist/` 静态站点与 relay**，relay 挂同源 `/relay`。
 *   - 同源 → 页面连 `ws(s)://<本站域名>/relay`，不跨域、不需定制 CSP、不受混合内容限制（上 TLS 即是 wss）；
 *   - 一条命令 → `node scripts/serve.mjs`（或 `npm run serve`），没有 Docker/Nginx/第二个进程；
 *   - 部署仍是你现有的方式（把 dist 传上去），只是这个静态服务由项目自带脚本提供。
 *
 * 环境变量：
 *   PORT                    监听端口（默认 9001，对齐现有开发测试环境）
 *   HOST                    监听地址（默认 0.0.0.0；relay 与静态同进程，服务对象就是站点访问者）
 *   WORKHUB_RELAY_TOKEN     接入 token（显式指定则优先；缺省走数据卷文件，见下）
 *   WORKHUB_RELAY_TOKEN_FILE  token 落盘路径（缺省 <dataDir>/relay-token）
 *   WORKHUB_DATA_DIR        数据目录（缺省取 PB_DATA_DIR 的父目录，容器内即 /data）
 *   WORKHUB_RELAY_PATH      relay 挂载路径（默认 /relay）
 *   WORKHUB_RELAY_AUTO_CONFIRM=1  dev 便利：预览自动附票（**勿用于生产**）
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRelay } from '../relay/server.mjs'
import { createSetupService } from './setupRoutes.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = resolve(process.env.WORKHUB_DIST_DIR || join(root, 'dist'))
const port = Number(process.env.PORT || 9001)
const host = process.env.HOST || '0.0.0.0'
const relayPath = process.env.WORKHUB_RELAY_PATH || '/relay'
const autoIssueConfirm = process.env.WORKHUB_RELAY_AUTO_CONFIRM === '1'

if (!existsSync(dist)) {
  process.stderr.write(`[serve] 未找到构建产物 ${dist}，请先执行 npm run build\n`)
  process.exit(1)
}

// ── 服务端执行器（agentOps 服务端化 P2，只读）──
// 显式开启：WORKHUB_SERVER_EXECUTOR=1 且存在 dist-server/server-executor.mjs 且提供 PB 地址。
// 默认关闭（方案 §7.5 拍板：服务端能力默认全关，安全优先）。凭据走 env、不落盘不进日志：
//   WORKHUB_PB_URL       PB 基址（执行器与 PB 同机 → http://127.0.0.1:<pb端口>）；必填
//   WORKHUB_PB_ACCOUNT   users 账号；**可选** —— 集合 listRule 公开（实测测试站公开读）时匿名读即可
//   WORKHUB_PB_PASSWORD  users 密码；可选（与 ACCOUNT 成对）
let serverExecutor = null
if (process.env.WORKHUB_SERVER_EXECUTOR === '1') {
  const serverEntry = join(root, 'dist-server', 'server-executor.mjs')
  const pbUrl = process.env.WORKHUB_PB_URL
  const pbAccount = process.env.WORKHUB_PB_ACCOUNT
  const pbPassword = process.env.WORKHUB_PB_PASSWORD
  if (!existsSync(serverEntry)) {
    process.stderr.write('[serve] ⚠️ WORKHUB_SERVER_EXECUTOR=1 但缺少 dist-server/server-executor.mjs，请先 npm run build:server —— 本次以无服务端执行器模式启动\n')
  } else if (!pbUrl) {
    process.stderr.write('[serve] ⚠️ WORKHUB_SERVER_EXECUTOR=1 但缺少 WORKHUB_PB_URL —— 本次以无服务端执行器模式启动\n')
  } else {
    try {
      const mod = await import(serverEntry)
      // 服务端域白名单（P3）：WORKHUB_AI_DOMAINS=crm,fin,todo,...（逗号分隔，缺省全关）
      const domains = {}
      for (const d of (process.env.WORKHUB_AI_DOMAINS || '').split(',')) {
        const key = d.trim()
        if (key) domains[key] = true
      }
      serverExecutor = mod.initServerExecutor({
        pb: { baseUrl: pbUrl, ...(pbAccount && pbPassword ? { account: pbAccount, password: pbPassword } : {}) },
        domains,
      })
      const enabled = Object.keys(domains)
      process.stderr.write(
        `[serve] 服务端执行器已启用（${pbAccount ? '凭据鉴权' : '匿名读写'}）：白名单域 = ${enabled.length ? enabled.join(',') : '（全关）'}\n`,
      )
    } catch (e) {
      process.stderr.write(`[serve] ⚠️ 服务端执行器初始化失败：${e?.message ?? e} —— 本次以无服务端执行器模式启动\n`)
    }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

// ── 接入 token：运行期解析，**绝不在构建期生成** ──
/**
 * 为什么必须运行期决定（而不是构建镜像时随机一个内置）：
 * 1) 镜像要可复现 —— 同一 commit 构建两次不能得到两个不同 token，否则线上问题无法复现；
 * 2) 重建/回滚不能让已配对的身份失效 —— 2026-10-28 线上事故正是「页面里的 token 与 relay 的不
 *    是同一串」，桥永久停在「连接中…」，Agent 侧只看到 -32001「未连接 relay」，两边都以为是配置错；
 * 3) 所以 token 落**数据卷**（容器重建、镜像升级都不变），环境变量仍可显式覆盖。
 *
 * 优先级：WORKHUB_RELAY_TOKEN > token 文件 > 首次生成并写入（0600）。
 */
const dataDir = process.env.WORKHUB_DATA_DIR || (process.env.PB_DATA_DIR ? dirname(process.env.PB_DATA_DIR) : join(root, '.data'))
const tokenFile = process.env.WORKHUB_RELAY_TOKEN_FILE || join(dataDir, 'relay-token')

function resolveRelayToken() {
  const fromEnv = (process.env.WORKHUB_RELAY_TOKEN || '').trim()
  if (fromEnv) return { token: fromEnv, source: '环境变量 WORKHUB_RELAY_TOKEN' }
  try {
    const saved = readFileSync(tokenFile, 'utf8').trim()
    if (saved) return { token: saved, source: tokenFile }
  } catch {
    /* 首次启动：文件还不存在，走下面的生成分支 */
  }
  const fresh = randomBytes(24).toString('base64url')
  try {
    mkdirSync(dirname(tokenFile), { recursive: true })
    writeFileSync(tokenFile, fresh + '\n', { mode: 0o600 })
    return { token: fresh, source: `${tokenFile}（首次生成）` }
  } catch (e) {
    process.stderr.write(`[serve] ⚠️ token 无法写入 ${tokenFile}：${e?.message ?? e}（重启后 token 会变）\n`)
    return { token: fresh, source: '内存生成（未落盘）' }
  }
}

const { token: relayToken, source: tokenSource } = resolveRelayToken()

/**
 * 页面是否启用登录（2026-10-28）。
 *
 * 判据只有一条：容器里配了管理员账号/密码（`entrypoint.mjs#ensureAppUser` 据此创建账号）。
 * 刻意只回布尔，不回账号名、不需要鉴权 —— 这点信息不构成风险，而**fail-open** 很关键：
 * 配错 env 时如果页面仍强制登录，唯一的管理员会被锁在门外，且没有任何自救入口。
 */
const authEnabled = Boolean((process.env.WORKHUB_ADMIN_USER || '').trim() && process.env.WORKHUB_ADMIN_PASSWORD)

/** 容器内 PocketBase 基址（setup 与登录态校验共用） */
const pbBase = (process.env.WORKHUB_PB_URL || `http://${process.env.PB_HTTP || '127.0.0.1:8090'}`).replace(/\/+$/, '')

/**
 * 「管理员已改过初始密码」标记（2026-10-28）。
 *
 * 为什么需要它：初始密码是 compose 里的默认值 `password`（公开可知），所以必须
 * **强制首改**；改完之后这个标记落盘，页面不再弹改密、也证明初始密码已被弃用。
 * 用文件而不是 PB 字段：users 是 PB 内置集合，加字段要走 schema 变更；
 * 而标记跟着数据卷走、重建容器不丢，语义也够。
 */
const adminMarker = join(dataDir, '.admin-initialized')

/**
 * 首启自助注册（2026-11-01）。
 *
 * 为什么判据是「users 为空」而不是「标记文件不存在」：账号是自己建的还是容器建的，
 * 只看数据本身即可 —— 建出第一个账号后接口自动 409，不存在「忘了关开关」的窗口。
 *
 * 超管凭据从环境变量继承（entrypoint 已注入），**不落盘、不下发页面**。
 * 建号成功顺手写 `.admin-initialized`：用户刚设的密码不是 compose 默认值，
 * 再让页面逼他「首改」纯属自找麻烦。
 */
const setup = createSetupService({
  pbBase,
  superuser: process.env.PB_SUPERUSER || '',
  superuserPassword: process.env.PB_SUPERUSER_PASSWORD || '',
  onUserCreated: () => {
    mkdirSync(dirname(adminMarker), { recursive: true })
    writeFileSync(adminMarker, `${new Date().toISOString()}\n`, { mode: 0o600 })
  },
})

/** 用 PB 校验一个 users 登录态（写首改标记 + 后台页面签发配对码共用） */
async function verifyPbUserToken(pbTokenValue) {
  const res = await fetch(`${pbBase}/api/collections/users/auth-refresh`, {
    method: 'POST',
    headers: { Authorization: pbTokenValue },
  })
  return res.ok
}

/** 从请求头取 Bearer 值（兼容不带 Bearer 前缀的裸值） */
function bearerOf(req) {
  return String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
}

const relay = createRelay({
  token: relayToken,
  autoIssueConfirm,
  path: relayPath,
  serverExecutor,
  issueAgentCredential: async (req, details) => {
    const response=await fetch(process.env.WORKHUB_PB_URL.replace(/\/$/,'')+'/api/workhub/agents', {method:'POST',headers:{'Content-Type':'application/json',Authorization:bearerOf(req)},body:JSON.stringify({action:'issue',name:details.name,capabilities:['activity','crm','project','todo','fin','note','attachment','link','habit','operation','source'].flatMap(d=>[d+':read',d+':write'])}),signal:AbortSignal.timeout(5000)})
    if(!response.ok)throw new Error('credential issuance failed')
    return response.json()
  },
  /**
   * 后台页面在**首次配对前**还没有 relay token，若签码只认 relay token，
   * 「设置页生成配对码」就永远 401（用户实际卡点）。这里放行站点登录态：
   * 页面带 PocketBase users token 调 `/relay/pair/new`，校验通过即可签码；
   * 页面拿到码后自己兑换成 relay token（仍是 relay 下发，不是页面自造）。
   */
  authorizeMint: async (req) => {
    const provided = bearerOf(req)
    if (!provided) return false
    return verifyPbUserToken(provided).catch(() => false)
  },
  log: (m) => process.stderr.write(`${m}\n`),
})

/**
 * Vite 构建产物的资源文件名自带内容 hash（assets/*.hash.js|css），内容变 → 名字变，
 * 可安全长缓存；index.html 与 SPA 回退不带指纹，必须每次协商（ETag）。
 */
const IMMUTABLE_PATTERN = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-zA-Z0-9]+$/
const etagOf = (filePath) => `"${createHash('sha256').update(readFileSync(filePath)).digest('hex')}"`

/** 静态文件：命中即返回，否则回退 index.html（SPA 路由） */
function serveStatic(req, res) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
  } catch {
    res.writeHead(400).end('Bad Request')
    return
  }
  // 目录穿越防护：解析后必须仍在 dist 内
  let filePath = resolve(dist, '.' + pathname)
  if (filePath !== dist && !filePath.startsWith(dist + sep)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (pathname === '/' || (existsSync(filePath) && statSync(filePath).isDirectory())) {
    filePath = join(dist, 'index.html')
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA 回退（仅对非资源型请求）
    if (extname(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found')
      return
    }
    filePath = join(dist, 'index.html')
  }
  const headers = { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' }
  const isImmutable = IMMUTABLE_PATTERN.test(pathname)
  if (isImmutable) {
    // 带内容指纹的资源：长缓存，改版靠换文件名生效
    headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  } else {
    // index.html / 其它：协商缓存，内容没变就 304，不重复回传
    const etag = etagOf(filePath)
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag }).end()
      return
    }
    headers['ETag'] = etag
    headers['Cache-Control'] = 'no-cache'
  }
  res.writeHead(200, headers)
  createReadStream(filePath).pipe(res)
}

const server = createServer((req, res) => {
  // 页面登录开关：前端据此决定是否显示登录页（2026-10-28）。
  // 必须放在 relay 接管之前 —— 否则这个路径会被 SPA 回退成 200 + HTML，前端拿到的是网页。
  //
  // 2026-11-01 补一条判据：`users` 里**已有账号**也算启用。否则自助注册完（没配
  // WORKHUB_ADMIN_* 的部署）页面会因为 enabled:false 直接放行 —— 用户刚设的密码形同虚设。
  // 这次多查一次 PB（本机回环），PB 不可用时仍按未启用处理（fail-open 不变）。
  if (req.url === `${relayPath}/auth-status`) {
    void (async () => {
      let registered = false
      try {
        registered = await setup.hasUsers()
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ enabled: true, error: '认证服务暂时不可用，请重试' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ enabled: process.env.NODE_ENV === 'production' || authEnabled || registered, initialized: existsSync(adminMarker) }))
    })()
    return
  }
  // 首启自助注册：`/setup/status` + `/setup/user`（实现与判据见 scripts/setupRoutes.mjs）。
  // 必须在这里（relay 与静态站之前）：否则会被 SPA 回退成 index.html，前端只拿到网页。
  // 刻意不用 `/api` 前缀 —— 那条路径被 entrypoint 整体转给了 PocketBase。
  if (setup.handleRequest(req, res)) return
  // 首改完成后的回调：写标记，之后不再强制改密。
  // 必须验登录态 —— 否则谁都能把标记写掉，强制首改就成了一句空话。
  if (req.url === `${relayPath}/admin-initialized` && req.method === 'POST') {
    void (async () => {
      const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
      const ok = provided ? await verifyPbUserToken(provided).catch(() => false) : false
      if (!ok) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '需要有效的登录态' }))
        return
      }
      try {
        mkdirSync(dirname(adminMarker), { recursive: true })
        writeFileSync(adminMarker, `${new Date().toISOString()}\n`, { mode: 0o600 })
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: `写入标记失败：${e?.message ?? e}` }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
    })()
    return
  }
  // relay 的 HTTP 传输最后接管：/relay/mcp（远程 Agent 直连）与 /relay/pair*（一次性配对码）。
  // 返回 false 才是静态资源/SPA 回退 —— 顺序不能反，否则这些路径会被 SPA 回退成 index.html
  // （200 + HTML，Agent 侧表现为「握手失败」而不是「端点不存在」，极难排查）。
  if (relay.handleHttp(req, res)) return
  serveStatic(req, res)
})
server.maxConnections = 128
server.headersTimeout = 10_000
server.requestTimeout = 20_000
server.maxRequestsPerSocket = 100
server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head))

server.once('error', (e) => {
  process.stderr.write(`[serve] 启动失败：${e?.message ?? e}\n`)
  process.exit(1)
})

server.listen(port, host, () => {
  process.stderr.write(`[serve] 站点已监听 http://${host}:${port}（静态目录 dist/）\n`)
  process.stderr.write(`[serve] Relay 同源内嵌于 ${relayPath}（无需 Nginx/Docker/额外进程）\n`)
  process.stderr.write(`[serve] 接入 token 来源：${tokenSource}\n`)
  // 启动即签发一枚**引导配对码**（不过期，兑换即作废）—— 这是「页面首次拿到 token」的唯一入口。
  // 为什么要这一步：页面没有 token 就调不了 /pair/new（签码要持 token），会死锁；
  // 而把长期 token 打进日志，等于让任何能看容器日志的人都拿到接入凭据。
  // 引导码一次性、用完即消失，暴露面与打印 token 相当但危害小得多。
  // 不给 5 分钟 TTL：部署完过一会儿再看日志是很正常的，过期就要重启容器，纯属自找麻烦。
  const boot = relay.mintPairCode(0)
  process.stderr.write(`[serve] 首次配对码：${boot.code}（一次性，配对成功后自动作废）\n`)
  process.stderr.write('[serve] 配对方式：打开站点 → 设置 → AI Agent 桥 → 填配对码 → 配对\n')
  process.stderr.write(`[serve] 浏览器侧：「AI Agent 桥」地址留空即用当前站点\n`)
  if (autoIssueConfirm) process.stderr.write('[serve] ⚠️ AUTO_CONFIRM 已开启（勿用于生产）\n')
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    relay.close()
    server.close(() => process.exit(0))
  })
}

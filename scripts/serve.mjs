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
 *   WORKHUB_RELAY_TOKEN     接入 token（强烈建议显式指定；缺省随机生成并打印）
 *   WORKHUB_RELAY_PATH      relay 挂载路径（默认 /relay）
 *   WORKHUB_RELAY_AUTO_CONFIRM=1  dev 便利：预览自动附票（**勿用于生产**）
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRelay } from '../relay/server.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(root, 'dist')
const port = Number(process.env.PORT || 9001)
const host = process.env.HOST || '0.0.0.0'
const relayPath = process.env.WORKHUB_RELAY_PATH || '/relay'
const autoIssueConfirm = process.env.WORKHUB_RELAY_AUTO_CONFIRM === '1'

if (!existsSync(dist)) {
  process.stderr.write(`[serve] 未找到构建产物 ${dist}，请先执行 npm run build\n`)
  process.exit(1)
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

const relay = createRelay({
  token: process.env.WORKHUB_RELAY_TOKEN || undefined,
  autoIssueConfirm,
  path: relayPath,
  log: (m) => process.stderr.write(`${m}\n`),
})

/**
 * Vite 构建产物的资源文件名自带内容 hash（assets/*.hash.js|css），内容变 → 名字变，
 * 可安全长缓存；index.html 与 SPA 回退不带指纹，必须每次协商（ETag）。
 */
const IMMUTABLE_PATTERN = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-zA-Z0-9]+$/
const etagOf = (filePath) => `"${createHash('sha1').update(filePath).update(String(statSync(filePath).size)).digest('hex')}"`

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

const server = createServer((req, res) => serveStatic(req, res))
server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head))

server.once('error', (e) => {
  process.stderr.write(`[serve] 启动失败：${e?.message ?? e}\n`)
  process.exit(1)
})

server.listen(port, host, () => {
  process.stderr.write(`[serve] 站点已监听 http://${host}:${port}（静态目录 dist/）\n`)
  process.stderr.write(`[serve] Relay 同源内嵌于 ${relayPath}（无需 Nginx/Docker/额外进程）\n`)
  process.stderr.write(`[serve] 接入 token：${relay.token}\n`)
  process.stderr.write(`[serve] 浏览器侧：「AI Agent 桥」地址留空即用当前站点\n`)
  if (autoIssueConfirm) process.stderr.write('[serve] ⚠️ AUTO_CONFIRM 已开启（勿用于生产）\n')
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    relay.close()
    server.close(() => process.exit(0))
  })
}

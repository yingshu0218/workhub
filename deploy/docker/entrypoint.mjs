#!/usr/bin/env node
/**
 * 一体化容器入口：PocketBase + 站点/relay + **同源路由**。
 *
 * 为什么要这层：前端用**相对路径**请求 `/api/...`（见 src/sync/pocketbaseAdapter.ts），
 * 所以页面与 PocketBase 必须同源 —— 否则跨域 + 撞 CSP。而 `scripts/serve.mjs` 只托管
 * `dist/` 与 `/relay`，它不代理 `/api`。这里就把三件事收在一个进程里：
 *
 *   ┌ 对外只暴露一个端口（PUBLIC_PORT，默认 80）────────────────────────┐
 *   │  /api 、/api/** 、/_/ 、/_/**   → PocketBase（127.0.0.1:8090）      │
 *   │  其余（含 /relay 与 WebSocket 升级）→ serve.mjs（127.0.0.1:9001）  │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * 进程模型：node(本文件) 为父进程，拉起 2 个子进程（pocketbase、serve.mjs），
 * 收到 SIGTERM/SIGINT 时一起收掉。**只有 2 个业务进程，不需要 nginx 或进程管理器。**
 *
 * 刻意不依赖任何 npm 包：只用 node: 内置模块 + 全局 fetch（node ≥18）。
 *
 * 环境变量：
 *   PUBLIC_PORT            对外端口（默认 80）
 *   PORT / HOST            内部 serve.mjs 的端口/地址（默认 9001 / 127.0.0.1）
 *   PB_HTTP                PocketBase 监听地址（默认 127.0.0.1:8090）
 *   PB_DATA_DIR            PB 数据库目录（默认 /data/pb_data，**应挂卷**）
 *   PB_HOOKS_DIR           PB hooks 目录（默认 /app/pb_hooks，镜像内自带）
 *   PB_MIGRATIONS_DIR      PB 迁移目录（默认 <PB_DATA_DIR>/../pb_migrations，与库同卷）
 *   PB_SUPERUSER           超管邮箱；与下面的密码**同时提供**时，启动前自动 upsert
 *   PB_SUPERUSER_PASSWORD  超管密码（≥8 位）
 *   PB_IMPORT_COLLECTIONS  设为 "1" 时，**仅在库内还没有任何集合**时导入下面这份 schema
 *   PB_COLLECTIONS         collections.json 路径（默认 /app/pb_setup/collections.json）
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── 配置 ────────────────────────────────────────────────────────────────────
// APP_DIR 允许覆盖：镜像里是 /app，本机冒烟测试时可以指到别处（否则只能靠 docker 验）。
const APP_DIR = process.env.APP_DIR || '/app'
const PB_BIN = join(APP_DIR, 'pocketbase')

const PUBLIC_PORT = Number(process.env.PUBLIC_PORT || 80)
const WEB_HOST = '127.0.0.1'
const WEB_PORT = Number(process.env.PORT || 9001)

const PB_HTTP = process.env.PB_HTTP || '127.0.0.1:8090'
const [PB_HOST, PB_PORT_RAW] = PB_HTTP.split(':')
const PB_PORT = Number(PB_PORT_RAW)

const PB_DATA_DIR = process.env.PB_DATA_DIR || '/data/pb_data'
const PB_HOOKS_DIR = process.env.PB_HOOKS_DIR || '/app/pb_hooks'
const PB_MIGRATIONS_DIR = process.env.PB_MIGRATIONS_DIR || join(PB_DATA_DIR, '..', 'pb_migrations')
const PB_SUPERUSER = process.env.PB_SUPERUSER || ''
const PB_SUPERUSER_PASSWORD = process.env.PB_SUPERUSER_PASSWORD || ''
const PB_IMPORT_COLLECTIONS = process.env.PB_IMPORT_COLLECTIONS === '1'
const PB_COLLECTIONS = process.env.PB_COLLECTIONS || '/app/pb_setup/collections.json'

const WEB_TARGET = { host: WEB_HOST, port: WEB_PORT }
const PB_TARGET = { host: PB_HOST, port: PB_PORT }

const log = (m) => process.stderr.write(`[entry] ${m}\n`)
const children = []
let shuttingDown = false

// ── 同源路由判据 ────────────────────────────────────────────────────────────
// 只把 PB 自己的路径给它；其余一律交给 serve.mjs（它会做 SPA 回退）。
// 注意 `/api` 与 `/_` 的**精确匹配**也要覆盖：少了它们会落到静态站，返回 404 让人误以为 PB 没起。
const PB_PATH_PREFIXES = ['/api/', '/_/']
const PB_PATH_EXACT = ['/api', '/_']

function routeToPb(rawUrl) {
  const path = String(rawUrl || '/').split('?')[0]
  return PB_PATH_EXACT.includes(path) || PB_PATH_PREFIXES.some((p) => path.startsWith(p))
}

// ── 子进程 ──────────────────────────────────────────────────────────────────
function startChild(name, cmd, args, env) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], env })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    log(`⚠️ 子进程 ${name} 退出（code=${code} signal=${signal}），容器一并退出`)
    shutdown(code === 0 ? 1 : code ?? 1)
  })
  return child
}

function bootstrapSuperuser() {
  if (!PB_SUPERUSER || !PB_SUPERUSER_PASSWORD) {
    log('未提供 PB_SUPERUSER / PB_SUPERUSER_PASSWORD，跳过超管初始化')
    return
  }
  // 必须在 serve 之前跑：SQLite 同一份库被两个进程同时写不安全
  log(`初始化超管 ${PB_SUPERUSER}（幂等 upsert）`)
  const r = spawnSync(PB_BIN, ['superuser', 'upsert', PB_SUPERUSER, PB_SUPERUSER_PASSWORD, '--dir', PB_DATA_DIR], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (r.status !== 0) throw new Error(`superuser upsert 失败，退出码 ${r.status}`)
}

async function pbToken() {
  const res = await fetch(`http://${PB_HTTP}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: PB_SUPERUSER, password: PB_SUPERUSER_PASSWORD }),
  })
  if (!res.ok) throw new Error(`超管登录失败：HTTP ${res.status} ${await res.text()}`)
  const body = await res.json()
  if (!body?.token) throw new Error('超管登录成功但响应里没有 token')
  return body.token
}

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastErr = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
      lastErr = `HTTP ${res.status}`
    } catch (e) {
      lastErr = e?.message ?? String(e)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内未就绪：${lastErr}`)
}

async function importCollectionsIfFresh() {
  if (!PB_IMPORT_COLLECTIONS) return
  if (!existsSync(PB_COLLECTIONS)) {
    log(`⚠️ 指定了 PB_IMPORT_COLLECTIONS=1，但找不到 ${PB_COLLECTIONS}，跳过`)
    return
  }
  if (!PB_SUPERUSER || !PB_SUPERUSER_PASSWORD) {
    log('⚠️ 导入 collections 需要超管凭据，未提供则跳过')
    return
  }
  const token = await pbToken()
  const headers = { authorization: token }

  const collections = JSON.parse(readFileSync(PB_COLLECTIONS, 'utf8'))
  if (!Array.isArray(collections)) throw new Error('collections.json 顶层应为数组')
  const wanted = collections.map((c) => String(c?.name ?? '')).filter(Boolean)

  const listRes = await fetch(`http://${PB_HTTP}/api/collections?perPage=200`, { headers })
  if (!listRes.ok) throw new Error(`列集合失败：HTTP ${listRes.status}`)
  const listed = await listRes.json()
  const existing = new Set((listed?.items ?? []).map((c) => String(c?.name ?? '')))
  const missing = wanted.filter((n) => !existing.has(n))

  // 空库判据 = **collections.json 里声明的集合一个都不存在**。
  //
  // ⚠️ 不能用「任何不以 `_` 开头的集合」当判据：PocketBase 首次启动会自动建一个
  //    `users` 集合（不以 `_` 开头），那会把**全新空库误判成「已有业务集合」**
  //    从而跳过导入 —— 表现为站点能打开、但一张业务表都没有。
  //    （2026-10-09 正式环境首次部署实测踩到，当时只导入了 PB 自建的 users。）
  if (missing.length === 0) {
    log(`collections.json 里的 ${wanted.length} 个集合均已存在，跳过导入（幂等）`)
    return
  }
  if (missing.length < wanted.length) {
    // 部分存在：**刻意不自动导入** —— import 会按文件定义覆盖已存在集合的字段，
    // 把 UI 上改过的东西重置回去。这种情况应人工确认后手动导入。
    log(`⚠️ 库内已有 ${wanted.length - missing.length} 个集合，缺少 ${missing.length} 个：${missing.join(', ')}`)
    log('⚠️ 为免覆盖 UI 上的改动，不自动导入；确认后请手动调用 PUT /api/collections/import')
    return
  }
  log(`检测到空库（${wanted.length} 个集合均不存在），开始导入…`)
  // deleteMissing:false —— 只增不删。**这个参数不能改**：改成 true 会把线上多出来的
  // 集合（如历史遗留、以及 `users`）一并删掉，属不可逆破坏。
  const res = await fetch(`http://${PB_HTTP}/api/collections/import`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ collections, deleteMissing: false }),
  })
  if (!res.ok) throw new Error(`导入 collections 失败：HTTP ${res.status} ${await res.text()}`)
  log(`✅ 已导入 ${collections.length} 个集合`)
}

// ── 反代 ────────────────────────────────────────────────────────────────────
/**
 * 补齐反代头。
 *
 * ⚠️ 这里必须**先把原始 Host 记进 `X-Forwarded-Host`，再改写 `Host`**（2026-10-28 修）。
 * 原先只改写 `Host`、不补 forwarded 头，导致上游 serve.mjs 里 `req.headers.host` 变成
 * `127.0.0.1:9001` —— relay 拿它拼配对响应里的 `url`，返回
 * `https://127.0.0.1:9001/relay/mcp`，任何照着这个字段配置的 MCP 客户端都必然连不上，
 * 而错误现场看起来完全像「客户端配错」。
 */
function forwardHeaders(req, target) {
  // 外层 nginx 已透传时沿用它的值（多级反代只有最外层知道真实域名）
  const originalHost = req.headers['x-forwarded-host'] || req.headers.host
  const headers = { ...req.headers, host: `${target.host}:${target.port}` }
  if (originalHost) headers['x-forwarded-host'] = originalHost
  const ip = req.socket?.remoteAddress
  if (ip) headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${ip}` : ip
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http'
  return headers
}

function proxyHttp(req, res, target) {
  const up = httpRequest(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers: forwardHeaders(req, target) },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers)
      upRes.pipe(res)
    }
  )
  up.on('error', (e) => {
    log(`⚠️ 转发失败 ${req.method} ${req.url} → ${target.host}:${target.port}：${e.message}`)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`502 Bad Gateway：上游 ${target.host}:${target.port} 不可达\n`)
  })
  req.pipe(up)
}

function proxyUpgrade(req, socket, head, target) {
  const up = httpRequest({
    host: target.host,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: forwardHeaders(req, target),
  })
  up.on('upgrade', (upRes, upSocket, upHead) => {
    const lines = Object.entries(upRes.headers).flatMap(([k, v]) =>
      Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]
    )
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' + lines.map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n')
    if (upHead?.length) socket.unshift(upHead)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
    const kill = () => {
      upSocket.destroy()
      socket.destroy()
    }
    upSocket.on('error', kill)
    upSocket.on('close', kill)
    socket.on('error', kill)
    socket.on('close', () => upSocket.destroy())
  })
  up.on('error', (e) => {
    log(`⚠️ WebSocket 转发失败 ${req.url} → ${target.host}:${target.port}：${e.message}`)
    socket.destroy()
  })
  if (head?.length) up.write(head)
  up.end()
}

// ── 收尾 ────────────────────────────────────────────────────────────────────
function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  log('正在停止子进程…')
  for (const c of children) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* 已退出 */
    }
  }
  setTimeout(() => {
    for (const c of children) {
      try {
        c.kill('SIGKILL')
      } catch {
        /* 已退出 */
      }
    }
    process.exit(code)
  }, 5000).unref()
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(PB_BIN)) throw new Error(`找不到 PocketBase 二进制：${PB_BIN}`)
  if (!existsSync(join(APP_DIR, 'dist', 'index.html'))) throw new Error('找不到前端产物 /app/dist/index.html')

  mkdirSync(PB_DATA_DIR, { recursive: true })
  mkdirSync(PB_MIGRATIONS_DIR, { recursive: true })

  bootstrapSuperuser()

  log(`启动 PocketBase：${PB_HTTP}（数据 ${PB_DATA_DIR}）`)
  startChild('pocketbase', PB_BIN, [
    'serve',
    `--http=${PB_HTTP}`,
    `--dir=${PB_DATA_DIR}`,
    `--hooksDir=${PB_HOOKS_DIR}`,
    `--migrationsDir=${PB_MIGRATIONS_DIR}`,
  ], process.env)

  log(`启动站点 + relay：${WEB_HOST}:${WEB_PORT}`)
  startChild('serve', process.execPath, [join(APP_DIR, 'scripts', 'serve.mjs')], {
    ...process.env,
    HOST: WEB_HOST,
    PORT: String(WEB_PORT),
  })

  await waitFor(`http://${PB_HTTP}/api/health`, 60_000, 'PocketBase')
  log('PocketBase 已就绪')
  await waitFor(`http://${WEB_HOST}:${WEB_PORT}/`, 30_000, '站点')
  log('站点已就绪')

  await importCollectionsIfFresh()

  const server = createServer((req, res) => {
    proxyHttp(req, res, routeToPb(req.url) ? PB_TARGET : WEB_TARGET)
  })
  server.on('upgrade', (req, socket, head) => {
    proxyUpgrade(req, socket, head, routeToPb(req.url) ? PB_TARGET : WEB_TARGET)
  })
  server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    log(`对外监听 0.0.0.0:${PUBLIC_PORT}`)
    log(`  /api 、/_/            → ${PB_TARGET.host}:${PB_TARGET.port}（PocketBase，管理台在 /_/）`)
    log(`  其余（含 /relay、WS） → ${WEB_TARGET.host}:${WEB_TARGET.port}（静态站 + relay）`)
  })

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      server.close()
      shutdown(0)
    })
  }
}

main().catch((e) => {
  log(`❌ 启动失败：${e?.stack ?? e}`)
  shutdown(1)
})

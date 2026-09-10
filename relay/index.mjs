#!/usr/bin/env node
/**
 * 本地 Relay 入口 —— 方案 §9.6 / §10.1（P1 第 4 步）
 *
 * 拓扑（反向连接）：浏览器主动连出 relay（浏览器无 listen 能力，§9.1）；
 * Agent 以标准 MCP 接入 relay（stdio 或 WS），二者在 relay 上配对。
 * relay 只转发「工具调用请求/结果」，不持有数据、不 import repositories。
 *
 * 用法：
 *   node relay/index.mjs                      # 启动 WS（127.0.0.1:8787），浏览器连出
 *   node relay/index.mjs --stdio              # 额外开启 stdio MCP 入口（供本地 CLI Agent）
 *   WORKHUB_RELAY_PORT=9000 node relay/index.mjs
 *   WORKHUB_RELAY_TOKEN=xxx node relay/index.mjs   # 固定 token（缺省随机生成并打印）
 */
import { createWsServer } from './ws-server.mjs'
import { createMcpRouter, generateToken, MCP_PROTOCOL_VERSION } from './mcp-relay.mjs'

const DEFAULT_PORT = 8787
const HOST = '127.0.0.1' // §四.1：只绑本机，不暴露局域网

const args = process.argv.slice(2)
const wantStdio = args.includes('--stdio')
const port = Number(process.env.WORKHUB_RELAY_PORT || DEFAULT_PORT)
const token = process.env.WORKHUB_RELAY_TOKEN || generateToken()
const log = (m) => process.stderr.write(`${m}\n`)

/** 当前已连出的浏览器连接（首版单浏览器配对；多标签页取最近一条） */
let browserConn = null
/** 浏览器回包等待表：requestId -> resolve */
const pending = new Map()
let seq = 0

/** 浏览器不在线 → 明确失败（§三：应用在线才能操作，离线无权威数据） */
function assertBrowser() {
  if (!browserConn) throw new Error('寻鸽工作台未连接 relay（请确保应用已打开且已启用 AI 桥）')
}

/** 唤醒浏览器：下发工具调用请求并等待回包 */
function requestFromBrowser(payload) {
  assertBrowser()
  const requestId = `r${++seq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('浏览器响应超时（15s）'))
    }, 15_000)
    pending.set(requestId, { resolve, reject, timer })
    browserConn.send(JSON.stringify({ type: 'agentops:call', requestId, ...payload }))
  })
}

const router = createMcpRouter({
  token,
  // tools/list 由浏览器回传（白名单关闭的域不出现；relay 不认识具体工具）
  listTools: () => requestFromBrowser({ kind: 'tools/list' }).then((r) => r.tools ?? []),
  callTool: (name, toolArgs, meta) =>
    requestFromBrowser({ kind: 'tools/call', name, args: toolArgs, meta: { confirmToken: meta?.confirmToken } }),
  log,
})

/** 处理浏览器回包 */
function onBrowserMessage(raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  if (msg?.type === 'agentops:result' && msg.requestId) {
    const p = pending.get(msg.requestId)
    if (!p) return
    pending.delete(msg.requestId)
    clearTimeout(p.timer)
    if (msg.ok) p.resolve(msg.data ?? {})
    else p.reject(new Error(msg.error ?? '浏览器执行失败'))
  }
}

async function startWs() {
  const ws = await createWsServer({ port, host: HOST })
  log(`[relay] WebSocket 已监听 ws://${HOST}:${ws.port}`)
  log(`[relay] 接入 token：${token}`)
  log(`[relay] 浏览器侧：启用「AI 桥」并填入上述地址与 token`)

  ws.server.on('ws-connection', (conn, req) => {
    // 仅接受浏览器角色的连出（带 query ?role=browser&token=...）
    const url = new URL(req.url ?? '/', `http://${HOST}`)
    const role = url.searchParams.get('role')
    const provided = url.searchParams.get('token')
    if (role !== 'browser') {
      log('[relay] 拒绝非浏览器角色的 WS 连接（Agent 请走 MCP stdio / WS 端点）')
      conn.close()
      return
    }
    if (!router.token || provided !== token) {
      log('[relay] 浏览器 WS 连接 token 无效，已拒绝')
      conn.close()
      return
    }
    browserConn = conn
    log('[relay] 浏览器已连出，桥就绪')
    conn.on('message', onBrowserMessage)
    conn.on('close', () => {
      if (browserConn === conn) {
        browserConn = null
        log('[relay] 浏览器已断开，桥离线')
      }
    })
  })

  return ws
}

/** stdio MCP 入口：逐行 JSON-RPC（MCP over stdio，§10.1） */
function startStdio() {
  let buf = ''
  const ctx = { authed: false }
  log('[relay] stdio MCP 入口已开启')
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
        continue
      }
      const out = await router.handle(msg, ctx)
      if (out) process.stdout.write(JSON.stringify(out) + '\n')
    }
  })
}

async function main() {
  await startWs()
  if (wantStdio) startStdio()
  log(`[relay] MCP 协议版本：${MCP_PROTOCOL_VERSION}（标准 tools/list + tools/call）`)
}

main().catch((e) => {
  log(`[relay] 启动失败：${e?.message ?? e}`)
  process.exit(1)
})

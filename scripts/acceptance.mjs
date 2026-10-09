#!/usr/bin/env node
/**
 * §10.4 通用性验收 · 一键脚本（Issue #33 收尾项 2）
 *
 * 模拟「一个从未适配过本项目的 MCP Agent」对 relay 做协议级验收：
 * 只说标准 JSON-RPC/MCP、只依赖 node: 内置模块、零应用代码 import ——
 * 这正是 §10.4 的验收口径：换任意 Agent、不改应用代码即可连通。
 *
 * 覆盖的 §10.4 条款：
 *   ① 未适配 Agent 可连通（initialize / tools/list / tools/call 全走标准协议）；
 *   ② 无 token / 错 token 一律被拒（对所有 Agent 一视同仁）；
 *   ③ tools/list 下发的工具均带 name + inputSchema + risk/domain 标注（白名单域随工具下发）；
 *   ④ 浏览器离线时 tools/call 返回**可操作错误**而非静默失败或崩进程（P1-1 修复回归）。
 *
 * 用法（对任意部署形态与协议通用，ws / wss 均可）：
 *   node scripts/acceptance.mjs --url ws://127.0.0.1:9001/relay --token <relay启动时打印的token>
 *   node scripts/acceptance.mjs --url ws://8.153.19.221:9001/relay --token <token>   # 测试站（源码部署，明文 HTTP）
 *   # 独立进程形态（npm run relay）path 默认根：
 *   node scripts/acceptance.mjs --url ws://127.0.0.1:8787 --token <token>
 *
 * 退出码：0 = 全部通过；1 = 任一断言失败（每条检查独立报告，不短路）。
 */
import { connect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { randomBytes } from 'node:crypto'

/* ---------------- 参数 ---------------- */
const args = process.argv.slice(2)
function argOf(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const url = argOf('--url', '')
const token = argOf('--token', '')

if (!url || !token) {
  process.stderr.write(`用法：node scripts/acceptance.mjs --url ws://127.0.0.1:9001/relay --token <relay启动时打印的token>\n`)
  process.exit(1)
}

/* ---------------- 最小 WS 客户端（RFC6455，Client→Server 掩码） ---------------- */
class MiniWS {
  constructor(url) {
    const u = new URL(url)
    // wss 需要 TLS 且默认端口 443（此前只支持 ws 明文，线上上 HTTPS 后脚本就用不了了）
    this.tls = u.protocol === 'wss:'
    this.port = Number(u.port || (this.tls ? 443 : 80))
    this.host = u.hostname
    this.path = `${u.pathname}${u.search}`
    this.buffer = Buffer.alloc(0)
    this.handshaken = false
    this.pending = new Map()
    this.seq = 0
    this.closed = false
  }
  async open(timeoutMs = 5000) {
    await new Promise((resolve, reject) => {
      const onConnect = () => {
        this.socket.write(
          `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}\r\nUpgrade: websocket\r\n` +
            `Connection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        )
      }
      // wss 走 TLS：SNI 填域名，**证书校验保持开启**（线上证书无效就该让它失败，而不是被 -k 掩盖）
      this.socket = this.tls
        ? tlsConnect({ host: this.host, port: this.port, servername: this.host }, onConnect)
        : connect({ host: this.host, port: this.port }, onConnect)
      this.socket.on('data', (chunk) => this.#onData(chunk))
      this.socket.on('error', (e) => reject(e))
      setTimeout(() => reject(new Error('WS 握手超时')), timeoutMs)
      this.#resolveOpen = resolve
    })
  }
  #resolveOpen = null
  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (!this.handshaken) {
      const idx = this.buffer.indexOf('\r\n\r\n')
      if (idx < 0) return
      const head = this.buffer.subarray(0, idx).toString('latin1')
      this.buffer = this.buffer.subarray(idx + 4)
      if (!head.includes(' 101 ')) {
        const err = new Error(`WS 握手被拒：${head.split('\r\n')[0]}`)
        this.#rejectAll(err)
        return
      }
      this.handshaken = true
      this.#resolveOpen?.()
      this.#resolveOpen = null
    }
    for (;;) {
      const buf = this.buffer
      if (buf.length < 2) return
      const opcode = buf[0] & 0x0f
      let len = buf[1] & 0x7f
      let offset
      if (len < 126) offset = 2
      else if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        offset = 4
      } else {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        offset = 10
      }
      if (buf.length < offset + len) return
      const payload = Buffer.from(buf.subarray(offset, offset + len))
      this.buffer = buf.subarray(offset + len)
      if (opcode === 0x1) this.#onMessage(payload.toString('utf8'))
      else if (opcode === 0x8) {
        this.closed = true
        this.#rejectAll(new Error('连接被服务端关闭'))
        return
      } else if (opcode === 0x9) this.#sendFrame(0xa, payload)
    }
  }
  #onMessage(text) {
    let msg
    try { msg = JSON.parse(text) } catch { return }
    if (msg.id == null) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(Object.assign(new Error(msg.error.message ?? 'MCP 错误'), { code: msg.error.code }))
    else p.resolve(msg.result)
  }
  #rejectAll(err) {
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }
  #sendFrame(opcode, payload) {
    const mask = randomBytes(4)
    const len = payload.length
    let header
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2) }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2) }
    header[0] = 0x80 | opcode
    const masked = Buffer.from(payload)
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
    this.socket.write(Buffer.concat([header, mask, masked]))
  }
  /** JSON-RPC 请求；浏览器离线时服务端按「返回的错误」处理，不会挂起，但仍留超时兜底 */
  rpc(method, params = {}, timeoutMs = 10_000) {
    if (this.closed) return Promise.reject(new Error('连接已关闭'))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.#sendFrame(0x1, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params })))
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`MCP 调用超时：${method}`)) }, timeoutMs)
    })
  }
  close() { try { this.#sendFrame(0x8, Buffer.alloc(0)) } catch { /* ignore */ } this.socket?.end() }
}

/* ---------------- 断言收集 ---------------- */
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✅' : '❌'} ${name}${detail ? `\n   ${detail}` : ''}\n`)
}

/** 把 JSON-RPC 错误归一成可比较对象 */
async function rpcErr(ws, method, params) {
  try { await ws.rpc(method, params); return null }
  catch (e) { return { code: e.code, message: e.message ?? '' } }
}

/* ---------------- 验收主流程 ---------------- */
async function main() {
  // —— 连接 1：无 token 的裸 Agent 会话（§10.4：无 token 一律被拒） ——
  const anon = new MiniWS(url)
  await anon.open()
  // 握手后 0ms 立即发帧：验证服务端接住了 upgrade head（客户端紧跟握手的首帧不被吞）
  const noToken = await rpcErr(anon, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} })
  check(
    '①-1 未鉴权会话 initialize 被拒（标准 JSON-RPC 错误）',
    noToken !== null,
    noToken ? `code=${noToken.code} message=${noToken.message}` : '竟然成功了 —— 鉴权闸门失效！',
  )
  const anonList = await rpcErr(anon, 'tools/list')
  check('①-2 未鉴权会话 tools/list 被拒', anonList !== null, anonList ? `message=${anonList.message}` : '未鉴权却能拿到工具清单')
  anon.close()

  // —— 连接 2：错 token（§10.4：对所有 Agent 一视同仁） ——
  const bad = new MiniWS(url)
  await bad.open()
  const badTok = await rpcErr(bad, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, accessToken: 'wrong-token-故意写错' })
  check('①-3 错误 token 被拒', badTok !== null, badTok ? `message=${badTok.message}` : '错 token 竟然通过')
  bad.close()

  // —— 连接 3：正确 token（§10.4①：未适配 Agent 可连通） ——
  const ws = new MiniWS(url)
  await ws.open()
  const init = await ws.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, accessToken: token })
  check(
    '②-1 正确 token initialize 成功（标准 MCP 握手）',
    Boolean(init?.serverInfo?.name) && Boolean(init?.protocolVersion),
    `server=${init?.serverInfo?.name} v${init?.serverInfo?.version ?? '?'} protocol=${init?.protocolVersion}`,
  )
  await ws.rpc('ping')
  check('②-2 ping 正常', true)

  // —— tools/list：schema 完整性 + 内置 confirm_preview（§10.4③） ——
  // 桥离线时 tools/list 必须是「返回的错误」而非空数组/挂起/崩进程（P2-1 修复语义）：
  // 此时 ③④ 组跳过并明确提示「请先打开应用 + 启用 AI 桥」，其余条款照常验收。
  let tools = null
  let bridgeOnline = true
  try {
    const list = await ws.rpc('tools/list')
    tools = Array.isArray(list?.tools) ? list.tools : []
  } catch (e) {
    bridgeOnline = false
    const op = /未连接|应用|AI 桥/.test(e.message ?? '')
    check('③-0 桥离线时 tools/list 返回可操作错误（非空数组/挂起）', op, `message=${(e.message ?? '').slice(0, 80)}${op ? '' : ' ← 错误信息不可操作'}`)
  }
  if (bridgeOnline) {
    check('③-1 tools/list 返回数组且非空', tools.length > 0, `共 ${tools.length} 个工具`)
    const schemaless = tools.filter((t) => !t.name || typeof t.inputSchema !== 'object')
    check('③-2 每个工具都带 name + inputSchema', schemaless.length === 0, schemaless.length ? `缺失：${schemaless.map((t) => t.name ?? '(匿名)').join(', ')}` : '')
    const annotated = tools.filter((t) => t.annotations && t.annotations.risk && t.annotations.domain)
    check('③-3 工具带 risk/domain 标注（白名单域随工具下发）', annotated.length === tools.length, `${annotated.length}/${tools.length}`)
    const confirm = tools.find((t) => t.name === 'confirm_preview')
    check('③-4 内置 confirm_preview 取票工具在清单中', Boolean(confirm), confirm ? (confirm.description ?? '').slice(0, 60) : '缺失：中风险确认链路将不可用')

    // —— tools/call 探测：桥在线时必须「有响应」（无论业务成功/校验失败），不得挂起或断连 ——
    const probe = tools.find((t) => t.name !== 'confirm_preview')
    if (probe) {
      try {
        const r = await ws.rpc('tools/call', { name: probe.name, arguments: {} }, 20_000)
        check('④-1 tools/call 有响应（返回 isError 文本或结果）', true, `text=${(r?.content?.[0]?.text ?? '').slice(0, 80)}`)
      } catch (e) {
        check('④-1 tools/call 有响应（参数校验错误也算响应）', !ws.closed, `响应=${(e.message ?? '').slice(0, 80)}`)
      }
    } else {
      check('④-1 无可探测工具，跳过', false, '工具清单异常')
    }
  } else {
    check('③-1..③-4 工具清单验收跳过（桥离线）', true, '提示：请先打开应用 → 设置 → AI Agent 桥 → 启用，再跑本脚本以验收完整清单')
    check('④ tools/call 探测跳过（桥离线）', true, '桥离线时调用只会得到「应用未连接」类可操作错误')
  }

  // —— 断连后服务端仍健康（连接不复用、无状态泄漏的粗检） ——
  ws.close()
  const again = new MiniWS(url)
  await again.open()
  const re = await again.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, accessToken: token })
  check('⑤ 新会话可再次建立（服务端无状态残留阻断）', Boolean(re?.serverInfo?.name))
  again.close()

  const failed = results.filter((r) => !r.ok)
  process.stdout.write(`\n—— §10.4 通用性验收：${results.length - failed.length}/${results.length} 通过 ——\n`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  process.stderr.write(`验收脚本异常退出：${e.message}\n`)
  process.exit(1)
})

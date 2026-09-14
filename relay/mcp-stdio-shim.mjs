#!/usr/bin/env node
/**
 * MCP stdio ⇄ relay WebSocket 桥（shim） —— 「一条命令接入任意 Agent」的传输适配层
 *
 * ## 为什么必须有这一层
 *
 * relay 的 Agent 端点是**裸 WebSocket**（`ws(s)://<站点>/relay`，见 relay/server.mjs 的
 * `?role=` 分流）。而主流 Agent 工具的 MCP 客户端只实现两种**标准**传输：
 *   - stdio（`command` + `args`）—— Codex / Hermes / opencode / WorkBuddy 全支持；
 *   - Streamable HTTP（`url`）—— 部分支持。
 * **没有一家支持裸 WebSocket。** 所以「把 wss:// 地址写进 Agent 配置」这条路物理上走不通：
 * 客户端会按 Streamable HTTP 发 POST，relay 只认 Upgrade 握手，直接 426。
 *
 * 本 shim 补齐这段：对 Agent 讲**标准 MCP over stdio**（换行分隔 JSON-RPC，MCP 官方 stdio 传输），
 * 对 relay 用 WS 连出，消息原样双向转发。
 *
 *   Agent ──stdio(换行 JSON-RPC)──► shim ──WS(ws/wss)──► relay ──► 浏览器 agentOps
 *
 * ## 边界（与 relay 一致，零放宽）
 *
 * - **只转发**：不解析工具语义、不缓存业务数据、不 import 任何应用代码；
 * - **零新增依赖**：自实现最小 RFC6455 客户端（node:net / node:tls / node:crypto），
 *   与 relay 服务端、acceptance.mjs 同一口径（方案 §A1 零服务端依赖）；
 * - **stdout 只走协议**：所有日志一律 stderr —— stdout 被任何非 JSON 字节污染，
 *   上层 Agent 会直接判定「MCP 服务器协议错误」；
 * - **不冒充鉴权**：token 只作为 `initialize` 的 `accessToken` 原样透传，校验仍在 relay。
 *
 * ## 凭据来源（优先级从高到低）
 *
 * 1. 命令行 `--url` / `--token`
 * 2. 环境变量 `WORKHUB_RELAY_URL` / `WORKHUB_RELAY_TOKEN`
 * 3. `~/.workhub/relay.json` → `{ "url": "...", "token": "..." }`（由 `npm run agent:setup` 写入）
 *
 * **刻意不在代码里写死默认地址**：本项目处于开发/测试阶段，站点地址与 token 都会变，
 * 写死等于给所有人埋一个「指向临时环境」的隐性依赖。缺地址就报可操作错误。
 *
 * ## 用法
 *
 *   node relay/mcp-stdio-shim.mjs                       # 供 Agent 以 stdio 拉起（MCP 服务器）
 *   node relay/mcp-stdio-shim.mjs --verify              # 连通性自检：连 relay、列工具、打印到 stderr
 *   node relay/mcp-stdio-shim.mjs --url ws://127.0.0.1:9001/relay --token xxx
 *   WORKHUB_RELAY_DEBUG=1 node relay/mcp-stdio-shim.mjs # 打印往来报文（排查用）
 */
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 凭据文件位置（由 scripts/agent-setup.mjs 写入；token 集中一处，轮换只改这里） */
export const CRED_FILE =
  process.env.WORKHUB_RELAY_CRED_FILE || path.join(homedir(), '.workhub', 'relay.json')
/** 协议版本：与 relay 一致 */
const PROTOCOL_VERSION = '2024-11-05'
/** 排队上限：超出即拒绝，避免 Agent 侧异常时把内存吃满 */
const MAX_QUEUE = 100

const log = (m) => process.stderr.write(`[shim] ${m}\n`)

/* ---------------------------- 最小 RFC6455 客户端 ---------------------------- */
/**
 * 只服务文本帧 + ping/pong + close 的最小 WebSocket **客户端**（Client→Server 必须掩码）。
 * 与 relay/ws-server.mjs 的服务端实现对称；wss 走 TLS 且**保持证书校验**
 * （线上证书无效就该让它失败，而不是被静默降级成明文信任）。
 */
export class MiniWsClient {
  constructor(url) {
    const u = new URL(url)
    this.url = url
    this.tls = u.protocol === 'wss:'
    this.port = Number(u.port || (this.tls ? 443 : 80))
    this.host = u.hostname
    this.path = `${u.pathname}${u.search}`
    this.buffer = Buffer.alloc(0)
    this.handshaken = false
    this.closed = false
    /** @type {null | (() => void)} */ this.onopen = null
    /** @type {null | ((text: string) => void)} */ this.onmessage = null
    /** @type {null | ((err: Error) => void)} */ this.onerror = null
    /** @type {null | (() => void)} */ this.onclose = null
  }

  open(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (e) => {
        if (settled) return
        settled = true
        this.#openReject = null
        reject(e)
      }
      const timer = setTimeout(() => fail(new Error(`relay 握手超时（${this.url}）`)), timeoutMs)
      const onConnect = () => {
        this.socket.write(
          `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}\r\nUpgrade: websocket\r\n` +
            `Connection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        )
      }
      this.socket = this.tls
        ? tlsConnect({ host: this.host, port: this.port, servername: this.host }, onConnect)
        : netConnect({ host: this.host, port: this.port }, onConnect)
      this.socket.on('data', (chunk) => this.#onData(chunk))
      this.socket.on('error', (e) => {
        clearTimeout(timer)
        this.onerror?.(e)
        fail(e)
      })
      this.socket.on('close', () => {
        this.closed = true
        this.onclose?.()
      })
      this.#openReject = (e) => {
        clearTimeout(timer)
        fail(e)
      }
      this.#resolveOpen = () => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        this.#openReject = null
        resolve()
      }
    })
  }
  /** @type {null | (() => void)} */
  #resolveOpen = null
  /** @type {null | ((e: Error) => void)} */
  #openReject = null

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (!this.handshaken) {
      const idx = this.buffer.indexOf('\r\n\r\n')
      if (idx < 0) return
      const head = this.buffer.subarray(0, idx).toString('latin1')
      this.buffer = this.buffer.subarray(idx + 4)
      if (!head.includes(' 101 ')) {
        // 握手被拒要**立即失败**：这里几乎总是「URL 路径不对」或「对面不是 relay」，
        // 若只是 destroy 掉 socket 让调用方等到超时，报出来的是「超时」，
        // 而真因是 404 —— 误导性错误会把排查引到网络层，实际要改的是配置里的路径。
        const msg = `WebSocket 握手被拒：${head.split('\r\n')[0]}（${this.url}——检查路径是否为 relay 挂载点：独立进程形态是 /，内嵌形态是 /relay）`
        this.closed = true
        const err = new Error(msg)
        // 标记成「不可重试的配置错误」：重试改变不了 URL 写错这件事，
        // 让上层直接失败并如实转述，而不是退避三次后给一个含糊的「不可达」
        err.code = 'HANDSHAKE_REJECTED'
        this.onerror?.(err)
        this.#openReject?.(err)
        this.socket.destroy()
        return
      }
      this.handshaken = true
      this.#resolveOpen?.()
      this.#resolveOpen = null
      this.onopen?.()
    }
    // 服务端帧不带掩码；长度字段宽度决定掩码/载荷偏移（顺序不能错，否则长帧错位）
    for (;;) {
      const buf = this.buffer
      if (buf.length < 2) return
      const opcode = buf[0] & 0x0f
      const masked = (buf[1] & 0x80) === 0x80
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
      let mask = null
      if (masked) {
        if (buf.length < offset + 4) return
        mask = buf.subarray(offset, offset + 4)
        offset += 4
      }
      if (buf.length < offset + len) return
      const payload = Buffer.from(buf.subarray(offset, offset + len))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
      this.buffer = buf.subarray(offset + len)
      if (opcode === 0x1) this.onmessage?.(payload.toString('utf8'))
      else if (opcode === 0x8) {
        this.closed = true
        this.socket.end()
        this.onclose?.()
        return
      } else if (opcode === 0x9) this.#sendFrame(0xa, payload)
    }
  }

  #sendFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return
    const mask = randomBytes(4)
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.alloc(2)
      header[1] = 0x80 | len
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    header[0] = 0x80 | opcode
    const masked = Buffer.from(payload)
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
    this.socket.write(Buffer.concat([header, mask, masked]))
  }

  sendText(text) {
    this.#sendFrame(0x1, Buffer.from(text, 'utf8'))
  }

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.#sendFrame(0x8, Buffer.alloc(0))
    } catch {
      /* 尽力而为 */
    }
    this.socket?.end()
  }

  /** 立即销毁底层 socket（握手失败/连接报错时用，避免句柄泄漏） */
  destroy() {
    this.closed = true
    this.socket?.destroy()
  }
}

/* ------------------------------ 凭据解析 ------------------------------ */

/**
 * 解析 relay 接入信息。**不提供默认地址**（见文件头说明）。
 * @param {{url?:string, token?:string}} cli 命令行覆盖项
 * @returns {{url:string, token:string}}
 */
export function resolveRelayCredential(cli = {}) {
  let fromFile = {}
  try {
    fromFile = JSON.parse(readFileSync(CRED_FILE, 'utf8'))
  } catch {
    // 文件不存在 / 不是 JSON：都按「没配过」处理，不炸
  }
  const url = cli.url || process.env.WORKHUB_RELAY_URL || fromFile.url || ''
  const token = cli.token || process.env.WORKHUB_RELAY_TOKEN || fromFile.token || ''
  if (!url) {
    const reason =
      `未找到 relay 地址。请先运行 \`npm run agent:setup\` 写入凭据文件 ${CRED_FILE}，` +
      '或用 --url / WORKHUB_RELAY_URL 显式指定（注意：本项目不设默认地址，站点地址会随环境变化）'
    const err = new Error(reason)
    err.code = 'NO_RELAY_URL'
    throw err
  }
  if (!token) {
    const reason = `未找到 relay token（${CRED_FILE} 里没有 token，环境变量也未提供）—— token 由 relay 启动时生成/指定，见 \`npm run dev\` 控制台输出`
    const err = new Error(reason)
    err.code = 'NO_RELAY_TOKEN'
    throw err
  }
  return { url, token }
}

/* ------------------------------ stdio ⇄ WS 桥 ------------------------------ */

/**
 * 建立 stdio ⇄ relay 的双向桥。
 *
 * 断线策略：stdin 来的报文先入队，WS 就绪后按序 flush；重连退避（250ms → 5s）。
 * 退避超过阈值且队列非空时，**把队列里的请求逐条回以可操作 JSON-RPC 错误**，
 * 而不是让它们无声挂起 —— 「挂起」会让上层 Agent 以为是自己的问题而反复重试
 * （与 relay 侧「桥离线必须回可操作错误」同一纪律，见 mcp-relay.mjs 的 tools/list 分支）。
 * 通知类报文（无 id）失败时不回错误，直接丢弃。
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.token
 * @param {NodeJS.ReadStream} [opts.input]
 * @param {NodeJS.WriteStream} [opts.output]
 * @returns {{ close: () => void, queueLength: () => number }}
 */
export function createStdioBridge({ url, token, input = process.stdin, output = process.stdout }) {
  /** @type {string[]} 已收到但尚未送达 relay 的原始报文 */
  const queue = []
  let ws = null
  let connecting = false
  let attempt = 0
  /** 退避累计超过该值即把队列转成错误回给上层（避免无限静默排队） */
  const GIVE_UP_AFTER = 3
  let shuttingDown = false

  const writeOut = (obj) => output.write(`${JSON.stringify(obj)}\n`)

  function relayUnreachableError(raw, reason) {
    let id = null
    try {
      id = JSON.parse(raw)?.id ?? null
    } catch {
      id = null
    }
    if (id === null) return // 通知类：无可回之处
    writeOut({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32001,
        message:
          reason ??
          `relay 不可达：${url}。请确认①站点/relay 已启动 ②凭据文件 ${CRED_FILE} 的 url 与 token 与 relay 实际一致` +
            '（token 轮换后必须同步更新）③反向代理放行了 WebSocket Upgrade。',
      },
    })
  }

  /**
   * 把排队的请求逐条回以错误。
   * @param {string} logLine 给**人看**的短标签（进 stderr）
   * @param {string} [errorMessage] 回给**Agent** 的完整文案；缺省用通用的可操作提示
   */
  function failQueue(logLine, errorMessage) {
    if (!queue.length) return
    log(`${logLine}，将 ${queue.length} 条排队请求以错误返回（不静默挂起）`)
    for (const raw of queue) relayUnreachableError(raw, errorMessage)
    queue.length = 0
  }

  function scheduleReconnect() {
    if (shuttingDown || connecting) return
    attempt += 1
    if (attempt > GIVE_UP_AFTER) failQueue(`relay 连续 ${attempt - 1} 次连接失败`)
    const delay = Math.min(250 * 2 ** (attempt - 1), 5000)
    setTimeout(connect, delay)
  }

  async function connect() {
    if (shuttingDown || connecting || (ws && !ws.closed)) return
    connecting = true
    /** @type {MiniWsClient | null} */
    let client = null
    try {
      client = new MiniWsClient(url)
      client.onmessage = (text) => {
        if (process.env.WORKHUB_RELAY_DEBUG) log(`← ${text.slice(0, 200)}`)
        output.write(`${text}\n`)
      }
      client.onerror = (e) => log(`连接错误：${e?.message ?? e}`)
      client.onclose = () => {
        if (shuttingDown) return
        log('relay 连接已断开，尝试重连')
        ws = null
        scheduleReconnect()
      }
      await client.open()
      ws = client
      attempt = 0
      connecting = false
      log(`已连上 relay：${url}`)
      // flush：把等待期间的请求按序送达（Agent 常在启动瞬间就发 initialize）
      while (queue.length) {
        const raw = queue.shift()
        if (process.env.WORKHUB_RELAY_DEBUG) log(`→ ${raw.slice(0, 200)}`)
        client.sendText(raw)
      }
    } catch (e) {
      connecting = false
      ws = null
      log(`连接失败：${e?.message ?? e}`)
      // 握手被拒 = 地址/路径写错，重试一百次也一样：立即把队列转成**如实**的错误，
      // 而不是退避三轮后给一个含糊的「不可达」（那样只会把排查引到网络层）
      if (e?.code === 'HANDSHAKE_REJECTED') {
        failQueue('relay 握手被拒（配置问题，不重试）', e.message)
      }
      // 握手失败时底层 socket 可能仍是半开状态：显式销毁，避免重连把句柄越堆越多
      try {
        client?.destroy()
      } catch {
        /* 忽略 */
      }
      if (e?.code !== 'HANDSHAKE_REJECTED') scheduleReconnect()
    }
  }

  // stdin →（队列）→ WS
  let buf = ''
  input.setEncoding('utf8')
  input.on('data', (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      if (ws && !ws.closed) {
        if (process.env.WORKHUB_RELAY_DEBUG) log(`→ ${line.slice(0, 200)}`)
        ws.sendText(line)
      } else {
        if (queue.length >= MAX_QUEUE) {
          relayUnreachableError(line)
          continue
        }
        queue.push(line)
        connect()
      }
    }
  })
  input.on('end', () => {
    shuttingDown = true
    ws?.close()
    process.exit(0)
  })

  connect()

  return {
    close: () => {
      shuttingDown = true
      ws?.close()
    },
    queueLength: () => queue.length,
  }
}

/* ------------------------------ 连通性自检 ------------------------------ */

/**
 * `--verify`：以真实 MCP 客户端身份走完「连 relay → initialize → tools/list」，
 * 把结果打到 **stderr**（stdout 留给协议），退出码 0/1。
 * 供 `npm run agent:setup -- --check` 与排障使用。
 */
async function verify(url, token) {
  const client = new MiniWsClient(url)
  const pending = new Map()
  let seq = 0
  client.onmessage = (text) => {
    let msg
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    if (msg.id == null) return
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(Object.assign(new Error(msg.error.message ?? 'MCP 错误'), { code: msg.error.code }))
    else p.resolve(msg.result)
  }
  const rpc = (method, params = {}, timeoutMs = 10_000) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      client.sendText(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`MCP 调用超时：${method}`))
      }, timeoutMs)
    })

  await client.open()
  const init = await rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, accessToken: token })
  log(`✅ 握手成功：server=${init?.serverInfo?.name} protocol=${init?.protocolVersion}`)
  await rpc('ping')
  log('✅ ping 正常')
  try {
    const list = await rpc('tools/list')
    const tools = list?.tools ?? []
    log(`✅ tools/list 返回 ${tools.length} 个工具：${tools.map((t) => t.name).join(', ')}`)
  } catch (e) {
    // 桥离线是**前置条件缺失**，不是 shim 故障：给出可操作指引后仍算「配置正确」
    log(`⚠️  tools/list 不可用：${e?.message ?? e}`)
    log('    → 请打开站点并在「设置 → AI Agent 桥」启用桥，再重试（relay 与 token 本身已验证通过）')
  }
  client.close()
}

/* ------------------------------ 入口 ------------------------------ */

function argOf(args, name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

// 入口判定必须用 fileURLToPath 反解，而不是字符串拼 `file://`：
// 本仓库根目录含中文（team工作台），import.meta.url 是百分号编码的，
// 直接 `file://${path.resolve(process.argv[1])}` 永远不相等 → CLI 会静默什么都不做。
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const args = process.argv.slice(2)
  const wantVerify = args.includes('--verify')
  let cred
  try {
    cred = resolveRelayCredential({ url: argOf(args, '--url', ''), token: argOf(args, '--token', '') })
  } catch (e) {
    log(`❌ ${e.message}`)
    process.exit(2)
  }
  if (wantVerify) {
    verify(cred.url, cred.token).then(
      () => process.exit(0),
      (e) => {
        log(`❌ 自检失败：${e?.message ?? e}`)
        process.exit(1)
      },
    )
  } else {
    log(`启动 stdio 桥：${cred.url}`)
    createStdioBridge(cred)
  }
}

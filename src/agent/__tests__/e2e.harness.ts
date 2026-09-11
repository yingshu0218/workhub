/**
 * P1 第 7 步 E2E 验收套件（方案 §9.8）
 *
 * 与 §9.8 原口径的唯一差别：**「应用」以无头 harness 起在同一 Node 进程内**
 * （vitest + fake-indexeddb，与既有的 relay/bridge 测试同源），
 * 浏览器侧桥（src/agent/bridge.ts 的 AgentBridge）**原样复用未做任何改动**，
 * relay 侧（relay/index.mjs）也原样以子进程拉起。
 * 唯一替换项是 Node 环境没有原生 WebSocket —— 由本文件注入一个最小 WebSocket 实现，
 * 语义与浏览器一致（含 Client→Server 掩码），因此链路是「真 WS 帧 + 真 MCP 协议 + 真 relay 进程」。
 *
 * 选它而不是 Playwright/Chromium 的理由：
 *  - 仓库无 e2e 基建、零新增依赖口径（relay 手写 RFC6455 即为此）；
 *  - §9.8 要验的是**协议链路 + 业务断言**（载荷一致性 / 幂等 / 白名单 / 读限幅 / 门控），
 *    这些全部在「桥以下」，与渲染无关；
 *  - 渲染层证据另有 vite build 产物 + CSP 注入测试（csp.test.ts）覆盖，不重复背浏览器安装成本。
 */
import { createHash, randomBytes } from 'node:crypto'
import { connect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/* ------------------------------ 1. 最小 WebSocket ------------------------------ */
/** 与浏览器 WebSocket 语义一致的客户端实现（RFC6455：Client→Server 必须掩码） */
export class NodeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  url: string
  readyState = NodeWebSocket.CONNECTING
  onopen: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null

  /** wss 需要 TLS —— 线上经域名接入后探针必须能连 wss，否则只会拿到 301 跳转 */
  private tls: boolean
  private socket: ReturnType<typeof connect>
  private buffer: Buffer = Buffer.alloc(0)
  private handshaken = false

  constructor(url: string) {
    this.url = url
    const u = new URL(url)
    this.tls = u.protocol === 'wss:'
    const port = Number(u.port || (this.tls ? 443 : 80))
    const onConnect = () => {
      // 握手请求：Sec-WebSocket-Key 每次随机（RFC6455 §4.1）
      const key = randomBytes(16).toString('base64')
      this.socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
          `Host: ${u.hostname}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      )
    }
    this.socket = this.tls
      ? (tlsConnect(
          { host: u.hostname, port, servername: u.hostname },
          onConnect,
        ) as unknown as ReturnType<typeof connect>)
      : connect({ host: u.hostname, port }, onConnect)
    this.socket.on('data', (chunk: Buffer) => this.#onData(chunk))
    this.socket.on('error', (e: Error) => {
      this.readyState = NodeWebSocket.CLOSED
      this.onerror?.({ message: e.message })
    })
  }

  /** @internal 仅供调试/测试观察连接状态 */
  _debugSocket(): ReturnType<typeof connect> {
    return this.socket
  }

  #onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (!this.handshaken) {
      const idx = this.buffer.indexOf('\r\n\r\n')
      if (idx < 0) return
      const head = this.buffer.subarray(0, idx).toString('latin1')
      this.buffer = this.buffer.subarray(idx + 4)
      if (!head.includes(' 101 ')) {
        // 握手被拒（400/426 等）：如实报错，不吞掉
        this.readyState = NodeWebSocket.CLOSED
        this.onerror?.({ message: `WebSocket 握手失败：${head.split('\\r\\n')[0]}` })
        this.socket.end()
        return
      }
      this.handshaken = true
      this.readyState = NodeWebSocket.OPEN
      this.onopen?.({})
      // 握手应答与首帧可能同包：继续解析剩余字节
      if (this.buffer.length === 0) return
    }
    // 解析服务端帧（服务端不掩码）
    for (;;) {
      const buf = this.buffer
      if (buf.length < 2) return
      const opcode = buf[0] & 0x0f
      const masked = (buf[1] & 0x80) === 0x80
      let len = buf[1] & 0x7f
      // 关键顺序：先按 7/16/64 位宽度算出「长度字段之后的偏移」，
      // 再校验「偏移 + 掩码(4) + 载荷」是否已到齐。
      // 早期版本在 len<126 分支直接拿 offset=2 去校验长度，长帧（126/127 扩展长度）
      // 会把后续的扩展长度字节误当掩码读走，导致载荷整体错位 —— 表现为「小响应正常、大响应乱码」。
      let offset: number
      if (len < 126) {
        offset = 2
      } else if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        offset = 4
      } else {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        offset = 10
      }
      let mask: Buffer | null = null
      if (masked) {
        if (buf.length < offset + 4) return
        mask = buf.subarray(offset, offset + 4)
        offset += 4
      }
      if (buf.length < offset + len) return
      const payload = Buffer.from(buf.subarray(offset, offset + len))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
      this.buffer = buf.subarray(offset + len)
      if (opcode === 0x1) this.onmessage?.({ data: payload.toString('utf8') })
      else if (opcode === 0x8) {
        this.readyState = NodeWebSocket.CLOSED
        this.onclose?.({})
        this.socket.end()
        return
      } else if (opcode === 0x9) this.#sendFrame(0xa, payload)
    }
  }

  #sendFrame(opcode: number, payload: Buffer): void {
    if (this.socket.destroyed) return
    const mask = randomBytes(4)
    const len = payload.length
    let header: Buffer
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

  /** 等待握手完成（勿轮询 readyState：断言性读取会与内部状态机互相干扰） */
  waitOpen(timeoutMs = 5000): Promise<void> {
    if (this.readyState === NodeWebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket 握手超时')), timeoutMs)
      const prevOpen = this.onopen
      const prevErr = this.onerror
      this.onopen = (ev) => {
        clearTimeout(timer)
        this.onopen = prevOpen
        this.onerror = prevErr
        prevOpen?.(ev)
        resolve()
      }
      this.onerror = (ev) => {
        clearTimeout(timer)
        this.onopen = prevOpen
        this.onerror = prevErr
        prevErr?.(ev)
        reject(new Error((ev as { message?: string })?.message ?? 'WebSocket 连接错误'))
      }
    })
  }

  send(text: string): void {
    if (this.readyState !== NodeWebSocket.OPEN) throw new Error('WebSocket 未连接，无法发送')
    this.#sendFrame(0x1, Buffer.from(text, 'utf8'))
  }

  close(): void {
    if (this.readyState === NodeWebSocket.CLOSED) return
    try {
      this.#sendFrame(0x8, Buffer.alloc(0))
    } catch {
      /* 忽略 */
    }
    this.readyState = NodeWebSocket.CLOSED
    this.socket.end()
  }
}

/** 在 Node 全局注入 WebSocket（桥与 relay 测试依赖它；语义与浏览器一致） */
export function installWebSocketGlobal(): void {
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket
}

/* --------------------------- 2. relay 子进程生命周期 --------------------------- */

export interface RelayProcess {
  proc: ChildProcess
  port: number
  token: string
  /** 等待 relay 打印「WebSocket 已监听」 */
  ready: Promise<void>
  stop: () => Promise<void>
}

/** 以子进程拉起真实 relay（npm run relay 等价），端口随机避免与本地实例冲突 */
export async function startRelay(opts: { dev?: boolean } = {}): Promise<RelayProcess> {
  const port = 18000 + Math.floor(Math.random() * 2000)
  const token = randomBytes(12).toString('base64url')
  const logs: string[] = []
  const argv = [path.join(REPO_ROOT, 'relay/index.mjs')]
  // --dev：预览响应自动附一次性 confirmToken，供 E2E 自动化跑通「预览→确认→执行」
  if (opts.dev) argv.push('--dev')
  const proc = spawn(process.execPath, argv, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      WORKHUB_RELAY_PORT: String(port),
      WORKHUB_RELAY_TOKEN: token,
      // E2E 调试：relay 打印浏览器回包，便于定位「有回包但 Agent 收不到」类问题
      WORKHUB_RELAY_DEBUG: process.env.WORKHUB_RELAY_DEBUG ?? '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', (b: Buffer) => logs.push(b.toString()))
  proc.stderr.on('data', (b: Buffer) => logs.push(b.toString()))

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relay 启动超时：\n${logs.join('')}`)), 10_000)
    const check = () => {
      if (logs.join('').includes('WebSocket 已监听')) {
        clearTimeout(timer)
        resolve()
      }
    }
    proc.stdout.on('data', check)
    proc.stderr.on('data', check)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`relay 提前退出（code=${code}）：\n${logs.join('')}`))
    })
  })

  return {
    proc,
    port,
    token,
    ready,
    stop: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null) return resolve()
        proc.once('exit', () => resolve())
        proc.kill('SIGTERM')
      }),
  }
}

/* ----------------------- 3. 浏览器侧桥（原样复用 AgentBridge） ----------------------- */

export interface BridgeHandle {
  url: string
  status: () => string
  dispose: () => void
}

/** 用页面同款 AgentBridge 连出 relay（等价于「打开应用 + 设置页启用 AI 桥」） */
export async function connectBridge(relay: RelayProcess, bridge: { getStatus: () => { state: string }; connect: (c: { url: string; token: string }) => void; disconnect: () => void }): Promise<BridgeHandle> {
  const url = `ws://127.0.0.1:${relay.port}`
  bridge.connect({ url, token: relay.token })
  await waitFor(() => bridge.getStatus().state === 'connected', 5000, '桥未能连上 relay')
  return { url, status: () => bridge.getStatus().state, dispose: () => bridge.disconnect() }
}

export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number, msg: string): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await cond()) return
    if (Date.now() - start > timeoutMs) throw new Error(`超时：${msg}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

/* ------------------------------- 4. MCP 客户端 ------------------------------- */

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { risk?: string; domain?: string }
}

/** 极简 MCP over WS 客户端：走真实 relay 端点，协议为标准 JSON-RPC/MCP */
export class McpClient {
  private ws: NodeWebSocket
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  authed = false

  constructor(url: string) {
    this.ws = new NodeWebSocket(url)
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as { id?: number; result?: unknown; error?: { message?: string } }
      if (msg.id == null) return
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? 'MCP 错误'))
      else p.resolve(msg.result)
    }
  }

  static async open(url: string): Promise<McpClient> {
    const c = new McpClient(url)
    await c.ws.waitOpen(5000)
    return c
  }

  /** 裸调用（用于验证未鉴权被拒、token 错误被拒） */
  async raw<T>(method: string, params: Record<string, unknown> = {}, token?: string): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: token ? { ...params, accessToken: token } : params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP 调用超时：${method}`))
      }, 20_000)
    })
  }

  async initialize(token: string): Promise<{ protocolVersion: string; serverInfo: { name: string } }> {
    const r = await this.raw<{ protocolVersion: string; serverInfo: { name: string } }>('initialize', {}, token)
    this.authed = true
    return r
  }

  async listTools(): Promise<McpTool[]> {
    const r = await this.raw<{ tools: McpTool[] }>('tools/list')
    return r.tools
  }

  async callTool(name: string, args: Record<string, unknown> = {}, confirmToken?: string): Promise<{ ok: boolean; text: string; data?: unknown }> {
    const params: Record<string, unknown> = { name, arguments: args }
    if (confirmToken) params.confirmToken = confirmToken
    const r = await this.raw<{ content: { type: string; text: string }[]; isError?: boolean }>('tools/call', params)
    const text = r.content?.[0]?.text ?? ''
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
    return { ok: !r.isError, text, data }
  }

  close(): void {
    this.ws.close()
  }
}

/* ------------------------------- 5. 工具小助手 ------------------------------- */

/** 读工具的返回信封（items/count/truncated） */
export interface ReadEnvelope<T = Record<string, unknown>> {
  items: T[]
  count: number
  truncated: boolean
}

/** 从 resolveEntity 候选里取唯一命中；候选不唯一即抛错（对应「歧义必反问」纪律） */
export function uniqId(candidates: ReadEnvelope<{ id: string; label: string }>): string {
  if (candidates.items.length !== 1) {
    throw new Error(`候选不唯一（${candidates.items.length} 条），按纪律必须反问用户：${JSON.stringify(candidates.items)}`)
  }
  return candidates.items[0].id
}

/** 假的 settingsRepo 不需要 —— 直接复用仓库 settingsRepo（真库，fake-indexeddb） */
export { REPO_ROOT, createHash }

/**
 * `relay/mcp-stdio-shim.mjs` 端到端回归（Issue #33 · 一键接入）
 *
 * 为什么必须有这个套件：shim 是「任意 Agent 零适配接入」的**唯一传输适配层** ——
 * relay 的 Agent 端点是裸 WebSocket，而 Codex / Hermes / opencode / WorkBuddy 的
 * MCP 客户端只实现 stdio 与 Streamable HTTP。shim 一坏，四个工具的配置全部形同虚设，
 * 而这类故障在单测层面完全看不出来（只有真起进程、真走帧才现形）。
 *
 * 本套件以**普通 MCP 客户端**的身份对待 shim：spawn 它、只跟 stdin/stdout 讲
 * 换行分隔 JSON-RPC（MCP 官方 stdio 传输）—— 这正是那四个工具所做的事。
 * relay 侧照旧以子进程拉起，浏览器侧换成最小应答器。
 *
 * 覆盖四条约定的不变式：
 *   ① stdout 只走协议：任何一行都必须能 JSON.parse（日志走 stderr）；
 *   ② 双向链路：stdio → 队列 → WS → relay → 浏览器 全通；
 *   ③ 桥离线时 tools/list 回**可操作错误**，不是挂起（与 relay 侧同一纪律）；
 *   ④ relay 不可达时排队请求被回以可操作错误，不是静默排队到天荒地老。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { startRelay, NodeWebSocket, REPO_ROOT, type RelayProcess } from './e2e.harness'

const SHIM = path.join(REPO_ROOT, 'relay', 'mcp-stdio-shim.mjs')

/** 最小 MCP over stdio 客户端：与 Codex / Hermes / opencode 对 shim 的调用方式一致 */
class StdioMcpClient {
  private proc: ChildProcess
  private buf = ''
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  /** stdout 上无法解析的行数 —— 必须恒为 0（协议通道不能被日志污染） */
  badLines = 0
  stderr = ''

  constructor(env: Record<string, string>) {
    this.proc = spawn(process.execPath, [SHIM], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc.stdout!.setEncoding('utf8')
    this.proc.stdout!.on('data', (chunk: string) => this.onData(chunk))
    this.proc.stderr!.setEncoding('utf8')
    this.proc.stderr!.on('data', (chunk: string) => {
      this.stderr += chunk
    })
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      let msg: { id?: number; result?: unknown; error?: { message?: string; code?: number } }
      try {
        msg = JSON.parse(line)
      } catch {
        this.badLines += 1
        continue
      }
      if (msg.id == null) continue
      const p = this.pending.get(msg.id)
      if (!p) continue
      this.pending.delete(msg.id)
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message ?? 'MCP 错误'), { code: msg.error.code }))
      else p.resolve(msg.result)
    }
  }

  rpc<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 8000): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`shim 无响应：${method}`))
      }, timeoutMs)
    })
  }

  close(): void {
    this.proc.stdin?.end()
  }
  kill(): void {
    this.proc.kill('SIGKILL')
  }
}

let relay: RelayProcess
let browser: NodeWebSocket
let shim: StdioMcpClient

beforeAll(async () => {
  relay = await startRelay()
  await relay.ready
  browser = new NodeWebSocket(`ws://127.0.0.1:${relay.port}/?role=browser&token=${encodeURIComponent(relay.token)}`)
  browser.onmessage = (e) => {
    const m = JSON.parse(e.data) as { requestId: string; kind: string; name?: string }
    if (m.kind === 'tools/list') {
      browser.send(
        JSON.stringify({
          type: 'agentops:result',
          requestId: m.requestId,
          ok: true,
          data: {
            tools: [
              {
                name: 'fin_recordTransaction',
                description: '记一笔收支流水（财务记账）',
                risk: 'medium',
                domain: 'fin',
                inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
              },
            ],
          },
        }),
      )
      return
    }
    browser.send(
      JSON.stringify({
        type: 'agentops:result',
        requestId: m.requestId,
        ok: true,
        data: { echoedTool: m.name, preview: true },
      }),
    )
  }
  await browser.waitOpen()
  shim = new StdioMcpClient({ WORKHUB_RELAY_URL: `ws://127.0.0.1:${relay.port}`, WORKHUB_RELAY_TOKEN: relay.token })
}, 30_000)

afterAll(async () => {
  shim?.kill()
  browser?.close()
  await relay?.stop()
})

describe('shim：stdio ⇄ relay 传输适配', () => {
  it('① 以标准 MCP 客户端身份握手成功（stdio 上就是一台普通 MCP 服务器）', async () => {
    const init = await shim.rpc<{ protocolVersion: string; serverInfo: { name: string } }>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      accessToken: relay.token,
    })
    expect(init.serverInfo.name).toBe('workhub-agentops-relay')
    expect(init.protocolVersion).toBe('2024-11-05')
  })

  it('② tools/list 双向穿透：浏览器侧工具 + relay 内置 confirm_preview 都在', async () => {
    const r = await shim.rpc<{ tools: { name: string; annotations?: { risk?: string } }[] }>('tools/list')
    const names = r.tools.map((t) => t.name)
    expect(names).toContain('fin_recordTransaction')
    // confirm_preview 由 relay 自己追加（票据只能由 relay 签发），它的存在证明走的是真 relay
    expect(names).toContain('confirm_preview')
    expect(r.tools.find((t) => t.name === 'fin_recordTransaction')?.annotations).toMatchObject({
      risk: 'medium',
      domain: 'fin',
    })
  })

  it('③ tools/call 的入参与回包原样穿过 shim（envelope 不被改写）', async () => {
    const r = await shim.rpc<{ content: { text: string }[]; isError?: boolean }>('tools/call', {
      name: 'fin_recordTransaction',
      arguments: { amount: 120 },
    })
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content[0].text)).toMatchObject({ echoedTool: 'fin_recordTransaction', preview: true })
  })

  it('④ stdout 只走协议：全过程零条无法 JSON.parse 的行（日志必须全在 stderr）', async () => {
    await shim.rpc('ping')
    expect(shim.badLines).toBe(0)
    // 反过来确认日志确实有去处（否则「零坏行」可能只是因为什么都没打）
    expect(shim.stderr).toContain('[shim]')
  })

  it('⑤ 桥离线：tools/list 回可操作错误，而不是挂起（本项目的核心纪律）', async () => {
    browser.close()
    // 等 relay 侧把 browserConn 置空（close 事件跨网络到达，非同步）
    await new Promise((r) => setTimeout(r, 300))
    // 关键：必须**有响应**（错误也是响应）。挂起会让上层 Agent 无限等待或反复重试
    await expect(shim.rpc('tools/list')).rejects.toThrow(/未连接|AI 桥|工具清单不可用/)
  })
})

describe('shim：relay 不可达时的降级（不许静默排队）', () => {
  it('⑥ 排队请求在退避若干次后被回以可操作错误', async () => {
    // 指向一个没人监听的端口：shim 会入队 + 退避重连，退避到阈值后必须把队列转成错误
    const dead = new StdioMcpClient({
      WORKHUB_RELAY_URL: 'ws://127.0.0.1:1/relay',
      WORKHUB_RELAY_TOKEN: 'any-token-value-1234567890',
    })
    try {
      await expect(dead.rpc('initialize', { accessToken: 'any-token-value-1234567890' }, 12_000)).rejects.toThrow(
        /relay 不可达|凭据文件/,
      )
      // 错误文案必须是**可操作的**：要告诉用户去查站点是否起了、token 是否对齐
      expect(dead.stderr).toContain('连接失败')
    } finally {
      dead.kill()
    }
  }, 20_000)

  it('⑦ 路径写错（relay 挂 /，却去连 /relay）立即失败并指名路径，不许干等到超时', async () => {
    // 这条是回归锁：修复前只会 destroy socket，调用方要等到 8s 超时才拿到一个
    // 「握手超时」——把「配置里路径写错」误报成网络问题。
    const wrongPath = new StdioMcpClient({
      WORKHUB_RELAY_URL: `ws://127.0.0.1:${relay.port}/not-the-relay-path`,
      WORKHUB_RELAY_TOKEN: relay.token,
    })
    const started = Date.now()
    try {
      await expect(wrongPath.rpc('initialize', { accessToken: relay.token }, 6000)).rejects.toThrow(
        /握手被拒|404/,
      )
      // 关键：不是靠超时兜底，而是握手应答一回来就失败
      expect(Date.now() - started).toBeLessThan(3000)
      expect(wrongPath.stderr).toContain('relay 挂载点')
    } finally {
      wrongPath.kill()
    }
  }, 20_000)
})

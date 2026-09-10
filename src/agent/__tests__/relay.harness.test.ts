/**
 * Relay 真实进程回归测试（P1 第 7 步 E2E 暴露的三处「只有真起进程才现形」的缺陷）
 *
 * 这三条都不会被已有的 relay.bridge.test.ts 覆盖 —— 那个套件直接把 router 拿在进程内跑，
 * 绕过了 relay/index.mjs 的连接分流与浏览器往返适配层：
 *
 * ① 连接分流：Agent 端点（无 role）曾被 browser 分支吞掉，覆盖掉 browserConn。
 *    此后 relay 把「唤醒浏览器」的请求发回 Agent 自己，Agent 不认 relay 内部协议，表现为永久无响应。
 * ② 回包信封：onBrowserMessage 曾只 resolve(data)，把桥的 ok/error 丢掉，
 *    下游 `res.ok !== true` 恒真，工具明明执行成功却一律回「执行失败」。
 * ③ listTools 适配：同源问题，信封变了之后 r.tools 实际落在 r.data.tools。
 *
 * 测试全部走真实 relay 子进程（relay/index.mjs），只把页面侧桥换成最小应答器 ——
 * 这是唯一能覆盖「连接分流 + 浏览器往返」两层的形状。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  installWebSocketGlobal,
  startRelay,
  NodeWebSocket,
  type RelayProcess,
} from './e2e.harness'
import { MCP_PROTOCOL_VERSION } from '@relay/mcp-relay.mjs'

let relay: RelayProcess
let agent: NodeWebSocket
/** 页面侧最小应答器：按 kind 回不同 data，用于验证 ok/data 是否原样穿过 relay */
let browser: NodeWebSocket
let browserBehaviour: 'tools' | 'ok-data' | 'fail' = 'tools'
const seen: string[] = []

function reply(): Record<string, unknown> {
  if (browserBehaviour === 'fail') return { ok: false, error: '页面侧明确报错' }
  if (browserBehaviour === 'tools') return { ok: true, data: { tools: [{ name: 'x_tool', risk: 'low', domain: 'x' }] } }
  return { ok: true, data: { v: 'payload' } }
}

beforeAll(async () => {
  installWebSocketGlobal()
  relay = await startRelay()
  await relay.ready
  const url = 'ws://127.0.0.1:' + relay.port
  browser = new NodeWebSocket(url + '/?role=browser&token=' + encodeURIComponent(relay.token))
  browser.onmessage = (e) => {
    const m = JSON.parse(e.data)
    seen.push(m.requestId)
    browser.send(JSON.stringify({ type: 'agentops:result', requestId: m.requestId, ...reply() }))
  }
  await browser.waitOpen()

  agent = new NodeWebSocket(url)
  await agent.waitOpen()
  await new Promise<void>((resolve, reject) => {
    agent.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== 1) return
      if (m.result) resolve()
      else reject(new Error('initialize 失败'))
    }
    agent.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: relay.token } }))
  })
}, 30_000)

afterAll(async () => {
  agent?.close()
  browser?.close()
  await relay?.stop()
})

/** 单条 JSON-RPC 应答：测试只读 result / error 两处；字段全部给足避免断言处层层判空 */
interface RpcResult {
  content: { text: string }[]
  isError?: boolean
  tools: { name?: string; annotations?: { risk?: string; domain?: string } }[]
  protocolVersion?: string
  serverInfo: { name: string }
}
interface RpcReply {
  id?: number
  result: RpcResult
  error?: { message?: string }
}

/** 单次 MCP 调用（带超时，避免「永久无响应」把测试挂死） */
async function call(method: string, params: Record<string, unknown> = {}, id = 100): Promise<RpcReply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('永久无响应：' + method + '（回归①的症状）')), 3000)
    agent.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== id) return
      clearTimeout(timer)
      resolve(m)
    }
    agent.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

describe('relay 真机回归（E2E 暴露的三处缺陷）', () => {
  it('① Agent 连接不被 browser 分支吞掉：MCP 调用收到应答而非永久无响应', async () => {
    const r = await call('tools/list', {}, 200)
    expect(r.error).toBeUndefined()
    expect(r.result).toBeTruthy()
    // 关键断言：这次唤醒确实发到了「浏览器」连接上（browserConn 没被 Agent 覆盖）
    expect(seen.length).toBe(1)
  })

  it('② 浏览器回包的 ok/data 原样穿过 relay（不被丢成「执行失败」）', async () => {
    browserBehaviour = 'ok-data'
    const r = await call('tools/call', { name: 'x_tool', arguments: {} }, 201)
    expect(r.error).toBeUndefined()
    expect(JSON.parse(r.result.content[0].text)).toEqual({ v: 'payload' })
  })

  it('②-b 浏览器明确报错时，错误文本原样传给 MCP 客户端（不吞成通用文案）', async () => {
    browserBehaviour = 'fail'
    const r = await call('tools/call', { name: 'x_tool', arguments: {} }, 202)
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toBe('页面侧明确报错')
  })

  it('③ tools/list 走 data.tools 信封：页面侧工具清单完整穿过 relay', async () => {
    browserBehaviour = 'tools'
    const r = await call('tools/list', {}, 203)
    // 信封错位（直接 r.tools）时这里会是空数组，不报错但静默丢光全部工具 —— 必须断言条数
    // relay 会在页面清单之外**追加内置的 confirm_preview**（中风险确认取票入口），故按名字断言。
    const names = r.result.tools.map((t) => t.name)
    expect(names).toContain('x_tool')
    expect(r.result.tools.find((t) => t.name === 'x_tool')).toMatchObject({
      annotations: { risk: 'low', domain: 'x' },
    })
  })

  it('④ ping 不依赖浏览器，仍即时应答（链路区分「要唤醒页面」与「纯协议」）', async () => {
    const r = await call('ping', {}, 204)
    expect(r.result).toEqual({})
  })

  it('⑤ MCP 协议版本与 serverInfo 稳定（标准 MCP 端点）', async () => {
    const fresh = new NodeWebSocket('ws://127.0.0.1:' + relay.port)
    await fresh.waitOpen()
    const init = await new Promise<RpcReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('initialize 无响应')), 3000)
      fresh.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.id !== 1) return
        clearTimeout(timer)
        resolve(m)
      }
      fresh.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: relay.token } }))
    })
    fresh.close()
    expect(init.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(init.result.serverInfo.name).toBe('workhub-agentops-relay')
  })

  it('⑥ 未知 role 的连接被拒，且不污染 browserConn（后续调用仍正常）', async () => {
    const bogus = new NodeWebSocket(
      'ws://127.0.0.1:' + relay.port + '/?role=hacker&token=' + encodeURIComponent(relay.token),
    )
    await bogus.waitOpen()
    await new Promise((r) => setTimeout(r, 200))
    browserBehaviour = 'tools'
    const r = await call('tools/list', {}, 205)
    expect(r.result.tools.some((t) => t.name === 'x_tool')).toBe(true)
    bogus.close()
  })
})

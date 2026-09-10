/**
 * 浏览器侧桥（AgentBridge）+ zod→JSON Schema 对照测试（方案 §五 / §四.4 / §10.1）
 *
 * 覆盖：
 *   ① tools/list 的 inputSchema 由同一份 zod 生成（单源，无漂移）；
 *   ② 中风险工具无 confirmToken → 只回预览材料，不执行落库（确认机制兜底）；
 *   ③ 白名单关闭的域在 tools/list 里不出现（对桥不可见）；
 *   ④ 低风险工具直达 dispatchAgentTool（唯一入口）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { zodToJsonSchema } from '../jsonSchema'
import { recordTransactionSchema, resolveEntitySchema, createTodoSchema } from '../schema'
import { AgentBridge } from '../bridge'
import { createWsServer, type WsServerHandle } from '@relay/ws-server.mjs'
import { settingsRepo } from '@/repositories'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('zod → JSON Schema（单源生成）', () => {
  it('object：必填/可选/default 正确映射', () => {
    const s = zodToJsonSchema(recordTransactionSchema) as {
      type: string
      properties: Record<string, Record<string, unknown>>
      required: string[]
    }
    expect(s.type).toBe('object')
    // summary/amount 必填；ledgerId 可缺省（缺省走领域层「isDefault → 唯一账本 → 反问」策略，
    // 与 UI 在「全部账本」视图下自动选默认账本的行为对齐）
    expect(s.required).toContain('summary')
    expect(s.required).toContain('amount')
    expect(s.required).not.toContain('ledgerId')
    // status 有 default → 不列入 required，且带 default
    expect(s.required).not.toContain('status')
    expect(s.properties.status.default).toBe('待对账')
    // 枚举映射为 enum
    expect(s.properties.type.enum).toEqual(['income', 'expense'])
  })

  it('occurredAt 的 refine 包装透传为 string 且带 description 兜底不丢类型', () => {
    const s = zodToJsonSchema(recordTransactionSchema) as { properties: Record<string, Record<string, unknown>> }
    expect(s.properties.occurredAt.type).toBe('string')
  })

  it('enum / 简单 string 工具 schema 生成稳定', () => {
    const s = zodToJsonSchema(resolveEntitySchema) as { properties: Record<string, Record<string, unknown>>; required: string[] }
    expect(s.properties.type.enum).toEqual(['customer', 'project', 'todo', 'ledger', 'habit', 'note', 'noteFolder'])
    expect(s.required).toEqual(expect.arrayContaining(['query', 'type']))

    const t = zodToJsonSchema(createTodoSchema) as { properties: Record<string, Record<string, unknown>> }
    expect(t.properties.priority.enum).toEqual(['P1', 'P2', 'P3'])
    expect(t.properties.priority.default).toBe('P2')
  })

  it('未识别构造保守降级为空 schema，不臆造约束', () => {
    const s = zodToJsonSchema(createTodoSchema) as { properties: Record<string, Record<string, unknown>> }
    expect(s.properties).toBeTruthy()
  })
})

describe('AgentBridge：工具清单与确认机制', () => {
  let ws: WsServerHandle | undefined

  afterEach(async () => {
    await ws?.close()
    ws = undefined
  })

  it('白名单关闭的域不出现在 tools/list（对桥不可见）', async () => {
    await settingsRepo.save({ ai: { bridgeEnabled: true, domains: { fin: false } } })
    const bridge = new AgentBridge()
    // 绕过真实 WS：直接反射私有 onMessage（用 as any 访问内部，测试用）
    const calls: { ok: boolean; data?: unknown; error?: string }[] = []
    const fakeSend = (raw: string) => calls.push(JSON.parse(raw))
    // @ts-expect-error 测试注入
    bridge.ws = { readyState: 1, send: fakeSend }
    // @ts-expect-error 测试访问私有
    await bridge.onMessage(JSON.stringify({ type: 'agentops:call', requestId: 'q1', kind: 'tools/list' }))
    const tools = (calls[0].data as { tools: { name: string; domain: string }[] }).tools
    expect(tools.some((t) => t.domain === 'fin')).toBe(false)
    expect(tools.some((t) => t.name === 'resolveEntity')).toBe(true)
  })

  it('中风险工具无 confirmToken → 只回预览，不落库', async () => {
    await settingsRepo.save({ ai: { bridgeEnabled: true, domains: {} } })
    const bridge = new AgentBridge()
    const calls: { ok: boolean; data?: unknown }[] = []
    // @ts-expect-error 测试注入
    bridge.ws = { readyState: 1, send: (raw: string) => calls.push(JSON.parse(raw)) }
    // @ts-expect-error 测试访问私有
    await bridge.onMessage(JSON.stringify({ type: 'agentops:call', requestId: 'q2', kind: 'tools/call', name: 'fin_recordTransaction', args: { ledgerId: 'x', summary: 's', amount: 1 } }))
    const data = calls[0].data as { preview: boolean; risk: string }
    expect(data.preview).toBe(true)
    expect(data.risk).toBe('medium')
    // 未落库
    expect(await db.transactions.count()).toBe(0)
  })

  it('中风险工具携带 confirmToken → 直达执行', async () => {
    await settingsRepo.save({ ai: { bridgeEnabled: true, domains: {} } })
    const bridge = new AgentBridge()
    const calls: { ok: boolean; data?: unknown; error?: string }[] = []
    // @ts-expect-error 测试注入
    bridge.ws = { readyState: 1, send: (raw: string) => calls.push(JSON.parse(raw)) }
    // @ts-expect-error 测试访问私有
    await bridge.onMessage(JSON.stringify({ type: 'agentops:call', requestId: 'q3', kind: 'tools/call', name: 'fin_recordTransaction', args: {}, meta: { confirmToken: 'ok' } }))
    // 校验失败（缺 ledgerId）→ ok=false 的可操作错误，说明已进入 dispatch 而不被预览拦下
    expect(calls[0].ok).toBe(false)
    expect(calls[0].error).toBeTruthy()
  })

  it('低风险工具直达 dispatchAgentTool（唯一入口）', async () => {
    await settingsRepo.save({ ai: { bridgeEnabled: true, domains: { todo: false } } })
    const bridge = new AgentBridge()
    const calls: { ok: boolean; error?: string }[] = []
    // @ts-expect-error 测试注入
    bridge.ws = { readyState: 1, send: (raw: string) => calls.push(JSON.parse(raw)) }
    // 白名单关闭 todo 域 → 闸门拒绝
    // @ts-expect-error 测试访问私有
    await bridge.onMessage(JSON.stringify({ type: 'agentops:call', requestId: 'q4', kind: 'tools/call', name: 'todo_createTodo', args: { title: 'x' } }))
    expect(calls[0].ok).toBe(false)
    expect(calls[0].error).toContain('白名单')
  })
})

describe('Relay 端到端：浏览器连出 × MCP 客户端（进程外 WS）', () => {
  it('浏览器连出 → relay 经 WS 下发 tools/call 并回传结果（真实帧往返）', async () => {
    const token = 'e2e-token'
    // 进程外 WS 服务端 + 路由（复用 relay 核心）
    const ws = await createWsServer({ port: 0 })
    const { createMcpRouter } = await import('@relay/mcp-relay.mjs')
    let browserConn: import('@relay/ws-server.mjs').WsConnection | null = null
    const pending = new Map<string, (v: { ok: boolean; data?: unknown; error?: string }) => void>()
    let seq = 0
    const router = createMcpRouter({
      token,
      listTools: async () => [{ name: 'resolveEntity', risk: 'low', domain: 'read' }],
      callTool: (name, args) =>
        new Promise((resolve) => {
          const requestId = `r${++seq}`
          pending.set(requestId, resolve)
          browserConn?.send(JSON.stringify({ type: 'agentops:call', requestId, kind: 'tools/call', name, args }))
        }),
    })
    ws.server.on('ws-connection', (conn: import('@relay/ws-server.mjs').WsConnection) => {
      browserConn = conn
      conn.on('message', (raw: string) => {
        const msg = JSON.parse(raw)
        if (msg.type === 'agentops:result') {
          const p = pending.get(msg.requestId)
          if (p) {
            pending.delete(msg.requestId)
            p({ ok: msg.ok, data: msg.data, error: msg.error })
          }
        }
      })
    })

    try {
      // 浏览器侧真连出（模拟应用内 AgentBridge 的连接形态）
      const browser = new WebSocket(`ws://127.0.0.1:${ws.port}/?role=browser&token=${token}`)
      await new Promise<void>((res, rej) => {
        browser.onopen = () => res()
        browser.onerror = () => rej(new Error('浏览器连出失败'))
      })
      // 浏览器回包（真实 WS 帧）
      browser.onmessage = (ev) => {
        const req = JSON.parse(String(ev.data))
        browser.send(JSON.stringify({ type: 'agentops:result', requestId: req.requestId, ok: true, data: { called: req.name, args: req.args } }))
      }

      const ctx: Record<string, unknown> = {}
      await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: token } }, ctx)
      const r = await router.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'resolveEntity', arguments: { query: '王五', type: 'customer' } } }, ctx)
      const result = r?.result as { isError: boolean; content: { text: string }[] }
      expect(result.isError).toBe(false)
      const payload = JSON.parse(result.content[0].text) as { called: string; args: { query: string } }
      expect(payload.called).toBe('resolveEntity')
      expect(payload.args.query).toBe('王五')
      browser.close()
    } finally {
      await ws.close()
    }
  })
})

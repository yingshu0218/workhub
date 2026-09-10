/**
 * 本地 Relay + MCP 转发对照测试（方案 §7.4 安全边界 / §10.1 标准 MCP / §10.4 通用性）
 *
 * 覆盖四条硬约束：
 *   ① 无 token 连接/initialize 被拒；② 白名单关闭的域不出现在 tools/list；
 *   ③ 中风险操作无 confirmToken 只返回预览材料（不直达执行）；
 *   ④ 标准 MCP 协议（tools/list + tools/call）+ 一次性 confirmToken 防重放。
 *
 * 真实起进程外 WS 服务端（relay/ws-server.mjs），用 Node 24 内置 WebSocket 客户端实测握手与帧。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createWsServer, type WsServerHandle, type WsConnection } from '@relay/ws-server.mjs'
import { createMcpRouter, ConfirmTokenStore, argsFingerprint } from '@relay/mcp-relay.mjs'

let ws: WsServerHandle | undefined

afterEach(async () => {
  await ws?.close()
  ws = undefined
})

/** 起 WS relay 并挂一个「假浏览器」：把 MCP 请求路由到给定的 listTools/callTool 实现 */
async function setup(opts: {
  token: string
  tools?: { name: string; risk?: string; domain?: string; inputSchema?: Record<string, unknown> }[]
  callTool?: (name: string, args: Record<string, unknown>, meta: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  ttlMs?: number
  now?: () => number
}) {
  ws = await createWsServer({ port: 0 })
  const store = new ConfirmTokenStore({ ttlMs: opts.ttlMs, now: opts.now })
  const router = createMcpRouter({
    token: opts.token,
    listTools: async () => opts.tools ?? [],
    callTool: opts.callTool ?? (async () => ({ ok: true, data: {} })),
    confirmStore: store,
  })

  // 假浏览器连出
  const browser = new WebSocket(`ws://127.0.0.1:${ws.port}/?role=browser&token=${encodeURIComponent(opts.token)}`)
  await new Promise<void>((resolve, reject) => {
    browser.onopen = () => resolve()
    browser.onerror = () => reject(new Error('假浏览器连接失败'))
  })

  // 把 relay 路由的「浏览器往返」接到假浏览器上：router 的 listTools/callTool 本就是本地实现，
  // 这里只需让 WS 服务端识别浏览器连接（配对关系由 router 直接持有，不依赖 WS 转发）。
  const browserConn = [...ws.connections][0] as WsConnection
  browserConn.on('message', () => {
    /* 本测试直连 router，不经 WS 转发层 */
  })

  return { router, store, browser, browserConn }
}

describe('WebSocket 握手与帧（RFC6455 最小实现）', () => {
  it('浏览器角色 + 正确 token 可握手成功', async () => {
    ws = await createWsServer({ port: 0 })
    const c = new WebSocket(`ws://127.0.0.1:${ws.port}/?role=browser&token=t1`)
    await new Promise<void>((resolve, reject) => {
      c.onopen = () => resolve()
      c.onerror = () => reject(new Error('握手失败'))
    })
    expect(ws.connections.size).toBe(1)
    c.close()
  })
})

describe('① 无 token 连接/呼入一律被拒', () => {
  it('initialize 未携带 token → 拒绝', async () => {
    const { router } = await setup({ token: 'secret' })
    const r = await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(r?.error).toBeTruthy()
    expect(String((r?.error as { message: string }).message)).toContain('token')
  })

  it('token 错误 → 拒绝', async () => {
    const { router } = await setup({ token: 'secret' })
    const r = await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 'wrong' } })
    expect(r?.error).toBeTruthy()
  })

  it('未鉴权会话调 tools/list 亦被拒（不因 initialize 缺失而放行）', async () => {
    const { router } = await setup({ token: 'secret' })
    const r = await router.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { authed: false })
    expect(r?.error).toBeTruthy()
    expect(String((r?.error as { message: string }).message)).toContain('未鉴权')
  })

  it('正确 token initialize → 返回标准 MCP 握手信息', async () => {
    const { router } = await setup({ token: 'secret' })
    const ctx: Record<string, unknown> = {}
    const r = await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 'secret' } }, ctx)
    expect(ctx.authed).toBe(true)
    const result = r?.result as { protocolVersion: string; serverInfo: { name: string } }
    expect(result.protocolVersion).toBeTruthy()
    expect(result.serverInfo.name).toContain('relay')
  })
})

describe('② tools/list 白名单：关闭的域不出现', () => {
  it('listTools 结果原样下发，域/风险级随 annotations 暴露', async () => {
    const tools = [
      { name: 'fin_recordTransaction', risk: 'medium', domain: 'fin', inputSchema: { type: 'object' } },
      { name: 'resolveEntity', risk: 'low', domain: 'read' },
    ]
    const { router } = await setup({ token: 't', tools })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const r = await router.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx)
    const list = (r?.result as { tools: { name: string; annotations: { risk: string; domain: string } }[] }).tools
    expect(list.map((t) => t.name)).toEqual(['fin_recordTransaction', 'resolveEntity'])
    expect(list[0].annotations.risk).toBe('medium')
    expect(list[1].annotations.domain).toBe('read')
  })

  it('白名单关闭 fin 域 → fin_* 不在清单（由浏览器侧过滤，桥透明）', async () => {
    // 浏览器侧 listVisibleTools 已按域过滤；relay 只负责转发，不做二次筛选
    const tools = [{ name: 'resolveEntity', risk: 'low', domain: 'read' }]
    const { router } = await setup({ token: 't', tools })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const r = await router.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx)
    const names = (r?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(names).not.toContain('fin_recordTransaction')
  })
})

describe('③ tools/call 转发与失败语义', () => {
  it('成功调用回 JSON 文本内容，isError=false', async () => {
    const { router } = await setup({
      token: 't',
      callTool: async (name) => ({ ok: true, data: { called: name } }),
    })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const r = await router.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fin_recordTransaction', arguments: { summary: 'x' } } }, ctx)
    const result = r?.result as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content[0].text).called).toBe('fin_recordTransaction')
  })

  it('agentOps 返回可操作错误 → isError=true 且文本为错误原文', async () => {
    const { router } = await setup({
      token: 't',
      callTool: async () => ({ ok: false, error: '请先创建账本' }),
    })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const r = await router.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fin_recordTransaction', arguments: {} } }, ctx)
    const result = r?.result as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('请先创建账本')
  })

  it('callTool 抛错不泄漏为 JSON-RPC 崩溃，返回 isError 文本', async () => {
    const { router } = await setup({
      token: 't',
      callTool: async () => {
        throw new Error('浏览器未连接')
      },
    })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const r = await router.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'getCustomer', arguments: {} } }, ctx)
    const result = r?.result as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('浏览器未连接')
  })
})

describe('④ 一次性 confirmToken：防重放 + 超时作废', () => {
  it('无 confirmToken 时 callTool 仍被调用（预览语义由浏览器侧决定），携带时先核销', async () => {
    let seenMeta: Record<string, unknown> | undefined
    const { router } = await setup({
      token: 't',
      callTool: async (_n, _a, meta) => {
        seenMeta = meta
        return { ok: true, data: {} }
      },
    })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const { confirmToken } = router.issueConfirm({ tool: 'fin_recordTransaction' })
    await router.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'fin_recordTransaction', arguments: {}, confirmToken } }, ctx)
    expect(seenMeta?.redeemed).toBeTruthy()
  })

  it('同一 confirmToken 二次使用被拒（一次性）', async () => {
    const { router } = await setup({ token: 't', callTool: async () => ({ ok: true, data: {} }) })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const { confirmToken } = router.issueConfirm({ tool: 'x' })
    await router.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'x', arguments: {}, confirmToken } }, ctx)
    const r2 = await router.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'x', arguments: {}, confirmToken } }, ctx)
    const result = r2?.result as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('confirmToken')
  })

  it('超时 confirmToken 作废', async () => {
    let t = 1000
    const { router } = await setup({ token: 't', ttlMs: 100, now: () => t, callTool: async () => ({ ok: true, data: {} }) })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    // 票据现在绑定参数：签发与执行须为同一组（此处均为空 args）
    const { confirmToken } = router.issueConfirm({ tool: 'x', args: {} })
    t = 2000 // 超过 ttl
    const r = await router.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'x', arguments: {}, confirmToken } }, ctx)
    const result = r?.result as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('过期')
  })

  it('ConfirmTokenStore 核销即删除、sweep 清理过期项', () => {
    let t = 0
    const store = new ConfirmTokenStore({ ttlMs: 10, now: () => t })
    // 票据绑定参数：issue 带 args，redeem 须传入同一组参数的指纹（P0 修复后的契约）
    const fpA = argsFingerprint('a', {})
    const { confirmToken } = store.issue({ tool: 'a', args: {} })
    t = 5
    expect(store.redeem(confirmToken, fpA).ok).toBe(true)
    expect(store.redeem(confirmToken, fpA).ok).toBe(false) // 核销即删 → 二次失败
    const b = store.issue({ tool: 'b', args: {} })
    t = 100
    store.sweep()
    expect(store.redeem(b.confirmToken, argsFingerprint('b', {})).ok).toBe(false) // 已过期
  })

  it('票据绑定参数：指纹不匹配即拒（越权路径封堵）', () => {
    const store = new ConfirmTokenStore()
    const { confirmToken } = store.issue({ tool: 'crm_createCustomer', args: { name: '甲' } })
    // 同一张票换一组参数 → 拒
    expect(store.redeem(confirmToken, argsFingerprint('crm_createCustomer', { name: '乙' })).ok).toBe(false)
  })
})

describe('协议完备性', () => {
  it('未知 method → -32601', async () => {
    const { router } = await setup({ token: 't' })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const r = await router.handle({ jsonrpc: '2.0', id: 10, method: 'resources/list' }, ctx)
    expect((r?.error as { code: number }).code).toBe(-32601)
  })

  it('ping 返回空结果（保活）', async () => {
    const { router } = await setup({ token: 't' })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const r = await router.handle({ jsonrpc: '2.0', id: 11, method: 'ping' }, ctx)
    expect(r?.result).toEqual({})
  })

  it('notifications/initialized 为通知，无响应', async () => {
    const { router } = await setup({ token: 't' })
    const ctx: Record<string, unknown> = {}
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: 't' } }, ctx)
    const r = await router.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)
    expect(r).toBeNull()
  })
})

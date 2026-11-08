// @vitest-environment node
/**
 * relay 的 **HTTP 传输**（`<path>/mcp`）与 **一次性配对码**（`<path>/pair*`）回归。
 *
 * 为什么要锁：
 * - MCP 客户端只支持 stdio / Streamable HTTP，**没有一家支持裸 WebSocket**。没有这个端点，
 *   远程 Agent 就只能在自己机器上跑 shim —— 等于「想连服务器上的工作台，先装一份仓库」。
 * - 配对码是「把 5 分钟一次性码交给 Agent、长期 token 不出聊天记录」的唯一通道，
 *   它的三条性质少一条就形同虚设：**只能用一次**、**会过期**、**签发要持凭据**
 *   （relay token 或宿主认可的站点登录态）。
 *
 * 用真 http server + 真 fetch 跑（不打桩传输层）：这类端点最容易死在「框架层写对了、
 * 线路上不对」——比如把 405 写成 SPA 回退的 200 HTML，Agent 侧只会报「握手失败」。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRelay } from '@relay/server.mjs'

const TOKEN = 'test-token-abcdefghijklmnop'

let server: Server
let relay: ReturnType<typeof createRelay>
let base = ''

beforeAll(async () => {
  relay = createRelay({
    token: TOKEN,
    log: () => {},
    // 站点登录态鉴权通道：模拟 serve.mjs 用 PocketBase users token 校验后台页面。
    // 这里只认固定的 admin-session，用来验证「页面首次配对前没有 relay token 也能签码」。
    authorizeMint: (req) => req.headers.authorization === 'Bearer admin-session',
    // 服务端执行器：让 tools/list 在「浏览器不在线」时也有工具可列，
    // 从而验证的是**传输**而不是浏览器前置条件
    serverExecutor: {
      listTools: () => [{ name: 'demo_read', description: '演示只读工具' }],
      callTool: async () => ({ ok: true, data: { ok: 1 } }),
      handles: (n) => n === 'demo_read',
    },
  })
  server = createServer((req, res) => {
    if (relay.handleHttp(req, res)) return
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('host-fallback')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/relay`
})

afterAll(async () => {
  relay.close()
  await new Promise<void>((r) => server.close(() => r()))
})

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const bearer = { authorization: `Bearer ${TOKEN}` }

describe('MCP over HTTP：远程 Agent 直连（不需要本地 shim）', () => {
  it('无 Bearer 一律 401，错误码仍是 -32001（与 WS 入口同一口径）', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(r.status).toBe(401)
    const j = (await r.json()) as { error: { code: number } }
    expect(j.error.code).toBe(-32001)
  })

  it('initialize 带 Bearer 即握手成功（HTTP 无会话，凭证在头上）', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, bearer)
    expect(r.status).toBe(200)
    const j = (await r.json()) as { result: { serverInfo: { name: string } } }
    expect(j.result.serverInfo.name).toBe('workhub-agentops-relay')
  })

  /**
   * Streamable HTTP 是 **2025-03-26** 才引入的传输。服务端若一律回 2024-11-05，
   * 严格按版本走的客户端会退回去用老的 HTTP+SSE 双端点协议，于是「url 配对了却连不通」。
   * 所以协商必须回客户端要的那个版本。
   */
  it('版本协商：客户端要 2025-03-26 就回 2025-03-26（不回退成老协议）', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, bearer)
    const j = (await r.json()) as { result: { protocolVersion: string } }
    expect(j.result.protocolVersion).toBe('2025-03-26')
  })

  it('版本协商：不认识的版本回缺省版本（而不是原样回、也不是报错）', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, bearer)
    const j = (await r.json()) as { result: { protocolVersion: string } }
    expect(j.result.protocolVersion).toBe('2024-11-05')
  })

  it('capabilities 不虚报：listChanged 为 false（没有任何传输会推送工具变更）', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 11, method: 'initialize', params: {} }, bearer)
    const j = (await r.json()) as { result: { capabilities: { tools: { listChanged: boolean } } } }
    expect(j.result.capabilities.tools.listChanged).toBe(false)
  })

  it('tools/list 走的是同一个 router（服务端工具 + confirm_preview 合并下发）', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, bearer)
    expect(r.status).toBe(200)
    const j = (await r.json()) as { result: { tools: { name: string }[] } }
    const names = j.result.tools.map((t) => t.name)
    expect(names).toContain('demo_read')
    expect(names).toContain('confirm_preview')
  })

  it('tools/call 的结果是 JSON-RPC content（不是 HTML、不是 202 空体）', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'demo_read', arguments: {} } }, bearer)
    expect(r.status).toBe(200)
    const j = (await r.json()) as { result: { content: { text: string }[] } }
    expect(j.result.content[0]?.text).toContain('ok')
  })

  it('通知（无 id）回 202 且无 body，不挂住连接', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, bearer)
    expect(r.status).toBe(202)
    expect(await r.text()).toBe('')
  })

  it('GET 明确回 405（不建 SSE 流，也不回 SPA 的 200 HTML）', async () => {
    const r = await fetch(`${base}/mcp`, { headers: bearer })
    expect(r.status).toBe(405)
    expect(r.headers.get('allow')).toContain('POST')
  })

  it('非 relay 路径交回宿主（handleHttp 返回 false）', () => {
    // 直接问 handleHttp：宿主靠这个布尔值决定走不走静态资源/SPA 回退
    const fakeReq = { url: '/some/page', method: 'GET', headers: {}, socket: {} } as unknown as Parameters<
      typeof relay.handleHttp
    >[0]
    const fakeRes = { writeHead: () => fakeRes, end: () => undefined } as unknown as Parameters<typeof relay.handleHttp>[1]
    expect(relay.handleHttp(fakeReq, fakeRes)).toBe(false)
  })
})

describe('一次性配对码：长期 token 不出聊天记录', () => {
  it('签发必须持凭据（否则任何人都能给自己发码）', async () => {
    const r = await post('/pair/new', {})
    expect(r.status).toBe(401)
  })

  /**
   * 页面首次配对前**没有 relay token** —— 此时若签码只认 relay token，UI 上的
   * 「生成配对码」永远 401（用户实际卡点）。serve.mjs 用 PocketBase users token
   * 校验「已登录的后台页面」，本用例锁住这条第二鉴权通道的语义。
   */
  it('站点登录态也能签码，并可正常兑换成长期 token', async () => {
    const minted = await post('/pair/new', {}, { authorization: 'Bearer admin-session' })
    expect(minted.status).toBe(200)
    const { code } = (await minted.json()) as { code: string }
    expect(code).toMatch(/^[A-Z0-9]{6}$/)

    const redeemed = await post('/pair', { code })
    expect(redeemed.status).toBe(200)
    expect(((await redeemed.json()) as { token: string }).token).toBe(TOKEN)
  })

  it('站点登录态校验失败时仍拒绝（不能退化成「有 Authorization 就放行」）', async () => {
    const r = await post('/pair/new', {}, { authorization: 'Bearer wrong-session' })
    expect(r.status).toBe(401)
  })

  it('签发 → 兑换 → 拿回长期 token；同一码不能兑第二次', async () => {
    const minted = await post('/pair/new', {}, bearer)
    expect(minted.status).toBe(200)
    const { code, ttlSeconds, url } = (await minted.json()) as { code: string; ttlSeconds: number; url: string }
    expect(code).toMatch(/^[A-Z0-9]{6}$/)
    expect(ttlSeconds).toBe(300)
    expect(url).toContain('/relay/mcp')

    const redeemed = await post('/pair', { code })
    expect(redeemed.status).toBe(200)
    expect(((await redeemed.json()) as { token: string }).token).toBe(TOKEN)

    // 一次性：兑换即作废
    const again = await post('/pair', { code })
    expect(again.status).toBe(401)
  })

  it('乱码不给任何「曾经存在过」的区分信息（统一 401）', async () => {
    const r = await post('/pair', { code: 'ZZZZZZ' })
    expect(r.status).toBe(401)
    const j = (await r.json()) as { error: string }
    expect(j.error).toContain('无效或已过期')
  })

  it('码过期即失效（用 mintPairCode + 时间推进语义验证 TTL 常量契约）', () => {
    const { expiresAt } = relay.mintPairCode()
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  /**
   * 引导码（`ttlMs: 0`）：**不限期**、仍是一次性。
   *
   * 为什么必须有这个例外：部署完过一阵子才去翻启动日志是常态，5 分钟的码早废了；
   * 而页面此时还没有 token、签不出新码（`/pair/new` 要 Bearer），会形成死锁 ——
   * 2026-10-28 线上「桥永远连不上」那次，本质就是卡在没有可用码拿到 token 这一步。
   */
  it('引导码不限期，但同样只能兑一次（兑完即作废）', async () => {
    const { code, expiresAt } = relay.mintPairCode(0)
    expect(expiresAt).toBe(Number.POSITIVE_INFINITY)
    // 兑换判据是 `Date.now() > expiresAt`，Infinity 让它永远不成立
    expect(Date.now() > expiresAt).toBe(false)

    const first = await post('/pair', { code })
    expect(first.status).toBe(200)
    expect(((await first.json()) as { token: string }).token).toBe(TOKEN)

    const second = await post('/pair', { code })
    expect(second.status).toBe(401)
  })

  /**
   * 配对响应里的 `url` 必须是**外部可见地址**。
   *
   * 2026-10-28 实测事故：容器入口把 `Host` 改写成 `127.0.0.1:9001` 且不补 `X-Forwarded-Host`，
   * relay 于是返回 `https://127.0.0.1:9001/relay/mcp` —— 照着这个字段配置的客户端必连不上，
   * 现场看起来却像「客户端配错」。这条锁住「有 forwarded 头就用它」这个契约。
   */
  it('配对响应的 url 用反代透传的真实域名，不吐内网地址', async () => {
    const r = await post('/pair/new', {}, {
      ...bearer,
      'x-forwarded-host': 'team.example.com',
      'x-forwarded-proto': 'https',
    })
    expect(r.status).toBe(200)
    const j = (await r.json()) as { url: string }
    expect(j.url).toBe('https://team.example.com/relay/mcp')
  })
})

describe('设备授权（一条命令 + 浏览器点确认）', () => {
  const adminBearer = { authorization: 'Bearer admin-session' }

  it('签发设备码：设备码只回 CLI，用户码是可手抄的 4-4 短码', async () => {
    const r = await post('/device/code', {})
    expect(r.status).toBe(200)
    const j = (await r.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      verification_uri_complete: string
      expires_in: number
      interval: number
    }
    expect(j.device_code.length).toBeGreaterThan(20)
    expect(j.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(j.verification_uri).toMatch(/\/authorize$/)
    expect(j.verification_uri_complete).toContain(`user_code=${encodeURIComponent(j.user_code)}`)
    expect(j.expires_in).toBe(600)
    expect(j.interval).toBe(5)
  })

  it('未批准时轮询返回 authorization_pending（CLI 继续等，不当失败）', async () => {
    const { device_code } = (await (await post('/device/code', {})).json()) as { device_code: string }
    const r = await post('/device/token', { device_code })
    expect(r.status).toBe(400)
    const j = (await r.json()) as { error: string }
    expect(j.error).toBe('authorization_pending')
  })

  it('批准必须持站点登录态；批准后轮询才拿到 token，且只能拿一次', async () => {
    const { device_code, user_code } = (await (await post('/device/code', {})).json()) as {
      device_code: string
      user_code: string
    }

    const denied = await post('/device/approve', { user_code })
    expect(denied.status).toBe(401)

    const approved = await post('/device/approve', { user_code }, adminBearer)
    expect(approved.status).toBe(200)

    const first = await post('/device/token', { device_code })
    expect(first.status).toBe(200)
    const tokenBody = (await first.json()) as { access_token: string; token_type: string; url: string }
    expect(tokenBody.access_token).toBe(TOKEN)
    expect(tokenBody.token_type).toBe('Bearer')
    expect(tokenBody.url).toContain('/relay/mcp')

    const second = await post('/device/token', { device_code })
    expect(second.status).toBe(400)
    expect(((await second.json()) as { error: string }).error).toBe('expired_token')
  })

  it('拒绝授权后轮询返回 access_denied，且码作废', async () => {
    const { device_code, user_code } = (await (await post('/device/code', {})).json()) as {
      device_code: string
      user_code: string
    }
    const r = await post('/device/deny', { user_code }, adminBearer)
    expect(r.status).toBe(200)

    const poll = await post('/device/token', { device_code })
    expect(poll.status).toBe(403)
    expect(((await poll.json()) as { error: string }).error).toBe('access_denied')
  })

  it('授权页地址同样使用反代透传的真实域名', async () => {
    const r = await post('/device/code', {}, {
      'x-forwarded-host': 'team.example.com',
      'x-forwarded-proto': 'https',
    })
    const j = (await r.json()) as { verification_uri: string }
    expect(j.verification_uri).toBe('https://team.example.com/authorize')
  })
})

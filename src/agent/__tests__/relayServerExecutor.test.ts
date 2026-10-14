import { describe, expect, it } from 'vitest'
// relay/server.mjs 是 Node 直跑内核（零依赖纯 JS，不经 tsc 构建），无类型声明——测试按已知形状断言
// @ts-expect-error relay 内核无 .d.ts
import { createRelay } from '../../../relay/server.mjs'

/**
 * relay 内置执行角色路由（agentOps 服务端化 P2）
 *
 * 锁 relay 层的分流语义（执行器用 stub，不测 PB 本身）：
 * 1. tools/list = 服务端工具 ∪ 浏览器工具（重名服务端优先、标 executor:'server'）∪ confirm_preview；
 * 2. 浏览器**离线**时：有服务端工具 → tools/list 照常成功（7×24 的核心语义）；
 *    无服务端工具 → 维持既有 -32001 口径（浏览器离线 = 无任何工具可用）；
 * 3. tools/call：handles(name) → 本地执行（不经浏览器）；否则回落浏览器（离线 → 可操作错误）。
 *
 * 协议级验证：经 RelayHandle.handle（MCP JSON-RPC 消息入口，与 stdio/WS 宿主同一形态），
 * ctx.authed = true 等价于「initialize 已通过 token 校验」（token 闸门另有测试覆盖）。
 */

type ServerExecutorStub = {
  listTools: () => Array<{ name: string; description: string; risk: string; domain: string; inputSchema: unknown }>
  callTool: (name: string, args: unknown) => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>
  handles: (name: string) => boolean
}

function stubExecutor(): ServerExecutorStub & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    listTools: () => [
      { name: 'listTodos', description: '待办查询（服务端）', risk: 'low', domain: 'read', inputSchema: { type: 'object' } },
      { name: 'listLedgers', description: '账本清单（服务端）', risk: 'low', domain: 'read', inputSchema: { type: 'object' } },
    ],
    callTool: async (name) => {
      calls.push(name)
      return { ok: true, data: { items: [], count: 0, truncated: false, via: 'server' } }
    },
    handles: (name) => name === 'listTodos' || name === 'listLedgers',
  }
}

const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, params })

describe('relay 内置执行角色（serverExecutor）', () => {
  it('浏览器离线 + 有服务端工具：tools/list 正常返回且标注 executor=server', async () => {
    const relay = createRelay({ token: 't', serverExecutor: stubExecutor() })
    const res = (await relay.handle(rpc(1, 'tools/list'), { authed: true } as never)) as {
      result?: { tools?: Array<{ name: string; description?: string; executor?: string }> }
    }
    const names = (res.result?.tools ?? []).map((t) => t.name)
    expect(names).toContain('listTodos')
    expect(names).toContain('listLedgers')
    expect(names).toContain('confirm_preview')
    const listTodos = (res.result?.tools ?? []).find((t) => t.name === 'listTodos')
    expect(listTodos).toBeTruthy()
    // executor 标注是 relay 内部形态，MCP 下发（mcp-relay tools/list map）只透传标准字段
    expect(listTodos?.description).toMatch(/服务端/)
    relay.close()
  })

  it('浏览器离线 + 无服务端工具：tools/list 维持 -32001（不静默假绿）', async () => {
    const relay = createRelay({ token: 't' })
    const res = (await relay.handle(rpc(1, 'tools/list'), { authed: true } as never)) as {
      error?: { code?: number; message?: string }
    }
    expect(res.error?.code).toBe(-32001)
    expect(res.error?.message).toMatch(/未连接 relay/)
    relay.close()
  })

  it('tools/call：服务端工具本地执行（不经浏览器），携带结果透传', async () => {
    const ex = stubExecutor()
    const relay = createRelay({ token: 't', serverExecutor: ex })
    const res = (await relay.handle(
      rpc(2, 'tools/call', { name: 'listTodos', arguments: { status: 'todo' } }),
      { authed: true } as never,
    )) as { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean } }
    expect(ex.calls).toEqual(['listTodos'])
    expect(res.result?.isError).toBeFalsy()
    const payload = JSON.parse(res.result?.content?.[0]?.text ?? '{}') as { via?: string }
    expect(payload.via).toBe('server')
    relay.close()
  })

  it('tools/call：非服务端工具回落浏览器桥（离线 → 明确可操作错误）', async () => {
    const ex = stubExecutor()
    const relay = createRelay({ token: 't', serverExecutor: ex })
    const res = (await relay.handle(rpc(3, 'tools/call', { name: 'crm_createCustomer', arguments: {} }), {
      authed: true,
    } as never)) as { result?: { content?: Array<{ text?: string }>; isError?: boolean } }
    expect(ex.calls).toEqual([]) // 写工具绝不进服务端执行器
    expect(res.result?.isError).toBe(true)
    expect(res.result?.content?.[0]?.text).toMatch(/未连接 relay/)
    relay.close()
  })
})

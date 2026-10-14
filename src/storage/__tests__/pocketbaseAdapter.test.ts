import { describe, expect, it, vi } from 'vitest'
import { createPocketBaseAdapter } from '@/storage/pocketbase'

/**
 * PocketBaseAdapter 单测（agentOps 服务端化 P2，只读）
 *
 * mock fetch 验证协议语义：分页拉全、localId 映射、pb 元数据剥除、json 双重编码还原、
 * 软删真值统一、401 重登一次、get 按 localId 过滤、写原语拒绝（P2 只读边界）。
 */

/** 可编程 fetch stub：按路径前缀分发响应 */
function makeFetch(routes: {
  auth?: { status: number; body?: unknown }
  list?: (url: URL) => { status: number; body: unknown }
}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url: url.toString(), init })
    if (url.pathname.endsWith('/auth-with-password')) {
      const r = routes.auth ?? { status: 200, body: { token: 'tok-1' } }
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status })
    }
    const list = routes.list
    if (list) {
      const r = list(url)
      return new Response(JSON.stringify(r.body), { status: r.status })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const adapterOf = (fetchImpl: typeof fetch) =>
  createPocketBaseAdapter({
    baseUrl: 'http://127.0.0.1:9999',
    account: 'u',
    password: 'p',
    fetchImpl,
  })

describe('PocketBaseAdapter（服务端只读）', () => {
  it('list：分页拉全 + localId 映射 + pb 元数据剥除 + json 双重编码还原', async () => {
    const { fetchImpl, calls } = makeFetch({
      list: (url) => ({
        status: 200,
        body:
          url.searchParams.get('page') === '1'
            ? {
                page: 1,
                totalPages: 2,
                items: [
                  {
                    id: 'pbhash1',
                    localId: 'ws-main:cus:aaa',
                    name: '甲',
                    company: '甲公司',
                    tags: '["重点","老客户"]',
                    relations: '[{"targetId":"b","label":"合作"}]',
                    updatedAt: 100,
                    rev: 3,
                    deleted: 0,
                    server_received_at: 'x',
                    collectionId: 'c1',
                    collectionName: 'customers',
                  },
                ],
              }
            : {
                page: 2,
                totalPages: 2,
                items: [
                  { id: 'pbhash2', localId: 'ws-main:cus:bbb', name: '乙', updatedAt: 200, rev: 1, deleted: '1' },
                ],
              },
      }),
    })
    const adapter = adapterOf(fetchImpl)
    const rows = (await adapter.list('customers')) as unknown as Array<
      Record<string, unknown> & { deleted: number; rev: number; updatedAt: number }
    >
    // 分页拉全（2 页）
    expect(rows).toHaveLength(2)
    // id = localId 映射；pb 系统字段剥除
    expect(rows[0]!.id).toBe('ws-main:cus:aaa')
    expect(rows[0]).not.toHaveProperty('collectionId')
    expect(rows[0]).not.toHaveProperty('server_received_at')
    expect(rows[0]).not.toHaveProperty('localId')
    // json 双重编码还原（字符串 → 数组）
    expect(rows[0]!.tags).toEqual(['重点', '老客户'])
    expect(rows[0]!.relations).toEqual([{ targetId: 'b', label: '合作' }])
    // SyncMeta 透传
    expect(rows[0]!.rev).toBe(3)
    expect(rows[0]!.updatedAt).toBe(100)
    // 软删真值统一（'1' → 1）
    expect(rows[1]!.deleted).toBe(1)
    // 集合名映射（moduleConfigs → module_configs）
    await adapter.list('moduleConfigs')
    expect(calls.some((c) => c.url.includes('/api/collections/module_configs/records'))).toBe(true)
  })

  it('get：按 localId 精确过滤（业务 id 含冒号时 filter 值经转义）', async () => {
    const { fetchImpl, calls } = makeFetch({
      list: () => ({
        status: 200,
        body: { page: 1, totalPages: 1, items: [{ id: 'h1', localId: "ws-main:cus:o'x", name: '引号' }] },
      }),
    })
    const rows = (await adapterOf(fetchImpl).get('customers', "ws-main:cus:o'x")) as
      | Record<string, unknown>
      | undefined
    expect(rows!.name).toBe('引号')
    // filter 里的单引号被转义（URLSearchParams 编码后仍应包含转义形态）
    expect(
      calls.some((c) => decodeURIComponent(c.url).includes("localId='ws-main:cus:o\\'x'")),
    ).toBe(true)
  })

  it('401 自动重登一次重试（token 过期不炸）', async () => {
    let authCount = 0
    let listCount = 0
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/auth-with-password')) {
        authCount++
        return new Response(JSON.stringify({ token: `tok-${authCount}` }), { status: 200 })
      }
      listCount++
      if (listCount === 1) return new Response('expired', { status: 401 })
      return new Response(JSON.stringify({ page: 1, totalPages: 1, items: [] }), { status: 200 })
    }) as unknown as typeof fetch
    const rows = await adapterOf(fetchImpl).list('todos')
    expect(rows).toEqual([])
    expect(authCount).toBe(2)
  })

  it('写路径（P3）：transaction 内 put 新记录走 POST（body 带 localId 镜像 + 确定性哈希 id）', async () => {
    const bodies: unknown[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'tok' }), { status: 200 })
      }
      if (url.pathname.includes('/records') && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ id: 'h1' }), { status: 200 })
      }
      // 判存 GET：返回空（不存在 → POST）
      return new Response(JSON.stringify({ page: 1, totalPages: 1, items: [] }), { status: 200 })
    }) as unknown as typeof fetch
    const adapter = createPocketBaseAdapter({ baseUrl: 'http://127.0.0.1:9999', account: 'u', password: 'p', fetchImpl })
    await adapter.transaction(['customers', 'syncQueue'], async (tx) => {
      await tx.put('customers', {
        id: 'ws-main:cus:new1',
        name: '新建',
        updatedAt: 123,
        rev: 1,
        deleted: 0,
        createdAt: 123,
      } as never)
    })
    expect(bodies).toHaveLength(1)
    const body = bodies[0] as Record<string, unknown>
    expect(body.localId).toBe('ws-main:cus:new1')
    expect(body.id).toBeTypeOf('string')
    expect((body.id as string)).toHaveLength(15)
    expect(body.name).toBe('新建')
    // 本地 id 不进 payload 原样字段（由 localId 镜像 + 哈希派生）
    expect(body.updatedAt).toBe(123)
  })

  it('写路径（P3）：已存在记录走 PATCH', async () => {
    let patchSeen = false
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'tok' }), { status: 200 })
      }
      if (init?.method === 'PATCH') {
        patchSeen = true
        return new Response(JSON.stringify({ id: 'h1' }), { status: 200 })
      }
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'x' }), { status: 200 })
      // 判存 GET：返回已存在（pbHash1）
      return new Response(
        JSON.stringify({ page: 1, totalPages: 1, items: [{ id: 'pbHash1', localId: 'ws-main:cus:ex1' }] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const adapter = createPocketBaseAdapter({ baseUrl: 'http://127.0.0.1:9999', account: 'u', password: 'p', fetchImpl })
    await adapter.transaction(['customers', 'syncQueue'], async (tx) => {
      await tx.put('customers', { id: 'ws-main:cus:ex1', name: '更新', updatedAt: 1, rev: 2, deleted: 0 } as never)
    })
    expect(patchSeen).toBe(true)
  })

  it('put 缺少 id 抛可操作错误', async () => {
    const adapter = createPocketBaseAdapter({ baseUrl: 'http://127.0.0.1:9999', fetchImpl: makeFetch({}).fetchImpl })
    await expect(
      adapter.transaction(['customers', 'syncQueue'], async (tx) => {
        await tx.put('customers', { name: '无 id' } as never)
      }),
    ).rejects.toThrow(/缺少记录 id/)
  })

  it('鉴权失败抛可操作错误（凭据错 → 明确提示，不静默空结果）', async () => {
    const { fetchImpl } = makeFetch({ auth: { status: 400 } })
    await expect(adapterOf(fetchImpl).list('customers')).rejects.toThrow(/鉴权失败/)
  })

  it('匿名读：不配置凭据时不打鉴权端点，直接带空头请求（公开读规则场景）', async () => {
    const { fetchImpl, calls } = makeFetch({
      list: () => ({
        status: 200,
        body: { page: 1, totalPages: 1, items: [{ id: 'h1', localId: 'ws-main:ldg:1', name: '账本' }] },
      }),
    })
    const adapter = createPocketBaseAdapter({
      baseUrl: 'http://127.0.0.1:9999',
      fetchImpl,
    })
    const rows = await adapter.list('ledgers')
    expect(rows).toHaveLength(1)
    // 零鉴权请求：全程未触 auth-with-password
    expect(calls.every((c) => !c.url.includes('auth-with-password'))).toBe(true)
  })

  it('匿名读被 401 拒：可操作错误指向「读规则未公开，需配凭据」', async () => {
    const { fetchImpl } = makeFetch({
      list: () => ({ status: 401, body: {} }),
    })
    const adapter = createPocketBaseAdapter({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })
    await expect(adapter.list('customers')).rejects.toThrow(/未公开/)
  })
})

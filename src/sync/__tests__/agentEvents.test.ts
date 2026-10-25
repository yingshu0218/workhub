import { describe, expect, it, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { eventBus, setEventForwarder, type AppEvent } from '@/shared/eventBus'
import { createPocketBaseAdapter } from '@/storage/pocketbase'
import { drainAgentEvents } from '@/sync/pocketbaseAdapter'

/**
 * P4 agent_events（方案 §5.4-A）：服务端写入产生的事件落 PB，客户端 pull 后 replay。
 * 三段各自锁死：① eventBus 转发器（服务端出口）② pbAdapter.recordEvent（落库）
 * ③ drainAgentEvents（客户端 replay + 游标推进）。
 */

describe('eventBus 转发器（服务端事件出口）', () => {
  beforeEach(() => {
    setEventForwarder(null as unknown as (event: keyof AppEvent, payload: unknown) => void)
  })

  it('未注入转发器：emit 行为与既有完全一致（null 不炸）', () => {
    const seen: unknown[] = []
    const off = eventBus.on('habit:checked', (p) => seen.push(p))
    expect(() => eventBus.emit('habit:checked', { habitId: 'h1', date: '2026-10-15' })).not.toThrow()
    expect(seen).toEqual([{ habitId: 'h1', date: '2026-10-15' }])
    off()
  })

  it('注入转发器：emit 后转发器收到 (event, payload)；转发器抛错不影响本地分发', () => {
    const forwarded: Array<{ event: string; payload: unknown }> = []
    setEventForwarder((event, payload) => {
      forwarded.push({ event, payload })
      if (forwarded.length === 1) throw new Error('转发器首调炸（应被吞）')
    })
    const seen: string[] = []
    const off1 = eventBus.on('habit:checked', () => seen.push('habit:checked'))
    const off2 = eventBus.on('customer:contacted', () => seen.push('customer:contacted'))
    eventBus.emit('habit:checked', { habitId: 'h1', date: 'd1' })
    eventBus.emit('customer:contacted', { customerId: 'c1' })
    expect(seen).toHaveLength(2) // 本地分发不受转发器异常影响
    expect(forwarded.map((f) => f.event)).toEqual(['habit:checked', 'customer:contacted'])
    off1()
    off2()
    setEventForwarder(null as unknown as (event: keyof AppEvent, payload: unknown) => void)
  })
})

describe('pbAdapter.recordEvent（服务端事件落库）', () => {
  it('POST agent_events（type/payload/tool/occurredAt 齐全）', async () => {
    const bodies: unknown[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'tok' }), { status: 200 })
      }
      if (url.pathname.includes('/agent_events') && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ id: 'ev1' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const adapter = createPocketBaseAdapter({ baseUrl: 'http://127.0.0.1:9999', account: 'u', password: 'p', fetchImpl })
    await adapter.recordEvent!('habit:checked', { habitId: 'h1', date: 'd1' }, 'server-executor')
    expect(bodies).toHaveLength(1)
    const body = bodies[0] as Record<string, unknown>
    expect(body.type).toBe('habit:checked')
    expect(body.payload).toEqual({ habitId: 'h1', date: 'd1' })
    expect(body.tool).toBe('server-executor')
    expect(typeof body.occurredAt).toBe('number')
  })

  it('事件落库失败不抛出（写操作本身已成功，评估延迟不丢失）', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/auth-with-password')) {
        return new Response(JSON.stringify({ token: 'tok' }), { status: 200 })
      }
      return new Response('{"message":"nope"}', { status: 400 })
    }) as unknown as typeof fetch
    const adapter = createPocketBaseAdapter({ baseUrl: 'http://127.0.0.1:9999', account: 'u', password: 'p', fetchImpl })
    await expect(adapter.recordEvent!('habit:checked', {}, 'x')).resolves.toBeUndefined()
  })
})

describe('drainAgentEvents（客户端 replay + 游标）', () => {
  it('未配置同步中心：直接返回不报错', async () => {
    await expect(drainAgentEvents()).resolves.toBeUndefined()
  })

  it('replay 白名单（T3 前置）：未知事件名拒发且警告、已知事件正常分发、游标照常推进', async () => {
    const { db } = await import('@/db/db')
    await db.settings.put({
      key: 'singleton',
      sync: { serverUrl: 'http://127.0.0.1:9999', token: 'tok' },
    } as never)
    await db.meta.put({ key: 'agent_events_cursor', value: 0 })

    // 回包混入一条未知事件名（模拟服务端脏数据 / 未来版本事件）与一条已知事件
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            { type: 'trophy:unlocked', payload: { trophyId: 't1' }, occurredAt: 100 },
            { type: 'bogus:future-event', payload: { x: 1 }, occurredAt: 200 },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchImpl)
    const warns: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warns.push(String(a[0]))
    })

    const seen: string[] = []
    const off = eventBus.on('trophy:unlocked', () => seen.push('trophy:unlocked'))
    const offBogus = eventBus.on('bogus:future-event' as keyof AppEvent, () =>
      seen.push('bogus'),
    )
    try {
      await drainAgentEvents()
    } finally {
      vi.unstubAllGlobals()
      off()
      offBogus()
    }

    expect(seen).toEqual(['trophy:unlocked']) // 已知事件分发、未知事件未穿透
    expect(warns.some((w) => w.includes('bogus:future-event'))).toBe(true)
    // 未知事件不卡游标：maxAt 取整批最大值（含被跳过行），下轮不会重复拉取
    expect((await db.meta.get('agent_events_cursor'))?.value).toBe(200)
  })
})

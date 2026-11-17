import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { seedIfEmpty } from '@/db/seed'
import { resetStorageAdapter } from '@/storage'
import { setEventInterceptor } from '@/shared/eventBus'
import { RETIRED_HABIT_TOOLS } from '@/commands/retiredFeatures'
import { dispatchAgentTool, visibleToolNames } from '../executor'
import { initServerExecutor, serverToolsList } from '../serverReads'
import { TOOL_DOMAIN, TOOL_EVENTS, TOOL_RISK } from '../schema'

beforeEach(async () => {
  resetStorageAdapter()
  await Promise.all(db.tables.map(table => table.clear()))
})
afterEach(() => {
  resetStorageAdapter()
  setEventInterceptor(null)
  vi.unstubAllGlobals()
})

describe('退役 Agent 工具', () => {
  it.each(RETIRED_HABIT_TOOLS)('%s 不能被旧白名单重新开启，也不进入任何工具清单', async (name) => {
    expect(visibleToolNames({ habit: true })).not.toContain(name)
    expect(serverToolsList({ habit: true }).map(t => t.name)).not.toContain(name)
    expect(TOOL_RISK[name]).toBeUndefined()
    expect(TOOL_DOMAIN[name]).toBeUndefined()
    expect(TOOL_EVENTS[name]).toBeUndefined()
    const result = await dispatchAgentTool(name, { name: '不能创建', habitId: 'old', undo: true }, { habit: true })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('FEATURE_RETIRED') })
    const server = initServerExecutor({ pb: { baseUrl: 'http://127.0.0.1:59999' }, domains: { habit: true } })
    expect(server.handles(name)).toBe(true)
    expect(await server.callTool(name, {})).toMatchObject({ ok: false, error: expect.stringContaining('FEATURE_RETIRED') })
    expect(await db.habits.count()).toBe(0)
    expect(await db.habitLogs.count()).toBe(0)
  })

  it('历史习惯保持有界只读、显式消解不再指向打卡，搜索不再返回旧路由', async () => {
    await db.habits.bulkPut(Array.from({ length: 51 }, (_, i) => ({
      id: `historic-${i}`, name: `历史习惯-${i}`, category: '历史', schedule: '每日', deleted: 0,
    })) as never)
    const list = await dispatchAgentTool('listHabits', {})
    expect(list.data).toMatchObject({ count: 50, truncated: true })
    const resolved = await dispatchAgentTool('resolveEntity', { query: '历史习惯-0', type: 'habit' })
    expect(JSON.stringify(resolved.data)).toContain('功能已下线')
    const search = await dispatchAgentTool('searchEntities', { q: '历史习惯' })
    expect(search.data).toMatchObject({ count: 0 })
    const todo = await dispatchAgentTool('todo_createTodo', { title: '其它模块仍可写' })
    expect(todo.ok).toBe(true)
  })

  it.each([true, false])('旧请求 committed=%s：仅已提交回执可重放，待确认计划不能再执行', async (committed) => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      expect(url).toMatch(/\/operations\/lookup$/)
      return new Response(JSON.stringify(committed ? {
        committed: true,
        receipt: { operationId: 'old-operation', result: { ok: true, data: { habitId: 'old-habit' } } },
      } : { committed: false, pending: { writes: [{ table: 'habits' }] } }), { status: 200 })
    }))
    const server = initServerExecutor({ pb: { baseUrl: 'http://127.0.0.1:59999' }, domains: { habit: true } })
    const result = await server.callTool('habit_createHabit', { name: '历史请求' }, { requestId: 'prior-request', generation: 'original-generation', confirmToken: 'old-ticket' })
    expect(calls).toHaveLength(1)
    expect(result).toMatchObject(committed
      ? { ok: true, data: { habitId: 'old-habit', operationId: 'old-operation', retrySafe: true } }
      : { ok: false, error: expect.stringContaining('FEATURE_RETIRED') })
  })

  it('新演示库不再播种退役记录，也不会删除已有历史资料', async () => {
    await db.habits.put({ id: 'preserved', name: '原有历史' } as never)
    await seedIfEmpty()
    expect((await db.habits.toArray()).map(row => row.id)).toEqual(['preserved'])
    expect(await db.habitLogs.count()).toBe(0)
    expect(await db.trophies.count()).toBe(0)
    expect(await db.customers.count()).toBeGreaterThan(0)
  })
})

// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/platform/request', () => ({ clientRequest: request }))
import { db } from '@/db/db'
import { activateClientSession, clientSession } from '@/storage/clientSession'
import { applyClientReceipt, publishMirror, MIRROR_CURSOR } from '@/storage/clientMirror'
import { pullClientChanges, startClientSync } from '../clientSync'
let n = 0
beforeEach(() => {
  localStorage.clear()
  request.mockReset()
  activateClientSession('sync-case-' + ++n, 'generation', 6)
})
afterEach(() => vi.useRealTimers())
const row = (id: string, rev: number) => ({ id, name: id, rev, deleted: 0 })
function batch(changes: unknown[] = [], complete = true, nextCursor = 'completed') {
  const s = clientSession()!
  return {
    mode: 'snapshot',
    owner: s.owner,
    generation: s.generation,
    schema: s.schema,
    watermark: 5,
    changes,
    nextCursor,
    complete,
    readCount: changes.length,
  }
}
it('中间页失败不清库、不发布暂存、不推进完成游标', async () => {
  await db.customers.put(row('keep', 3) as never)
  request
    .mockResolvedValueOnce(
      batch([{ table: 'customers', id: 'new', row: row('new', 1) }], false, 'page-1'),
    )
    .mockRejectedValueOnce(new Error('NETWORK_DOWN'))
  await expect(pullClientChanges()).rejects.toThrow('NETWORK_DOWN')
  expect(await db.customers.get('keep')).toBeTruthy()
  expect(await db.customers.get('new')).toBeUndefined()
  expect(await db.meta.get(MIRROR_CURSOR)).toBeUndefined()
  request.mockResolvedValueOnce(batch([{ table: 'customers', id: 'new', row: row('new', 1) }]))
  await pullClientChanges()
  expect(await db.customers.get('keep')).toBeUndefined()
  expect((await db.customers.get('new'))?.rev).toBe(1)
  expect((await db.meta.get(MIRROR_CURSOR))?.value).toBe('completed')
})
it('更高rev、软删和永久清理登记共同阻止旧回执复活', async () => {
  const s = clientSession()!
  await applyClientReceipt({
    generation: s.generation,
    changes: [{ table: 'customers', id: 'a', row: row('a', 3) }],
  })
  await applyClientReceipt({
    generation: s.generation,
    changes: [{ table: 'customers', id: 'a', row: row('a', 2) }],
  })
  expect((await db.customers.get('a'))?.rev).toBe(3)
  await publishMirror(
    [{ table: 'customers', id: 'a', row: { ...row('a', 4), deleted: 1 } }],
    s,
    'c1',
  )
  expect((await db.customers.get('a'))?.deleted).toBe(1)
  await publishMirror([{ table: 'customers', id: 'a', row: null }], s, 'c2')
  await applyClientReceipt({
    generation: s.generation,
    changes: [{ table: 'customers', id: 'a', row: row('a', 99) }],
  })
  expect(await db.customers.get('a')).toBeUndefined()
})
it('空轮询不打断草稿，只有操作水位前进也必须通知待确认列表', async () => {
  const s = clientSession()!,
    changed = vi.fn()
  window.addEventListener('workhub:changed', changed)
  await publishMirror([], s, 'c1')
  expect(changed).toHaveBeenCalledTimes(1)
  await publishMirror([], s, 'c1')
  expect(changed).toHaveBeenCalledTimes(1)
  await db.meta.put({ key: 'query:private', value: { items: [] } })
  await publishMirror([], s, 'c2')
  expect(changed).toHaveBeenCalledTimes(2)
  expect(await db.meta.get('query:private')).toBeUndefined()
  window.removeEventListener('workhub:changed', changed)
})
it('前台恢复触发有界同步，退出后移除所有生命周期和轮询订阅', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  request.mockResolvedValue(batch())
  const stop = startClientSync(100000)
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  await vi.waitFor(() => expect(db.meta.get(MIRROR_CURSOR)).resolves.toBeTruthy())
  window.dispatchEvent(new Event('workhub:resume'))
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  await new Promise((r) => setTimeout(r, 20))
  stop()
  const count = request.mock.calls.length
  for (const name of ['workhub:resume', 'pageshow', 'online']) window.dispatchEvent(new Event(name))
  document.dispatchEvent(new Event('visibilitychange'))
  await new Promise((r) => setTimeout(r, 20))
  expect(request).toHaveBeenCalledTimes(count)
})
it('修复快照保留删除登记，已覆盖水位的晚回执不能复活缺失对象', async () => {
  const s = clientSession()!
  await publishMirror(
    [{ table: 'customers', id: 'purged', row: null }],
    s,
    'before',
    false,
    undefined,
    5,
  )
  await publishMirror([], s, 'repaired', true, undefined, 10)
  expect(await db.meta.get('purged:customers/purged')).toBeTruthy()
  await applyClientReceipt({
    generation: s.generation,
    sequence: 4,
    changes: [{ table: 'customers', id: 'purged', row: row('purged', 99) }],
  })
  await applyClientReceipt({
    generation: s.generation,
    sequence: 9,
    changes: [{ table: 'customers', id: 'absent-in-snapshot', row: row('absent-in-snapshot', 1) }],
  })
  expect(await db.customers.get('purged')).toBeUndefined()
  expect(await db.customers.get('absent-in-snapshot')).toBeUndefined()
  await expect(
    applyClientReceipt({
      generation: s.generation,
      changes: [{ table: 'customers', id: 'unknown-receipt', row: row('unknown-receipt', 1) }],
    }),
  ).rejects.toThrow('RECEIPT_WATERMARK_REQUIRED')
  await applyClientReceipt({
    generation: s.generation,
    sequence: 11,
    changes: [{ table: 'customers', id: 'newer', row: row('newer', 1) }],
  })
  expect(await db.customers.get('newer')).toBeTruthy()
})

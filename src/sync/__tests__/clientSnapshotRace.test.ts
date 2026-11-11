// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import 'fake-indexeddb/auto'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/platform/request', () => ({ clientRequest: request }))
import { db } from '@/db/db'
import { activateClientSession } from '@/storage/clientSession'
import { applyClientReceipt } from '@/storage/clientMirror'
import { pullClientChanges } from '@/sync/clientSync'
it('a delayed snapshot must not undo an already applied later commit receipt', async () => {
  const context = activateClientSession('root-race-owner', 'root-race-generation', 6)
  const id = 'root-race-contact',
    old = { id, name: '旧快照', rev: 1, updatedAt: 1, deleted: 0 },
    current = { ...old, name: '已提交的新事实', rev: 2, updatedAt: 2 }
  let deliver: (value: unknown) => void = () => {},
    started: () => void = () => {}
  const called = new Promise<void>((r) => {
    started = r
  })
  const batch = (row: unknown, watermark: number) => ({
    mode: 'snapshot',
    owner: context.owner,
    generation: context.generation,
    schema: 6,
    protocol: 1,
    watermark,
    changes: [{ table: 'customers', id, row }],
    nextCursor: JSON.stringify({ m: 'delta', q: watermark }),
    complete: true,
    readCount: 1,
  })
  request
    .mockImplementationOnce(() => {
      started()
      return new Promise((r) => {
        deliver = r
      })
    })
    .mockResolvedValue(batch(current, 2))
  const syncing = pullClientChanges(true)
  await called
  await applyClientReceipt({
    generation: context.generation,
    watermark: 2,
    sequence: 2,
    changes: [{ table: 'customers', id, row: current }],
  } as never)
  expect((await db.customers.get(id))?.rev).toBe(2)
  deliver(batch(old, 1))
  try {
    await syncing
  } catch (e) {
    expect(String(e)).toMatch(/STALE|SNAPSHOT|VERSION|RETRY/)
  }
  expect((await db.customers.get(id))?.rev).toBe(2)
  expect((await db.customers.get(id))?.name).toBe('已提交的新事实')
})

// @vitest-environment jsdom
/**
 * 对账的行为锁（2026-10-30）
 *
 * 锁的是「谁该被送进回收站」这条判据，而不是实现：
 *  - 远端没有 + 本地 `synced=1` → 孤儿，进回收站（deleted=1）且写一条批次
 *  - 本地 `synced=0`（还没推上去的真实数据）→ **绝不动**
 *  - 远端存在 → 不动
 *  - 不往同步队列里塞删除（远端本就没有，推了只是噪音）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'

// `vi.mock` 会被提升到 import 之前，所以状态必须用 vi.hoisted 创建，否则 TDZ 报错
const remote = vi.hoisted(() => new Map<string, Set<string>>())
vi.mock('@/sync/pocketbaseAdapter', () => ({
  listRemoteIds: async (table: string) => remote.get(table) ?? new Set<string>(),
}))

import { db } from '@/db/db'
import { reconcileOrphansOnce } from '@/sync/reconcile'

const base = (id: string, synced: number) => ({
  id,
  workspaceId: 'w1',
  name: `客户-${id}`,
  createdAt: 1,
  updatedAt: 1,
  deleted: 0,
  rev: 1,
  synced,
})

describe('对账：孤儿进回收站', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    remote.clear()
  })

  it('远端没有且 synced=1 → 软删进回收站，并写一条「冲突删除」批次', async () => {
    await db.customers.put(base('orphan-1', 1) as never)

    const n = await reconcileOrphansOnce()

    expect(n).toBe(1)
    const row = await db.customers.get('orphan-1')
    expect(row?.deleted).toBe(1)
    expect(row?.deletedAt).toBeGreaterThan(0)
    // 不推同步：远端没有这条，推删除是噪音
    expect(await db.syncQueue.count()).toBe(0)
    // 批次：分组展示要用它
    const batches = await db.trashBatches.toArray()
    expect(batches).toHaveLength(1)
    expect(batches[0].label).toContain('冲突删除')
    expect(batches[0].members).toEqual([{ table: 'customers', id: 'orphan-1' }])
  })

  it('synced=0（待上传）绝不动', async () => {
    await db.customers.put(base('pending-1', 0) as never)

    await reconcileOrphansOnce()

    const row = await db.customers.get('pending-1')
    expect(row?.deleted).toBe(0)
    expect(row?.deletedAt).toBeUndefined()
  })

  it('远端存在的行不动', async () => {
    await db.customers.put(base('kept-1', 1) as never)
    remote.set('customers', new Set(['kept-1']))

    await reconcileOrphansOnce()

    expect((await db.customers.get('kept-1'))?.deleted).toBe(0)
    expect(await db.trashBatches.count()).toBe(0)
  })

  it('只跑一次：完成标记写入后再次调用直接 0', async () => {
    await db.customers.put(base('orphan-2', 1) as never)
    expect(await reconcileOrphansOnce()).toBe(1)
    expect(await reconcileOrphansOnce()).toBe(0)
  })
})

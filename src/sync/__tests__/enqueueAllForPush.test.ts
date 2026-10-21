/**
 * `enqueueAllForPush` 行为锁（审计 P1 补漏 · 2026-10-21）
 *
 * ## 为什么必须有
 *
 * 本轮把这处 `db.transaction` 直写收口为 `storage.transaction` 后，
 * 实测发现它**零行为测试覆盖**（全仓只有源码锁提到过它的名字）。
 * 而它是「首次接入服务器 / 更换服务器」的关键路径 —— 漏推一条记录，
 * 那一批数据就永远同步不上（表现为换设备后「少了一部分数据」，且无任何报错）。
 *
 * 不变量（收口前后都必须成立）：
 * 1. 每条业务记录恰好入队一次（含**墓碑**：软删行也要入队，否则对端删不掉）；
 * 2. `deleted=1` → `op: 'delete'`；否则 `op: 'upsert'`；
 * 3. 返回值 = 入队总数；
 * 4. 不触碰业务表本身（只写 syncQueue，不盖章、不改 updatedAt）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { enqueueAllForPush } from '../pocketbaseAdapter'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('enqueueAllForPush：全量入队不变量', () => {
  it('活记录入 upsert、墓碑入 delete，且各恰好一次', async () => {
    await db.todos.bulkPut(
      [
        { id: 'td1', title: 'A', deleted: 0, rev: 1, updatedAt: 1 },
        { id: 'td2', title: 'B', deleted: 1, rev: 2, updatedAt: 2 }, // 墓碑
      ] as never,
    )
    await db.customers.put({ id: 'cu1', name: 'C', tags: [], deleted: 0, rev: 1, updatedAt: 1 } as never)

    const n = await enqueueAllForPush()
    const q = await db.syncQueue.toArray()

    // 3 条业务记录 → 3 条队列（含墓碑）
    expect(n).toBe(3)
    expect(q).toHaveLength(3)

    const byKey = new Map(q.map((x) => [`${x.table}:${x.recordId}`, x.op]))
    expect(byKey.get('todos:td1')).toBe('upsert')
    expect(byKey.get('todos:td2')).toBe('delete') // 墓碑必须入队
    expect(byKey.get('customers:cu1')).toBe('upsert')

    // 每条恰好一次
    const keys = q.map((x) => `${x.table}:${x.recordId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('不触碰业务表（只写 syncQueue，不盖章、不改 updatedAt）', async () => {
    await db.todos.put({ id: 'td1', title: 'A', deleted: 0, rev: 7, updatedAt: 123 } as never)
    const before = await db.todos.get('td1')

    await enqueueAllForPush()
    const after = await db.todos.get('td1')

    expect(after).toEqual(before) // 记录本身零变化
  })

  it('空库返回 0 且不报错', async () => {
    expect(await enqueueAllForPush()).toBe(0)
    expect(await db.syncQueue.count()).toBe(0)
  })

  it('重复调用会重复入队（语义如此：这是「把当前状态全部排入队列」的动作）', async () => {
    await db.todos.put({ id: 'td1', title: 'A', deleted: 0, rev: 1, updatedAt: 1 } as never)
    expect(await enqueueAllForPush()).toBe(1)
    expect(await enqueueAllForPush()).toBe(1)
    // ⚠️ 刻意不在这里断言「去重」—— 入队去重由 push 侧的幂等 upsert 承担，
    // 本函数职责只是「排入」。若将来改为去重，必须同步改这条断言与调用方预期。
    expect(await db.syncQueue.count()).toBe(2)
  })
})
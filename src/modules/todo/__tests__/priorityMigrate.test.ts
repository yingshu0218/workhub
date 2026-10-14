/**
 * 存量档位显式迁移回归（Issue #148 后续 · 上轮审计建议 4）
 *
 * 为什么要迁移：读侧已能兜住 `P1/P2/P3`（`normalizeTodoPriority`），不缺功能；
 * 迁移的收益是「库里不再同时存在两套档位写法」，消掉口径漂移。
 * 为什么做成**显式动作**而非启动自动：自动改写会推进老记录 `rev/updatedAt`，
 * 破坏跨设备同步的 LWW 判据。本测试同时锁住「幂等」与「不误伤」两条。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { migrateLegacyTodoPriority } from '../backfill'

const base = {
  desc: '',
  status: 'todo' as const,
  createdAt: 1,
  updatedAt: 1,
  deleted: 0 as const,
  rev: 1,
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('待办优先级档位迁移', () => {
  it('只迁移旧档位记录：P1→high / P2→mid，并写入同步队列', async () => {
    await db.todos.bulkPut([
      { id: 'td:p1', title: 'a', priority: 'P1', ...base } as never,
      { id: 'td:p2', title: 'b', priority: 'P2', ...base } as never,
    ])
    expect(await migrateLegacyTodoPriority()).toBe(2)
    expect((await db.todos.get('td:p1'))!.priority).toBe('high')
    expect((await db.todos.get('td:p2'))!.priority).toBe('mid')
    expect(await db.syncQueue.count()).toBe(2)
  })

  it('不动已是新档位的记录（不推 rev、不入队）', async () => {
    await db.todos.put({ id: 'td:new', title: 'c', priority: 'high', ...base } as never)
    expect(await migrateLegacyTodoPriority()).toBe(0)
    expect((await db.todos.get('td:new'))!.rev).toBe(1)
    expect(await db.syncQueue.count()).toBe(0)
  })

  it('已软删记录不参与迁移（不留无主同步任务）', async () => {
    await db.todos.put({
      id: 'td:del',
      title: 'd',
      priority: 'P3',
      ...base,
      deleted: 1,
    } as never)
    expect(await migrateLegacyTodoPriority()).toBe(0)
    expect((await db.todos.get('td:del'))!.priority).toBe('P3')
  })

  it('幂等：连续执行第二次返回 0', async () => {
    await db.todos.put({ id: 'td:p3', title: 'e', priority: 'P3', ...base } as never)
    expect(await migrateLegacyTodoPriority()).toBe(1)
    expect(await migrateLegacyTodoPriority()).toBe(0)
    expect((await db.todos.get('td:p3'))!.priority).toBe('low')
  })
})

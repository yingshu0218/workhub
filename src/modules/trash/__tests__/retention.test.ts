// @vitest-environment jsdom
/**
 * 回收站保留期清扫的行为锁（2026-10-30）
 *
 * 三条判据：
 *  1. 保留期从**设置**读（不是写死 30）—— 7 天设置下，8 天前的清掉、6 天前的保留；
 *  2. 24h 节流生效（第二次调用返回 0）；
 *  3. 本地模式（未配置同步）也要能清 —— 这是它不挂在 `cleanupTombstones` 上的原因。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { DEFAULT_SETTINGS } from '@/db/types'
import { sweepExpiredTrash } from '@/modules/trash/retention'

const DAY = 24 * 3600 * 1000
const now = Date.now()

const tombstone = (id: string, deletedAgoDays: number) => ({
  id,
  workspaceId: 'w1',
  name: `墓碑-${id}`,
  createdAt: now - 40 * DAY,
  updatedAt: now - deletedAgoDays * DAY,
  deleted: 1,
  deletedAt: now - deletedAgoDays * DAY,
  rev: 2,
  synced: 1,
})

describe('回收站到期清扫', () => {
  beforeEach(async () => {
    // ⚠️ 只清用到的表：`db.tables` 会迫使 Dexie 打开全部 20+ 张表，
    // 在 CI/并发下把 worker 启动拖到超时（实测 "Timeout waiting for worker to respond"）。
    await Promise.all([db.customers.clear(), db.todos.clear(), db.settings.clear(), db.meta.clear()])
  })

  it('保留期读设置：7 天设置下清 8 天的、留 6 天的', async () => {
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      security: { ...DEFAULT_SETTINGS.security, trashRetentionDays: 7 },
    })
    await db.customers.put(tombstone('old-8d', 8) as never)
    await db.customers.put(tombstone('fresh-6d', 6) as never)

    const n = await sweepExpiredTrash()

    expect(n).toBe(1)
    expect(await db.customers.get('old-8d')).toBeUndefined()
    expect(await db.customers.get('fresh-6d')).toBeTruthy()
  })

  it('本地模式（未配置同步）也能清', async () => {
    // settings 里 sync.serverUrl 为空 = 未配置同步
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      security: { ...DEFAULT_SETTINGS.security, trashRetentionDays: 7 },
    })
    await db.todos.put({
      id: 'td-old',
      workspaceId: 'w1',
      title: '旧待办',
      status: 'open',
      createdAt: now - 40 * DAY,
      updatedAt: now - 30 * DAY,
      deleted: 1,
      deletedAt: now - 30 * DAY,
      rev: 2,
      synced: 1,
    } as never)

    expect(await sweepExpiredTrash()).toBe(1)
    expect(await db.todos.get('td-old')).toBeUndefined()
  })

  it('24h 节流：第二次调用直接返回 0', async () => {
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      security: { ...DEFAULT_SETTINGS.security, trashRetentionDays: 7 },
    })
    await db.customers.put(tombstone('old-9d', 9) as never)

    expect(await sweepExpiredTrash()).toBe(1)
    await db.customers.put(tombstone('old-10d', 10) as never)
    expect(await sweepExpiredTrash()).toBe(0)
  })
})

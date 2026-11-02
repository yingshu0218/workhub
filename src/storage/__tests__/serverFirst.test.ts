// @vitest-environment jsdom
/**
 * ServerFirstAdapter 的行为锁（2026-11-03）
 *
 * 锁的是「服务端唯一真源」的四条不变式，不是实现细节：
 *  ① 业务表写入**先打服务端**，成功后才落镜像；
 *  ② 服务端判为过期/墓碑（`skipped`）→ **不写镜像**（否则镜像会把服务端的值盖成旧的）；
 *  ③ 服务端失败 → 抛错且不落镜像（离线不该被伪装成成功 —— 这正是本轮要消灭的假象）；
 *  ④ 本地专属表（settings / focusSessions…）不进服务端，直接写镜像。
 *
 * ⚠️ 不用 `vi.mock('@/sync/pocketbaseAdapter')`：那会把同模块被别处使用的
 * `isSyncConfigured` / `pocketBaseAdapter` 一并抹成 undefined，全量并发时拖挂别的用例
 * （2026-10-30 实测 17 分钟无输出）。这里走 `createServerFirstAdapter` 的依赖注入。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { createServerFirstAdapter } from '@/storage/serverFirst'

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  updatedAt: 1,
  deleted: 0,
  rev: 1,
  ...extra,
})

describe('ServerFirstAdapter：写入直达服务端', () => {
  beforeEach(async () => {
    await Promise.all([
      db.customers.clear(),
      db.settings.clear(),
      db.syncQueue.clear(),
    ])
  })

  it('业务表：先写服务端，成功后落镜像', async () => {
    const upsertRemote = vi.fn(async () => 'written' as const)
    const adapter = createServerFirstAdapter({ upsertRemote })

    await adapter.transaction(['customers', 'syncQueue'], (tx) => tx.put('customers', row('c1')))

    expect(upsertRemote).toHaveBeenCalledTimes(1)
    expect(upsertRemote).toHaveBeenCalledWith('customers', expect.objectContaining({ id: 'c1' }))
    expect(await db.customers.get('c1')).toBeTruthy()
  })

  it('服务端判为跳过（远端更新/墓碑）→ 不写镜像', async () => {
    const upsertRemote = vi.fn(async () => 'skipped' as const)
    const adapter = createServerFirstAdapter({ upsertRemote })

    await adapter.transaction(['customers', 'syncQueue'], (tx) => tx.put('customers', row('c2')))

    expect(await db.customers.get('c2')).toBeUndefined()
  })

  it('服务端失败 → 抛错且不落镜像（不许把离线伪装成成功）', async () => {
    const upsertRemote = vi.fn(async () => {
      throw new Error('offline')
    })
    const adapter = createServerFirstAdapter({ upsertRemote })

    await expect(
      adapter.transaction(['customers', 'syncQueue'], (tx) => tx.put('customers', row('c3'))),
    ).rejects.toThrow('offline')
    expect(await db.customers.get('c3')).toBeUndefined()
  })

  it('本地专属表不经过服务端（settings 只在本机）', async () => {
    const upsertRemote = vi.fn(async () => 'written' as const)
    const adapter = createServerFirstAdapter({ upsertRemote })

    // settings 的主键是 key（singleton），不是 id
    await adapter.transaction(['settings'], (tx) =>
      tx.put('settings', { key: 'singleton', theme: 'light' } as never),
    )

    expect(upsertRemote).not.toHaveBeenCalled()
    expect(await db.settings.get('singleton')).toBeTruthy()
  })

  it('enqueue 是 no-op：没有队列可攒', async () => {
    const adapter = createServerFirstAdapter({ upsertRemote: vi.fn(async () => 'written' as const) })

    await adapter.transaction(['customers', 'syncQueue'], (tx) =>
      tx.enqueue('customers', 'c4', 'upsert', Date.now()),
    )

    expect(await db.syncQueue.count()).toBe(0)
  })

  it('delete：先删服务端，再删镜像', async () => {
    await db.customers.put(row('c5') as never)
    const deleteRemote = vi.fn(async () => {})
    const adapter = createServerFirstAdapter({ deleteRemote })

    await adapter.transaction(['customers', 'syncQueue'], (tx) => tx.delete('customers', 'c5'))

    expect(deleteRemote).toHaveBeenCalledWith('customers', 'c5')
    expect(await db.customers.get('c5')).toBeUndefined()
  })

  it('update 不存在的记录 → 抛可操作错误（不许静默成功）', async () => {
    const adapter = createServerFirstAdapter({ upsertRemote: vi.fn(async () => 'written' as const) })

    await expect(
      adapter.transaction(['customers', 'syncQueue'], (tx) => tx.update('customers', 'ghost', { name: 'x' })),
    ).rejects.toThrow('更新不存在的记录')
  })

  it('update 合并 patch 后再整条写服务端（PB 无 patch 语义，必须带全量字段）', async () => {
    await db.customers.put(row('c6', { name: '旧名' }) as never)
    const upsertRemote = vi.fn(async () => 'written' as const)
    const adapter = createServerFirstAdapter({ upsertRemote })

    await adapter.transaction(['customers', 'syncQueue'], (tx) =>
      tx.update('customers', 'c6', { name: '新名' }),
    )

    expect(upsertRemote).toHaveBeenCalledWith(
      'customers',
      expect.objectContaining({ id: 'c6', name: '新名' }),
    )
    expect((await db.customers.get('c6'))?.name).toBe('新名')
  })
})

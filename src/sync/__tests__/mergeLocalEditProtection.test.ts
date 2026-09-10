/**
 * Issue #130 回归：本地未推送编辑不被远端旧数据覆盖
 *
 * 场景（客户关系保存不生效）：
 * 1. A 端在客户详情编辑「客户关系」并保存 → 本地落库 + 入同步队列（尚未推送成功）
 * 2. 同一时刻同步周期先执行 pull，拉回服务端上一条旧记录（updatedAt 更新）
 * 3. 旧实现按 updatedAt 整体覆盖 → 本地 relations 被抹掉，用户看到「保存不生效」
 *
 * 断点：pull 合并阶段「队列中仍有该记录 upsert 时不得整体覆盖本地」，且 relations 按条目并集合并。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { mergeRemoteRecord as mergeRemote } from '../mergeRemote'

function customer(over: Record<string, unknown>) {
  return {
    id: 'c1',
    name: '严伟强',
    company: '深蓝科技',
    title: '采购总监',
    decisionLevel: '决策人',
    tier: 'S',
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: 1,
    createdAt: 1,
    updatedAt: 100,
    deleted: 0 as const,
    rev: 1,
    ...over,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('远端合并：本地未推送编辑保护（Issue #130）', () => {
  it('队列中有未推送 upsert 时，远端旧记录不得抹掉本地刚保存的客户关系', async () => {
    // 本地：用户刚在编辑抽屉保存了 relations（updatedAt=100），队列条目尚未推送成功
    const local = customer({
      relations: [{ id: 'rel-new', targetId: 'c2', label: '转介绍人' }],
    })
    await db.customers.put(local as never)
    await db.syncQueue.add({ table: 'customers', recordId: 'c1', op: 'upsert', createdAt: 100 })

    // 远端：服务端仍是旧版本（无 relations），但 updatedAt 更新（另一台设备的旧写入后到）
    const remote = {
      id: 'pbh1',
      localId: 'c1',
      name: '严伟强',
      company: '深蓝科技',
      tier: 'S',
      tags: JSON.stringify([]),
      lastContactAt: 1,
      createdAt: 1,
      updatedAt: 200,
      deleted: 0,
      rev: 2,
      server_received_at: '2026-09-10 10:00:00.000Z',
    }

    const res = await mergeRemote('customers', remote as never)
    expect(res).toBe('write')

    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    // 本地保存的关系仍在（核心断言：保存不生效的根因）
    expect(after.relations).toEqual([{ id: 'rel-new', targetId: 'c2', label: '转介绍人' }])
    // 本地编辑优先：updatedAt 不被远端旧值推回去，队列条目仍在等待推送
    expect(after.updatedAt).toBe(100)
    expect(await db.syncQueue.filter((q) => q.table === 'customers').count()).toBe(1)
  })

  it('无待推送编辑时，远端记录 relations 与本地取并集，不丢任何一侧条目', async () => {
    await db.customers.put(
      customer({
        updatedAt: 100,
        relations: [{ id: 'rel-local', targetId: 'c9', label: '同行伙伴' }],
      }) as never,
    )

    const res = await mergeRemote(
      'customers',
      {
        id: 'pbh1',
        localId: 'c1',
        name: '严伟强',
        company: '深蓝科技',
        tier: 'S',
        tags: JSON.stringify([]),
        relations: JSON.stringify([{ id: 'rel-remote', targetId: 'c2', label: '项目合作' }]),
        lastContactAt: 1,
        createdAt: 1,
        updatedAt: 300,
        deleted: 0,
        rev: 3,
        server_received_at: '2026-09-10 10:05:00.000Z',
      } as never,
    )
    expect(res).toBe('write')

    const after = (await db.customers.get('c1')) as unknown as { relations: { id: string }[] }
    expect(after.relations.map((r) => r.id)).toEqual(['rel-remote', 'rel-local'])
  })

  it('服务端 Schema 缺 relations 字段时保留本地关系（旧数据不因合并被清空）', async () => {
    await db.customers.put(
      customer({
        updatedAt: 100,
        relations: [{ id: 'rel-local', targetId: 'c2', label: '转介绍人' }],
      }) as never,
    )

    await mergeRemote(
      'customers',
      {
        id: 'pbh1',
        localId: 'c1',
        name: '严伟强',
        company: '深蓝科技',
        tier: 'S',
        tags: JSON.stringify([]),
        lastContactAt: 1,
        createdAt: 1,
        updatedAt: 300,
        deleted: 0,
        rev: 3,
        server_received_at: '2026-09-10 10:05:00.000Z',
      } as never,
    )

    const after = (await db.customers.get('c1')) as unknown as { relations: { id: string }[] }
    expect(after.relations.map((r) => r.id)).toEqual(['rel-local'])
  })
})

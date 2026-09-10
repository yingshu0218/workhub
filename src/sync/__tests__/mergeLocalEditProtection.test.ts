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

describe('远端合并：附件 Blob 还原（抽模块回归防护）', () => {
  it('attachments 表合并时调用注入的下载回调并把 Blob 写回本地', async () => {
    await db.attachments.put({
      id: 'a1',
      refType: 'customer',
      refId: 'c1',
      name: '合同.pdf',
      mime: 'application/pdf',
      size: 12,
      createdAt: 1,
      updatedAt: 100,
      deleted: 0 as const,
      rev: 1,
    } as never)

    const blob = new Blob(['hello'], { type: 'application/pdf' })
    let calledWith = ''
    const res = await mergeRemote(
      'attachments',
      {
        id: 'pbh_a1',
        localId: 'a1',
        refType: 'customer',
        refId: 'c1',
        name: '合同.pdf',
        mime: 'application/pdf',
        size: 12,
        file: 'abc123.pdf',
        createdAt: 1,
        updatedAt: 300,
        deleted: 0,
        rev: 2,
      } as never,
      async (r) => {
        calledWith = String(r.file)
        return blob
      },
    )

    expect(res).toBe('write')
    expect(calledWith).toBe('abc123.pdf')
    const after = (await db.attachments.get('a1')) as unknown as { blob?: Blob }
    expect(after.blob).toBeInstanceOf(Blob)
    expect(await after.blob!.text()).toBe('hello')
  })

  it('非 attachments 表不触发下载回调', async () => {
    await db.customers.put(customer({ updatedAt: 100 }) as never)
    let called = false
    await mergeRemote(
      'customers',
      {
        id: 'pbh1',
        localId: 'c1',
        name: '严伟强',
        updatedAt: 300,
        deleted: 0,
        rev: 2,
      } as never,
      async () => {
        called = true
        return undefined
      },
    )
    expect(called).toBe(false)
  })
})

/**
 * 端到端核验（PR #131 验证）：完整复现 Issue #130 的用户操作序列 ——
 * 打开客户详情 → 编辑客户关系 → 保存 → 随后每一个同步周期 pull。
 * 断言用户保存的关系在整个过程中始终可见（这也是「保存不生效」最直接的验收口径）。
 */
describe('端到端：客户详情编辑客户关系并保存后，关系不再消失（Issue #130）', () => {
  it('保存后遇到的每一次 pull 都不会让关系消失（含服务端缺字段 / 有字段两情形）', async () => {
    // 1. 用户打开客户详情，已有 1 条关系
    await db.customers.put({
      id: 'c1', name: '严伟强', company: '深蓝科技', title: '', decisionLevel: '',
      tier: 'S', tags: [], phone: '', wechat: '', email: '', address: '',
      lastContactAt: 1, createdAt: 1, updatedAt: 50, deleted: 0, rev: 1,
      relations: [{ id: 'rel-old', targetId: 'c2', label: '同行' }],
    } as never)

    // 2. 用户新增一条关系并保存 → 本地落库（updatedAt=100）+ 入同步队列
    const saved = { ...(await db.customers.get('c1'))!, updatedAt: 100,
      relations: [
        { id: 'rel-old', targetId: 'c2', label: '同行' },
        { id: 'rel-new', targetId: 'c3', label: '转介绍人' },
      ] }
    await db.customers.put(saved as never)
    await db.syncQueue.add({ table: 'customers', recordId: 'c1', op: 'upsert', createdAt: 100 })

    // 3. 同步周期先 pull：服务端是旧版本（只有 rel-old），但 updatedAt 更新
    await mergeRemote('customers', {
      id: 'pbh1', localId: 'c1', name: '严伟强', company: '深蓝科技', tier: 'S',
      tags: '[]', relations: JSON.stringify([{ id: 'rel-old', targetId: 'c2', label: '同行' }]),
      lastContactAt: 1, createdAt: 1, updatedAt: 200, deleted: 0, rev: 2,
      server_received_at: 'x',
    } as never)

    let after = (await db.customers.get('c1')) as unknown as { relations: { id: string }[] }
    expect(after.relations.map((r) => r.id).sort()).toEqual(['rel-new', 'rel-old'])

    // 4. 服务端完成升级后，另一台设备又加了一条关系并由远端拉回 → 三方并集
    await db.syncQueue.clear() // 本地已推送成功
    await mergeRemote('customers', {
      id: 'pbh1', localId: 'c1', name: '严伟强', company: '深蓝科技', tier: 'S',
      tags: '[]',
      relations: JSON.stringify([
        { id: 'rel-old', targetId: 'c2', label: '同行' },
        { id: 'rel-phone', targetId: 'c4', label: '电话认识' },
      ]),
      lastContactAt: 1, createdAt: 1, updatedAt: 300, deleted: 0, rev: 3,
      server_received_at: 'y',
    } as never)

    after = (await db.customers.get('c1')) as unknown as { relations: { id: string }[] }
    expect(after.relations.map((r) => r.id).sort()).toEqual(['rel-new', 'rel-old', 'rel-phone'])
  })

  it('保存完推送成功后再 pull，本地关系仍完整（无队列条目情形）', async () => {
    await db.customers.put({
      id: 'c1', name: 'A', tier: 'S', tags: [], relations: [{ id: 'rel-a', targetId: 'c2', label: 'x' }],
      updatedAt: 100, deleted: 0, rev: 1, createdAt: 1, lastContactAt: 1,
    } as never)
    // 服务端已含同上关系（推送成功后的回环），updatedAt 更新
    await mergeRemote('customers', {
      id: 'pbh1', localId: 'c1', name: 'A', tier: 'S', tags: '[]',
      relations: JSON.stringify([{ id: 'rel-a', targetId: 'c2', label: 'x' }]),
      updatedAt: 200, deleted: 0, rev: 2, createdAt: 1, lastContactAt: 1,
    } as never)
    const after = (await db.customers.get('c1')) as unknown as { relations: { id: string }[] }
    expect(after.relations.map((r) => r.id)).toEqual(['rel-a'])
  })

})

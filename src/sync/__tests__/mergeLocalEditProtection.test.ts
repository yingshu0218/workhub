/**
 * Issue #130 回归：本地未推送编辑不被远端旧数据覆盖
 *
 * 场景（客户关系保存不生效）：
 * 1. A 端在客户详情编辑「客户关系」并保存 → 本地落库 + 入同步队列（尚未推送成功）
 * 2. 同一时刻同步周期先执行 pull，拉回服务端上一条旧记录（updatedAt 更新）
 * 3. 旧实现按 updatedAt 整体覆盖 → 本地 relations 被抹掉，用户看到「保存不生效」
 *
 * 断点：pull 合并阶段「队列中仍有该记录 upsert 时不得整体覆盖本地」。
 * relations 并集合并已随关联层 Phase 2（v15）退役：关系是独立 link 记录（各自 LWW +
 * 确定性 id 合流），customers 行的合并动不到 link 表 —— 相关用例改锁「link 不受行合并影响 +
 * 远端旧键派生不与本地 link 冲突」。
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
  it('队列中有未推送 upsert 时，远端旧记录不得抹掉本地刚保存的编辑（tags 承载）', async () => {
    // 本地：用户刚保存（updatedAt=100），队列条目尚未推送成功
    //（relations 已迁 links：行级保护用 tags 承载同一断言语义，关系保护由下方 link 用例锁）
    const local = customer({
      tags: ['本地新标签'],
    })
    await db.customers.put(local as never)
    await db.syncQueue.add({ table: 'customers', recordId: 'c1', op: 'upsert', createdAt: 100 })

    // 远端：服务端仍是旧版本（无 relations），但 updatedAt 更新（另一台设备的旧写入后到）
    const remote = {
      id: 'pbh1',
      localId: 'c1',
      name: '严伟强',
      company: '深蓝科技',
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
    // 本地保存的编辑仍在（核心断言：保存不生效的根因）
    expect(after.tags).toEqual(['本地新标签'])
    // 本地编辑优先：updatedAt 不被远端旧值推回去，队列条目仍在等待推送
    expect(after.updatedAt).toBe(100)
    expect(await db.syncQueue.filter((q) => q.table === 'customers').count()).toBe(1)
  })

  it('无待推送编辑时：远端旧 relations 键派生成 link，与本地 link 各自合流（取代并集）', async () => {
    await db.customers.put(customer({}) as never)
    await db.customers.put({ ...customer({ id: 'c9', name: '同行客户' }) } as never)
    // 本地已有一条关系 link（v15 起关系的本体）
    const { buildLinkId: bl } = await import('@/repositories/linkId')
    const localLinkId = bl(
      { type: 'customers', id: 'c1' },
      { type: 'customers', id: 'c9' },
      'relation',
      { label: '同行伙伴' },
    )
    await db.links.put({
      id: localLinkId, fromType: 'customers', fromId: 'c1', toType: 'customers', toId: 'c9',
      kind: 'relation', meta: { label: '同行伙伴' },
      createdAt: 1, updatedAt: 100, rev: 1, deleted: 0,
    } as never)
    // c2 也须存活（远端旧键派生的端点校验）
    await db.customers.put({ ...customer({ id: 'c2', name: '项目客户' }) } as never)

    const res = await mergeRemote(
      'customers',
      {
        id: 'pbh1',
        localId: 'c1',
        name: '严伟强',
        company: '深蓝科技',
        tags: JSON.stringify([]),
        relations: JSON.stringify([{ targetId: 'c2', label: '项目合作' }]),
        lastContactAt: 1,
        createdAt: 1,
        updatedAt: 300,
        deleted: 0,
        rev: 3,
        server_received_at: '2026-09-10 10:05:00.000Z',
      } as never,
    )
    expect(res).toBe('write')

    // 行剥旧键；本地 link 原样保留 + 远端旧键派生出另一条 link（两条各归各，不覆盖）
    const row = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(row).not.toHaveProperty('relations')
    const { buildLinkId } = await import('@/repositories/linkId')
    const localLink = await db.links.get(localLinkId)
    expect(localLink!.deleted).toBe(0)
    expect(localLink!.updatedAt).toBe(100) // 既有 link 不被派生重复盖章
    const derivedLink = await db.links.get(
      buildLinkId(
        { type: 'customers', id: 'c1' },
        { type: 'customers', id: 'c2' },
        'relation',
        { label: '项目合作' },
      ),
    )
    expect(derivedLink).toMatchObject({ kind: 'relation', deleted: 0 })
    expect(derivedLink!.meta?.label).toBe('项目合作')
  })

  it('服务端缺 relations 字段：本地关系 link 不受行合并影响（关系在独立表，行覆盖不到它）', async () => {
    await db.customers.put(customer({ updatedAt: 100 }) as never)
    const { buildLinkId } = await import('@/repositories/linkId')
    const linkId = buildLinkId(
      { type: 'customers', id: 'c1' },
      { type: 'customers', id: 'c2' },
      'relation',
      { label: '转介绍人' },
    )
    await db.links.put({
      id: linkId, fromType: 'customers', fromId: 'c1', toType: 'customers', toId: 'c2',
      kind: 'relation', meta: { label: '转介绍人' },
      createdAt: 1, updatedAt: 100, rev: 1, deleted: 0,
    } as never)

    await mergeRemote(
      'customers',
      {
        id: 'pbh1',
        localId: 'c1',
        name: '严伟强',
        company: '深蓝科技',
        tags: JSON.stringify([]),
        lastContactAt: 1,
        createdAt: 1,
        updatedAt: 300,
        deleted: 0,
        rev: 3,
        server_received_at: '2026-09-10 10:05:00.000Z',
      } as never,
    )

    const link = (await db.links.get(linkId))!
    expect(link.deleted).toBe(0)
    expect(link.updatedAt).toBe(100) // 行级 LWW 盖不到 link 表（独立记录独立时钟）
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
describe('端到端：客户关系保存后遇到的每一次 pull 都不丢关系（Issue #130 · links 版）', () => {
  /** 播种一条关系 link（模拟保存产物：真实保存走 saveCustomer → syncRelationLinks） */
  async function putRelation(a: string, b: string, label: string, updatedAt = 100) {
    const { buildLinkId } = await import('@/repositories/linkId')
    const id = buildLinkId({ type: 'customers', id: a }, { type: 'customers', id: b }, 'relation', { label })
    await db.links.put({
      id, fromType: 'customers', fromId: a < b ? a : b, toType: 'customers', toId: a < b ? b : a,
      kind: 'relation', meta: { label },
      createdAt: 1, updatedAt, rev: 1, deleted: 0,
    } as never)
    return id
  }

  it('保存后 pull 旧形状远端（带/不带旧键）都不丢本地 link，且旧键派生不冲突', async () => {
    await db.customers.put({
      id: 'c1', name: '严伟强', company: '深蓝科技', title: '', decisionLevel: '',
      tags: [], phone: '', wechat: '', email: '', address: '',
      lastContactAt: 1, createdAt: 1, updatedAt: 50, deleted: 0, rev: 1,
    } as never)
    for (const cid of ['c2', 'c3', 'c4']) {
      await db.customers.put({
        id: cid, name: `客户${cid}`, company: '', title: '', decisionLevel: '',
        tags: [], phone: '', wechat: '', email: '', address: '',
        lastContactAt: 1, createdAt: 1, updatedAt: 50, deleted: 0, rev: 1,
      } as never)
    }

    // 1. 已有一条关系，用户又新增一条并保存（link 各自入队）
    const oldLink = await putRelation('c1', 'c2', '同行', 50)
    const newLink = await putRelation('c1', 'c3', '转介绍人', 100)
    await db.syncQueue.add({ table: 'links', recordId: newLink, op: 'upsert', createdAt: 100 })

    // 2. pull 旧形状远端（relations 旧键只含 rel-old），customers 行 updatedAt 更新
    await mergeRemote('customers', {
      id: 'pbh1', localId: 'c1', name: '严伟强', company: '深蓝科技',
      tags: '[]', relations: JSON.stringify([{ targetId: 'c2', label: '同行' }]),
      lastContactAt: 1, createdAt: 1, updatedAt: 200, deleted: 0, rev: 2,
      server_received_at: 'x',
    } as never)

    // 行剥旧键；本地两条 link 原样不动（同语义旧键派生命中已有 id —— localLink 不重复派生）
    const row = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(row).not.toHaveProperty('relations')
    expect((await db.links.get(oldLink))!.deleted).toBe(0)
    expect((await db.links.get(newLink))!.deleted).toBe(0)
    expect(await db.links.where('kind').equals('relation').count()).toBe(2)

    // 3. 推送成功后再 pull：另一台设备加的关系以旧键形态回来 → 派生第三条 link，三方合流
    await db.syncQueue.clear()
    await mergeRemote('customers', {
      id: 'pbh1', localId: 'c1', name: '严伟强', company: '深蓝科技',
      tags: '[]',
      relations: JSON.stringify([
        { targetId: 'c2', label: '同行' },
        { targetId: 'c4', label: '电话认识' },
      ]),
      lastContactAt: 1, createdAt: 1, updatedAt: 300, deleted: 0, rev: 3,
      server_received_at: 'y',
    } as never)
    expect(await db.links.where('kind').equals('relation').count()).toBe(3)
    expect((await db.links.get(oldLink))!.deleted).toBe(0)
    expect((await db.links.get(newLink))!.deleted).toBe(0)
  })

  it('推送成功后的回环 pull（远端旧键含同语义关系）：派生命中既有 id，不重复不覆盖', async () => {
    await db.customers.put({
      id: 'c1', name: 'A', tags: [], updatedAt: 100, deleted: 0, rev: 1,
      createdAt: 1, lastContactAt: 1,
    } as never)
    await db.customers.put({ id: 'c2', name: 'B', tags: [], updatedAt: 1, deleted: 0, rev: 1, createdAt: 1, lastContactAt: 1 } as never)
    const linkId = await putRelation('c1', 'c2', 'x', 100)
    await mergeRemote('customers', {
      id: 'pbh1', localId: 'c1', name: 'A', tags: '[]',
      relations: JSON.stringify([{ targetId: 'c2', label: 'x' }]),
      updatedAt: 200, deleted: 0, rev: 2, createdAt: 1, lastContactAt: 1,
    } as never)
    const link = (await db.links.get(linkId))!
    expect(link.deleted).toBe(0)
    expect(link.updatedAt).toBe(100) // 派生只在缺失时创建，既有 link 不被重复盖章
  })
})

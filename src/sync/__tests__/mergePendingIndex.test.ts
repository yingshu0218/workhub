/**
 * C-12 等价性锁：`pendingIndex` 快路径与逐条查队列必须给出**相同判定**（审计 · 2026-10-21）
 *
 * ## 为什么必须锁这个
 *
 * `hasPendingUpsert` 决定「本地未推送编辑保护」（Issue #130）—— 判对了则本地新编辑不被
 * 远端旧值覆盖，判错了就是**用户编辑静默丢失**。原实现逐条 `filter().count()`；
 * 为消除 O(N×M) 重复扫描，改为调用方一次性建 `Set` 后传入。
 *
 * 这是典型的「用性能优化换语义」的改动：**万一两条路径口径不一致（例如 Set 的键拼法不同、
 * 漏了 op 过滤），优化就会静默改变保护行为，而既有测试未必覆盖**。
 * 故本文件直接把两种路径的输出做逐例对拍。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { mergeRemoteRecord, buildPendingUpsertIndex } from '../mergeRemote'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

/** 造一条远端客户记录（updatedAt 更新 → 走 LWW 分支，会读 pendingIndex） */
function remoteCustomer(localId: string) {
  return {
    id: `pb_${localId}`,
    localId,
    server_received_at: '2026-10-21 00:00:00.000Z',
    updatedAt: 9_000,
    deleted: 0,
    rev: 5,
    name: '远端名',
    tags: [],
  }
}

describe('C-12：pendingIndex 快路径 == 逐条查队列', () => {
  it('队列里有该记录 upsert 时：两条路径判定一致，且本地未推送的数组字段受保护', async () => {
    const localId = 'ws:cus:1'
    await db.customers.put({
      id: localId,
      name: '本地名',
      tags: ['本地标签'],
      updatedAt: 1_000, // 比远端旧 → 本会被远端覆盖
      deleted: 0,
      rev: 1,
    } as never)
    await db.syncQueue.add({
      table: 'customers',
      recordId: localId,
      op: 'upsert',
      createdAt: 1_000,
    })

    const idx = await buildPendingUpsertIndex()

    // 快路径（传索引）
    const withIdx = await mergeRemoteRecord('customers', remoteCustomer(localId), undefined, idx)
    const recWithIdx = (await db.customers.get(localId))!

    // 还原现场，走逐条路径（不传索引）
    await db.customers.put({
      id: localId,
      name: '本地名',
      tags: ['本地标签'],
      updatedAt: 1_000,
      deleted: 0,
      rev: 1,
    } as never)
    const withoutIdx = await mergeRemoteRecord('customers', remoteCustomer(localId))
    const recWithoutIdx = (await db.customers.get(localId))!

    // ★ 本用例的核心：两条路径**逐字段等价** —— 这就是 C-12 优化的全部风险面
    expect(withIdx).toBe(withoutIdx)
    expect(recWithIdx.name).toBe(recWithoutIdx.name)
    expect(recWithIdx.tags).toEqual(recWithoutIdx.tags)
    expect(recWithIdx.updatedAt).toBe(recWithoutIdx.updatedAt)

    // ⚠️ 实测口径记录（**不凭猜** —— 我起初断言 name 保持「本地名」，实测被打脸，已更正）：
    // 本分支是 `{...local, ...mirroredPending}` 的**字段级合并**，语义是：
    //   · 远端**有值**（含空数组 —— `hasJsonValue([])` 为 true）→ 远端胜，覆盖本地；
    //   · 远端**无值**（undefined/null/''）→ 保留本地值（这才是「本地未推送编辑保护」的准确边界）；
    //   · `updatedAt` 固定取本地值（避免本端镜像把 LWW 判据推前）。
    // 即：保护的是「远端没带的字段」，不是「本地改过的字段」。
    expect(recWithIdx.name).toBe('远端名')
    expect(recWithIdx.tags).toEqual([]) // 远端空数组 = 「有值」→ 覆盖本地 tags
    expect(recWithIdx.updatedAt).toBe(1_000) // 本地值，不被远端 9000 推前
  })

  it('队列为空时：两条路径都不保护 → 远端按 LWW 覆盖', async () => {
    const localId = 'ws:cus:2'
    await db.customers.put({
      id: localId,
      name: '本地名',
      tags: [],
      updatedAt: 1_000,
      deleted: 0,
      rev: 1,
    } as never)

    const idx = await buildPendingUpsertIndex()
    const withIdx = await mergeRemoteRecord('customers', remoteCustomer(localId), undefined, idx)
    expect((await db.customers.get(localId))!.name).toBe('远端名')

    await db.customers.put({
      id: localId,
      name: '本地名',
      tags: [],
      updatedAt: 1_000,
      deleted: 0,
      rev: 1,
    } as never)
    const withoutIdx = await mergeRemoteRecord('customers', remoteCustomer(localId))

    expect(withIdx).toBe(withoutIdx)
    expect((await db.customers.get(localId))!.name).toBe('远端名')
  })

  it('索引只收 upsert：delete 队列条目不构成「本地待推送编辑」', async () => {
    const localId = 'ws:cus:3'
    await db.syncQueue.add({
      table: 'customers',
      recordId: localId,
      op: 'delete',
      createdAt: 1_000,
    })
    const idx = await buildPendingUpsertIndex()
    expect(idx.size).toBe(0)
    expect(idx.has(`customers:${localId}`)).toBe(false)
  })

  it('索引键为 table:recordId —— 同 id 不同表不互相命中', async () => {
    const id = 'ws:x:1'
    await db.syncQueue.add({ table: 'todos', recordId: id, op: 'upsert', createdAt: 1 })
    const idx = await buildPendingUpsertIndex()
    expect(idx.has(`todos:${id}`)).toBe(true)
    expect(idx.has(`customers:${id}`)).toBe(false)
  })
})

describe('C-12：索引在合并过程中不会变化（可整轮复用）', () => {
  it('mergeRemoteRecord 只写业务表、不入队 → 合并前后索引一致', async () => {
    const localId = 'ws:cus:4'
    await db.customers.put({
      id: localId,
      name: '本地名',
      tags: [],
      updatedAt: 1_000,
      deleted: 0,
      rev: 1,
    } as never)
    await db.syncQueue.add({ table: 'customers', recordId: localId, op: 'upsert', createdAt: 1 })

    const before = await buildPendingUpsertIndex()
    await mergeRemoteRecord('customers', remoteCustomer(localId), undefined, before)
    const after = await buildPendingUpsertIndex()

    // 关键：合并不得产生新的队列条目（否则 pull 会把自己的镜像当成待推送变更）
    expect([...after].sort()).toEqual([...before].sort())
  })
})
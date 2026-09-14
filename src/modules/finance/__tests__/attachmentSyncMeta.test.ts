/**
 * 附件同步语义回归（P2 #1）
 *
 * 缺陷形状：`attachments` 是**有同步行为、却没有同步元数据类型**的孤例 ——
 * 它早在 v1 就在 `SYNC_TABLES` 里、服务端集合（`pb_setup/collections.json`）也一直带
 * `updatedAt`(required) / `deleted` / `rev`、写入路径运行时确实在盖这些字段，
 * 但前端**类型没声明**（靠 `as Attachment & Partial<SyncMeta>` 绕过）、**索引也没建**
 * （只有 `id, refType, refId, createdAt`）。于是「跨设备 LWW 与软删」只在约定层面成立：
 *   · 类型层面：任何新增写入点漏盖章都不会被编译器拦住；
 *   · 查询层面：`updatedAt` 不进索引，按时间游标/回溯的写法无处可依；
 *   · 语义层面：读取侧直查 `refId`、**不过滤 `deleted`**，已删存根会跟着活记录一起返回。
 *
 * 本测试锁五条：
 *   ① Dexie schema 里 attachments 有 `updatedAt` 索引（v12），且类型确实带 SyncMeta；
 *   ② 经仓储写入即盖章（updatedAt/rev/deleted）并同事务入同步队列；
 *   ③ 软删是**墓碑**：记录仍留库（跨设备可传播）、但读取路径不再返回、计数不再包含；
 *   ④ 存量记录（缺 updatedAt/deleted）按「未删除」处理，不因缺字段被判成已删；
 *   ⑤ 远端删除可经 LWW 正确落到本地（updatedAt 更新者胜），过期远端不覆盖本地。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import type { Attachment } from '@/db/db'
import type { PutInput } from '@/repositories/repository'
import { attachmentRepo } from '@/repositories'
import { mergeRemoteRecord } from '@/sync/mergeRemote'
import { countAttachments, deleteTransactionCascade, listTransactionAttachments } from '../hooks'

const REF = 'txn-1'

/** 一份「已盖章」的完整附件记录（仓储读路径返回的形状） */
const seeded = (id: string, extra: Partial<Attachment> = {}): Attachment => ({
  id,
  refType: 'transaction',
  refId: REF,
  name: `${id}.png`,
  mime: 'image/png',
  size: 3,
  blob: new Blob(['abc'], { type: 'image/png' }),
  createdAt: 1000,
  updatedAt: 1000,
  rev: 1,
  deleted: 0,
  ...extra,
})

/** 一份「未盖章」的写入入参（新建附件时的形状） */
const input = (id: string): PutInput<Attachment> => ({
  id,
  refType: 'transaction',
  refId: REF,
  name: `${id}.png`,
  mime: 'image/png',
  size: 3,
  blob: new Blob(['abc'], { type: 'image/png' }),
  createdAt: 1000,
})

beforeEach(async () => {
  await db.attachments.clear()
  await db.transactions.clear()
  await db.syncQueue.clear()
})

describe('① schema 与类型：附件已正式带同步元数据', () => {
  it('attachments 建了 updatedAt 索引（v12 起），refId / createdAt 仍在', () => {
    const idx = db.attachments.schema.indexes.map((i) => i.name)
    expect(idx).toContain('updatedAt')
    expect(idx).toContain('refId')
    expect(idx).toContain('createdAt')
    expect(db.verno).toBeGreaterThanOrEqual(12)
  })

  it('类型层面已声明 SyncMeta（编译期断言：缺字段即报错）', () => {
    // 若 Attachment 不 extends SyncMeta，下面的解构与赋值都无法通过 tsc
    const a: Attachment = seeded('a1')
    const meta: { updatedAt: number; deleted: 0 | 1; rev: number } = {
      updatedAt: a.updatedAt,
      deleted: a.deleted,
      rev: a.rev,
    }
    expect(meta.updatedAt).toBe(1000)
    expect(meta.deleted).toBe(0)
    expect(meta.rev).toBe(1)
  })
})

describe('② 仓储写入：盖章 + 入同步队列', () => {
  it('经 attachmentRepo.put 写入即盖 updatedAt/rev/deleted，并入队 upsert', async () => {
    await attachmentRepo.put(input('a1'))
    const rec = (await db.attachments.get('a1')) as Attachment
    expect(rec.updatedAt).toBeGreaterThan(0)
    expect(rec.rev).toBe(1)
    expect(rec.deleted).toBe(0)

    const q = await db.syncQueue.toArray()
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ table: 'attachments', recordId: 'a1', op: 'upsert' })
  })
})

describe('③ 软删是墓碑，但读取路径必须过滤', () => {
  it('软删后记录仍在库、rev 递增，读取与计数都不再包含它', async () => {
    await db.attachments.bulkPut([seeded('a1'), seeded('a2', { updatedAt: 1001 })])
    await db.syncQueue.clear()

    expect(await countAttachments(REF)).toBe(2)
    expect((await listTransactionAttachments(REF)).map((a) => a.id).sort()).toEqual(['a1', 'a2'])

    await attachmentRepo.softDelete('a1')

    const tomb = (await db.attachments.get('a1')) as Attachment
    expect(tomb.deleted).toBe(1) // 墓碑仍在库（跨设备传播删除的依据）
    expect(tomb.rev).toBe(2)
    expect(tomb.updatedAt).toBeGreaterThan(1000)

    expect(await countAttachments(REF)).toBe(1)
    expect((await listTransactionAttachments(REF)).map((a) => a.id)).toEqual(['a2'])
    expect((await db.syncQueue.toArray())[0]).toMatchObject({
      table: 'attachments',
      recordId: 'a1',
      op: 'delete',
    })
  })

  it('库存层（attachmentRepo.list/get）同样不返回已删附件', async () => {
    await db.attachments.bulkPut([seeded('a1'), seeded('a2')])
    await attachmentRepo.softDelete('a1')
    expect((await attachmentRepo.list()).map((a) => a.id)).toEqual(['a2'])
    expect(await attachmentRepo.get('a1')).toBeUndefined()
  })

  it('级联删除交易时，其附件一并软删并各自入队（跨设备才会真删）', async () => {
    await db.transactions.put({
      id: REF,
      ledgerId: 'l1',
      type: 'expense',
      amount: 100,
      summary: '晚饭',
      channel: '微信',
      occurredAt: 1,
      tags: [],
      status: '已结算',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    await db.attachments.bulkPut([seeded('a1'), seeded('a2')])
    await db.syncQueue.clear()

    await deleteTransactionCascade(REF)

    const all = (await db.attachments.toArray()) as Attachment[]
    expect(all.every((a) => a.deleted === 1)).toBe(true)
    expect(await countAttachments(REF)).toBe(0)
    const queues = await db.syncQueue.toArray()
    expect(queues.filter((q) => q.table === 'attachments' && q.op === 'delete')).toHaveLength(2)
  })
})

describe('④ 存量记录缺同步字段时不被误判为已删', () => {
  it('直接落库的老记录（无 updatedAt/deleted/rev）仍算存活', async () => {
    await db.attachments.put({
      id: 'legacy',
      refType: 'transaction',
      refId: REF,
      name: 'old.png',
      mime: 'image/png',
      size: 3,
      blob: new Blob(['abc'], { type: 'image/png' }),
      createdAt: 1,
    } as never)

    expect((await listTransactionAttachments(REF)).map((a) => a.id)).toEqual(['legacy'])
    expect(await countAttachments(REF)).toBe(1)
  })
})

describe('⑤ 远端合并：LWW 与远端删除', () => {
  it('远端 updatedAt 更新 → 覆盖本地（含 deleted 墓碑），且读取路径随之过滤', async () => {
    await db.attachments.put(seeded('a1', { updatedAt: 100, rev: 1 }))

    const res = await mergeRemoteRecord('attachments', {
      id: 'pbh_a1',
      localId: 'a1',
      refType: 'transaction',
      refId: REF,
      name: 'a1.png',
      mime: 'image/png',
      size: 3,
      file: 'abc.png',
      createdAt: 1000,
      updatedAt: 300,
      deleted: 1,
      rev: 2,
    })

    expect(res).toBe('write')
    const local = (await db.attachments.get('a1')) as Attachment
    expect(local.deleted).toBe(1)
    expect(local.updatedAt).toBe(300)
    expect(await countAttachments(REF)).toBe(0)
  })

  it('过期远端（updatedAt 更旧）不覆盖本地，返回 skip', async () => {
    await db.attachments.put(seeded('a1', { updatedAt: 500, rev: 3 }))

    const res = await mergeRemoteRecord('attachments', {
      id: 'pbh_a1',
      localId: 'a1',
      refType: 'transaction',
      refId: REF,
      name: 'stale.png',
      mime: 'image/png',
      size: 3,
      createdAt: 1000,
      updatedAt: 200,
      deleted: 0,
      rev: 1,
    })

    expect(res).toBe('skip')
    const local = (await db.attachments.get('a1')) as Attachment
    expect(local.name).toBe('a1.png')
    expect(local.updatedAt).toBe(500)
    expect(local.deleted).toBe(0)
  })
})

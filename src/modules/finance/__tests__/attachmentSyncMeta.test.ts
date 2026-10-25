/**
 * 附件同步语义回归（P2 #1 + 关联层 Phase 2）
 *
 * 缺陷形状：`attachments` 是**有同步行为、却没有同步元数据类型**的孤例 ——
 * 它早在 v1 就在 `SYNC_TABLES` 里、服务端集合（`pb_setup/collections.json`）也一直带
 * `updatedAt`(required) / `deleted` / `rev`、写入路径运行时确实在盖这些字段，
 * 但前端**类型没声明**（靠 `as Attachment & Partial<SyncMeta>` 绕过）、**索引也没建**。
 * 于是「跨设备 LWW 与软删」只在约定层面成立。
 *
 * 关联层 Phase 2（v15）后归属走 links（kind='attachment'，from=流水）：
 * 本文件的读写断言全部改为「附件行 + 归属 link」双件套，并新增两条锁：
 *   ⑥ mergeRemote 对远端残留的 refType/refId 旧键**先派生 link 再剥键**
 *     （服务端旧列永不清除 —— PATCH 不带键就不删列，pull 侧必须兜住）；
 *   ⑦ 索引面：refType/refId 索引随迁移退场，updatedAt/createdAt 保留。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import type { Attachment } from '@/db/db'
import type { PutInput } from '@/repositories/repository'
import { attachmentRepo } from '@/repositories'
import { buildLinkId } from '@/repositories/linkId'
import { mergeRemoteRecord } from '@/sync/mergeRemote'
import { countAttachments, deleteTransactionCascade, listTransactionAttachments } from '../hooks'

const REF = 'txn-1'

/** 一份「已盖章」的完整附件记录（仓储读路径返回的形状） */
const seeded = (id: string, extra: Partial<Attachment> = {}): Attachment => ({
  id,
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
  name: `${id}.png`,
  mime: 'image/png',
  size: 3,
  blob: new Blob(['abc'], { type: 'image/png' }),
  createdAt: 1000,
})

/** 建 REF→附件 的归属 link（v15 起读路径走 links；派生行口径：updatedAt:0/rev:0） */
async function seedAttLink(attId: string): Promise<void> {
  await db.links.put({
    id: buildLinkId({ type: 'transactions', id: REF }, { type: 'attachments', id: attId }, 'attachment'),
    fromType: 'transactions',
    fromId: REF,
    toType: 'attachments',
    toId: attId,
    kind: 'attachment',
    createdAt: 1000,
    updatedAt: 0,
    rev: 0,
    deleted: 0,
  } as never)
}

beforeEach(async () => {
  await db.attachments.clear()
  await db.transactions.clear()
  await db.links.clear()
  await db.syncQueue.clear()
})

describe('① schema 与类型：附件已正式带同步元数据', () => {
  it('attachments 建了 updatedAt 索引；归属旧索引（refType/refId）随 v15 迁移退场', () => {
    const idx = db.attachments.schema.indexes.map((i) => i.name)
    expect(idx).toContain('updatedAt')
    expect(idx).toContain('createdAt')
    // 归属已迁 links：旧索引不再建（读归属一律走 links 复合索引）
    expect(idx).not.toContain('refType')
    expect(idx).not.toContain('refId')
    expect(db.verno).toBeGreaterThanOrEqual(15)
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
    await seedAttLink('a1')
    await seedAttLink('a2')
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
    await seedAttLink('a1')
    await seedAttLink('a2')
    await db.syncQueue.clear()

    await deleteTransactionCascade(REF)

    const all = (await db.attachments.toArray()) as Attachment[]
    expect(all.every((a) => a.deleted === 1)).toBe(true)
    expect(await countAttachments(REF)).toBe(0)
    const queues = await db.syncQueue.toArray()
    expect(queues.filter((q) => q.table === 'attachments' && q.op === 'delete')).toHaveLength(2)
    // 归属 link 一并墓碑化（cascade 钩子），并随恢复复活（R2 语义）
    const linkRows = await db.links.toArray()
    expect(linkRows).toHaveLength(2)
    expect(linkRows.every((l) => l.deleted === 1)).toBe(true)
  })
})

describe('④ 存量记录缺同步字段时不被误判为已删', () => {
  it('直接落库的老记录（无 updatedAt/deleted/rev）仍算存活', async () => {
    await db.attachments.put({
      id: 'legacy',
      name: 'old.png',
      mime: 'image/png',
      size: 3,
      blob: new Blob(['abc'], { type: 'image/png' }),
      createdAt: 1,
    } as never)
    await seedAttLink('legacy')

    expect((await listTransactionAttachments(REF)).map((a) => a.id)).toEqual(['legacy'])
    expect(await countAttachments(REF)).toBe(1)
  })
})

describe('⑤ 远端合并：LWW 与远端删除', () => {
  it('远端 updatedAt 更新 → 覆盖本地（含 deleted 墓碑）', async () => {
    await db.attachments.put(seeded('a1', { updatedAt: 100, rev: 1 }))

    const res = await mergeRemoteRecord('attachments', {
      id: 'pbh_a1',
      localId: 'a1',
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
  })

  it('过期远端（updatedAt 更旧）不覆盖本地，返回 skip', async () => {
    await db.attachments.put(seeded('a1', { updatedAt: 500, rev: 3 }))

    const res = await mergeRemoteRecord('attachments', {
      id: 'pbh_a1',
      localId: 'a1',
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

describe('⑥ 关联层 Phase 2：远端旧键（refType/refId）先派生 link 再剥键', () => {
  it('远端残留旧键 → 本地落库行不带旧键，归属派生成 link（端点存活才派生）', async () => {
    // 宿主流水在本地存活 → 派生 link
    await db.transactions.put({
      id: REF,
      ledgerId: 'l1',
      type: 'expense',
      amount: 1,
      summary: 's',
      channel: '微信',
      occurredAt: 1,
      tags: [],
      status: '已结算',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)

    const res = await mergeRemoteRecord('attachments', {
      id: 'pbh_a9',
      localId: 'a9',
      refType: 'transaction',
      refId: REF,
      name: 'a9.png',
      mime: 'image/png',
      size: 3,
      createdAt: 1000,
      updatedAt: 300,
      deleted: 0,
      rev: 2,
    })
    expect(res).toBe('write')

    const local = (await db.attachments.get('a9')) as unknown as Record<string, unknown>
    expect(local).not.toHaveProperty('refType')
    expect(local).not.toHaveProperty('refId')

    const linkId = buildLinkId(
      { type: 'transactions', id: REF },
      { type: 'attachments', id: 'a9' },
      'attachment',
    )
    const link = await db.links.get(linkId)
    expect(link).toMatchObject({ kind: 'attachment', fromId: REF, toId: 'a9', deleted: 0 })
    // 派生行最低优先级戳：远端真实 link 记录一到即按 LWW 胜出
    expect(link!.updatedAt).toBe(0)
    expect(link!.rev).toBe(0)
    expect(await countAttachments(REF)).toBe(1)
  })

  it('宿主不存在 → 不派生（悬挂归属不迁移成 link）', async () => {
    await mergeRemoteRecord('attachments', {
      id: 'pbh_a10',
      localId: 'a10',
      refType: 'transaction',
      refId: 'ghost-txn',
      name: 'a10.png',
      mime: 'image/png',
      size: 3,
      createdAt: 1000,
      updatedAt: 300,
      deleted: 0,
      rev: 2,
    })
    expect(await db.links.count()).toBe(0)
    const local = (await db.attachments.get('a10')) as unknown as Record<string, unknown>
    expect(local).not.toHaveProperty('refId')
  })
})

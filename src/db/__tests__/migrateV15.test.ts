/**
 * 关联层 Phase 2 · v15 迁移锁：旧关联字段 → links 记录
 *
 * 与 migrateV11.test.ts 的差别：迁移体不再「复刻一份」，而是直接调用
 * `legacyLinkMigration.ts#migrateLegacyLinks`（db.ts 的 version(15).upgrade 与本测试
 * 共用同一实现 —— 单一事实源，改实现必然同步改测试语义）。
 *
 * 迁移族随 Phase 2 逐族扩大（MIGRATED_LINK_TABLES）；本文件按族分 describe，
 * attachments 是首族。锁的口径：
 * 1. 旧关联翻成 link（确定性 id、from/to 方向、kind）；
 * 2. 派生行盖 updatedAt:0 / rev:0 最低优先级戳、不入同步队列；
 * 3. 端点已删/缺失的旧关联跳过（语义上已解绑）；
 * 4. 旧键就地清掉（双写不双读）；
 * 5. 幂等：重复执行不重复派生。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { migrateLegacyLinks } from '../legacyLinkMigration'
import { buildLinkId } from '@/repositories/linkId'

const tableOf = (name: string) => db.table(name) as never

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function seedTxn(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await db.transactions.put({
    id,
    ledgerId: 'l1',
    type: 'expense',
    amount: 1,
    summary: 's',
    channel: '微信',
    occurredAt: 1,
    tags: [],
    status: '已结算',
    createdAt: 5,
    updatedAt: 5,
    deleted: 0,
    rev: 1,
    ...over,
  } as never)
}

async function seedAtt(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await db.attachments.put({
    id,
    name: `${id}.png`,
    mime: 'image/png',
    size: 3,
    blob: new Blob(['abc'], { type: 'image/png' }),
    createdAt: 9,
    ...over,
  } as never)
}

describe('v15 · attachments 族：附件归属 → kind=attachment link', () => {
  it('refType/refId 翻成 link（from=流水），旧键清掉，派生行零戳不入队', async () => {
    await seedTxn('t1')
    await seedAtt('a1', { refType: 'transaction', refId: 't1' })

    const derived = await migrateLegacyLinks(tableOf)
    expect(derived).toBe(1)

    const att = (await db.attachments.get('a1')) as unknown as Record<string, unknown>
    expect(att).not.toHaveProperty('refType')
    expect(att).not.toHaveProperty('refId')

    const linkId = buildLinkId(
      { type: 'transactions', id: 't1' },
      { type: 'attachments', id: 'a1' },
      'attachment',
    )
    const link = await db.links.get(linkId)
    expect(link).toMatchObject({
      kind: 'attachment',
      fromType: 'transactions',
      fromId: 't1',
      toType: 'attachments',
      toId: 'a1',
      deleted: 0,
    })
    // 派生行：最低优先级戳（远端真实 link 一到即胜）+ 沿用附件 createdAt
    expect(link!.updatedAt).toBe(0)
    expect(link!.rev).toBe(0)
    expect(link!.createdAt).toBe(9)
    // 不入同步队列：多端各自派生靠确定性 id 合流，不推服务端
    expect(await db.syncQueue.count()).toBe(0)
  })

  it('宿主流水已软删 → 归属跳过（语义上已解绑），旧键仍清', async () => {
    await seedTxn('t2', { deleted: 1 })
    await seedAtt('a2', { refType: 'transaction', refId: 't2' })

    const derived = await migrateLegacyLinks(tableOf)
    expect(derived).toBe(0)
    expect(await db.links.count()).toBe(0)
    expect((await db.attachments.get('a2')) as unknown as Record<string, unknown>).not.toHaveProperty('refId')
  })

  it('非 transaction 的 refType（历史多态预留、全仓无写入方）不迁移', async () => {
    await seedAtt('a3', { refType: 'customer', refId: 'c1' })
    expect(await migrateLegacyLinks(tableOf)).toBe(0)
    expect(await db.links.count()).toBe(0)
  })

  it('幂等：重复执行不重复派生', async () => {
    await seedTxn('t1')
    await seedAtt('a1', { refType: 'transaction', refId: 't1' })
    expect(await migrateLegacyLinks(tableOf)).toBe(1)
    expect(await migrateLegacyLinks(tableOf)).toBe(0)
    expect(await db.links.count()).toBe(1)
  })
})

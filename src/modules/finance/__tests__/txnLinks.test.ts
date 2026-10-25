/**
 * 交易多关联 · 关联层 Phase 2（v15）行为锁
 *
 * Issue #140 的「数组口径」已随 v15 迁往 links（kind='related'，from=流水）。
 * 本文件锁四组新语义（原「数组读写器 + normalizeTxnLinks」路径已整体退役）：
 *
 * 1. **读侧索引**：groupTxnLinks 按 toType 分桶、过滤墓碑；txnLinksOf 缺省空集；
 * 2. **写入纪律**：pruneTxnLinkIds 去重 + 丢弃已删实体（弱引用语义不变）；
 * 3. **pull 侧归一化**：远端残留的旧数组/旧单值键 → 剥键 + 派生 related link
 *    （服务端旧列永不清除 —— PATCH 不带键就不删列；端点存活才派生）；
 * 4. **级联解绑**：删客户/项目 → 指向它的 related link 墓碑化、其它目标保留。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import type { Link } from '@/db/types'
import { groupTxnLinks, pruneTxnLinkIds, txnLinksOf } from '../links'
import { deleteCustomerCascade, saveTransactionWithAttachments } from '@/repositories'
import { buildLinkId } from '@/repositories/linkId'
import { mergeRemoteRecord } from '@/sync/mergeRemote'

function txn(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    ledgerId: 'l1',
    type: 'expense' as const,
    amount: 100,
    summary: '测试流水',
    channel: '微信',
    occurredAt: 1_700_000_000_000,
    tags: [],
    status: '待对账' as const,
    updatedAt: 100,
    deleted: 0 as const,
    rev: 1,
    ...over,
  }
}

function customer(id: string) {
  return {
    id,
    name: `客户${id}`,
    company: '',
    title: '',
    decisionLevel: '决策人' as const,
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  }
}

/** 播种一条 related link（派生行口径：updatedAt:0/rev:0） */
async function seedRelated(txnId: string, toType: 'customers' | 'todos' | 'projects', toId: string) {
  await db.links.put({
    id: buildLinkId({ type: 'transactions', id: txnId }, { type: toType, id: toId }, 'related'),
    fromType: 'transactions',
    fromId: txnId,
    toType,
    toId,
    kind: 'related',
    createdAt: 1,
    updatedAt: 0,
    rev: 0,
    deleted: 0,
  } as never)
}

async function relatedIndex(): Promise<Map<string, ReturnType<typeof txnLinksOf>>> {
  return groupTxnLinks(await db.links.where('kind').equals('related').toArray())
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('1. 读侧索引：groupTxnLinks / txnLinksOf', () => {
  it('按 toType 分桶；墓碑 link 不进索引；缺省空集', async () => {
    await db.transactions.put(txn() as never)
    await seedRelated('t1', 'customers', 'c1')
    await seedRelated('t1', 'customers', 'c2')
    await seedRelated('t1', 'todos', 'td1')
    // 墓碑：软删一条 customer 关联
    const c2Id = buildLinkId(
      { type: 'transactions', id: 't1' },
      { type: 'customers', id: 'c2' },
      'related',
    )
    await db.links.update(c2Id, { deleted: 1, deletedAt: 1 })

    const index = await relatedIndex()
    expect(txnLinksOf(index, 't1')).toEqual({
      customerIds: ['c1'],
      todoIds: ['td1'],
      projectIds: [],
    })
    expect(txnLinksOf(index, 'nope')).toEqual({ customerIds: [], todoIds: [], projectIds: [] })
  })
})

describe('2. 写入纪律：pruneTxnLinkIds', () => {
  it('去重 + 丢弃已删实体 id（弱引用：解绑不报错）', () => {
    expect(pruneTxnLinkIds(['c1', 'c2', 'c2'], new Set(['c1']))).toEqual(['c1'])
  })
})

describe('3. pull 侧归一化：旧键剥除 + 派生 link', () => {
  it('远端残留旧数组键 → 本地行不带旧键，关联派生成 related link', async () => {
    await db.customers.put(customer('c1') as never)
    await db.transactions.put(txn() as never)

    const res = await mergeRemoteRecord('transactions', {
      id: 'pb1',
      localId: 't1',
      summary: '远端编辑',
      customerIds: JSON.stringify(['c1']),
      updatedAt: 200,
      deleted: 0,
      rev: 5,
    } as never)
    expect(res).toBe('write')

    const row = (await db.transactions.get('t1')) as unknown as Record<string, unknown>
    expect(row).not.toHaveProperty('customerIds')
    expect(row.summary).toBe('远端编辑')

    const link = await db.links.get(
      buildLinkId({ type: 'transactions', id: 't1' }, { type: 'customers', id: 'c1' }, 'related'),
    )
    expect(link).toMatchObject({ kind: 'related', deleted: 0, updatedAt: 0, rev: 0 })
  })

  it('目标实体不存在 → 不派生（悬挂关联不迁移成 link）', async () => {
    await db.transactions.put(txn() as never)
    await mergeRemoteRecord('transactions', {
      id: 'pb2',
      localId: 't1',
      summary: '幽灵关联',
      customerIds: JSON.stringify(['ghost']),
      updatedAt: 300,
      deleted: 0,
      rev: 6,
    } as never)
    expect(await db.links.count()).toBe(0)
  })

  it('本地已有同语义 link（含墓碑）→ 派生不动它', async () => {
    await db.customers.put(customer('c1') as never)
    await db.transactions.put(txn() as never)
    const linkId = buildLinkId(
      { type: 'transactions', id: 't1' },
      { type: 'customers', id: 'c1' },
      'related',
    )
    // 本地已是墓碑（用户曾显式解绑）：远端旧键不得复活它
    await db.links.put({
      id: linkId,
      fromType: 'transactions',
      fromId: 't1',
      toType: 'customers',
      toId: 'c1',
      kind: 'related',
      createdAt: 1,
      updatedAt: 500,
      rev: 2,
      deleted: 1,
      deletedAt: 500,
    } as never)

    await mergeRemoteRecord('transactions', {
      id: 'pb3',
      localId: 't1',
      summary: 'x',
      customerIds: JSON.stringify(['c1']),
      updatedAt: 600,
      deleted: 0,
      rev: 7,
    } as never)
    const link = (await db.links.get(linkId)) as Link
    expect(link.deleted).toBe(1) // 墓碑不被远端旧键复活
    expect(link.rev).toBe(2) // 也不被重复盖章
  })
})

describe('4. 保存选择集与级联解绑', () => {
  it('saveTransactionWithAttachments 的 related 选择集：同事务建联/清空', async () => {
    await db.customers.put(customer('c1') as never)
    await db.customers.put(customer('c2') as never)
    await saveTransactionWithAttachments(txn() as never, [], {
      customerIds: ['c1', 'c2'],
      todoIds: [],
      projectIds: [],
    })
    const index = await relatedIndex()
    expect(txnLinksOf(index, 't1').customerIds).toEqual(['c1', 'c2'])

    // 第二次保存：c1 移除、保留 c2 → c1 的 link 墓碑化
    await saveTransactionWithAttachments(txn() as never, [], {
      customerIds: ['c2'],
      todoIds: [],
      projectIds: [],
    })
    const c1Id = buildLinkId(
      { type: 'transactions', id: 't1' },
      { type: 'customers', id: 'c1' },
      'related',
    )
    expect((await db.links.get(c1Id))!.deleted).toBe(1)
    const index2 = await relatedIndex()
    expect(txnLinksOf(index2, 't1').customerIds).toEqual(['c2'])
  })

  it('删客户 → 指向它的 related link 墓碑化、其它目标保留（弱引用：不删流水）', async () => {
    await db.customers.put(customer('c1') as never)
    await db.customers.put(customer('keep') as never)
    await saveTransactionWithAttachments(txn() as never, [], {
      customerIds: ['c1', 'keep'],
      todoIds: [],
      projectIds: [],
    })
    await deleteCustomerCascade('c1')

    const c1Id = buildLinkId(
      { type: 'transactions', id: 't1' },
      { type: 'customers', id: 'c1' },
      'related',
    )
    const keepId = buildLinkId(
      { type: 'transactions', id: 't1' },
      { type: 'customers', id: 'keep' },
      'related',
    )
    expect((await db.links.get(c1Id))!.deleted).toBe(1)
    expect((await db.links.get(keepId))!.deleted).toBe(0)
    expect(await db.transactions.get('t1')).toBeTruthy() // 流水不删
  })
})

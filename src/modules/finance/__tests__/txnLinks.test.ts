/**
 * Issue #140 交易多关联：链接读写口径 + 远端归一化 + 级联解绑
 *
 * 覆盖三类真实故障：
 * 1. 旧数据（单值 customerId）/ 老客户端推来的旧字段：必须归一化进数组，不能"双读 fallback 写漏一处就丢"；
 * 2. 服务端集合未升级（无 customerIds 键）：pull 时不能把本地刚选的关联清空；
 * 3. 客户级联删除：数组里只移除该客户，其他关联保留（弱引用纪律，不删流水）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import {
  normalizeTxnLinks,
  pruneTxnLinkIds,
  toIdArray,
  toLinkField,
  txnCustomerIds,
  txnProjectIds,
  txnTodoIds,
} from '../links'
import { deleteCustomerCascade } from '@/repositories'
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
    name: '张三',
    company: '',
    title: '',
    decisionLevel: '决策人' as const,
    tier: 'A' as const,
    tags: [],
    lastContactAt: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('links 读取器与写入纪律', () => {
  it('旧单值记录读取时按数组返回（兼容迁移前数据）', () => {
    const legacy = { customerId: 'c1', todoId: 'td1', projectId: 'p1' }
    expect(txnCustomerIds(legacy)).toEqual(['c1'])
    expect(txnTodoIds(legacy)).toEqual(['td1'])
    expect(txnProjectIds(legacy)).toEqual(['p1'])
  })

  it('新数组记录读取正常，且与旧字段并存时合并去重', () => {
    expect(txnCustomerIds({ customerIds: ['c1', 'c2'] })).toEqual(['c1', 'c2'])
    expect(txnCustomerIds({ customerIds: ['c1'], customerId: 'c1' })).toEqual(['c1'])
    expect(txnCustomerIds({ customerIds: ['c1'], customerId: 'c3' })).toEqual(['c1', 'c3'])
  })

  it('toIdArray 吃字符串 / 数组 / JSON 字符串 / 脏值', () => {
    expect(toIdArray('c1')).toEqual(['c1'])
    expect(toIdArray('["c1","c2"]')).toEqual(['c1', 'c2'])
    expect(toIdArray(['c1', 'c1', '', null, 3])).toEqual(['c1'])
    expect(toIdArray(undefined)).toEqual([])
    expect(toIdArray({})).toEqual([])
  })

  it('normalizeTxnLinks 归一化后删除旧键（双写不双读）', () => {
    const rec: Record<string, unknown> = { id: 't1', customerId: 'c1', customerIds: ['c2'] }
    normalizeTxnLinks(rec)
    expect(rec.customerIds).toEqual(['c2', 'c1'])
    expect(rec).not.toHaveProperty('customerId')
    expect(rec).not.toHaveProperty('todoId')
  })

  it('toLinkField：空数组不落键；pruneTxnLinkIds：去重 + 丢弃已删实体', () => {
    expect(toLinkField([])).toBeUndefined()
    expect(toLinkField(['c1', 'c1', 'c2'])).toEqual(['c1', 'c2'])
    expect(pruneTxnLinkIds(['c1', 'c2', 'c2'], new Set(['c1']))).toEqual(['c1'])
  })
})

describe('远端合并：多关联不被静默清空（Issue #140）', () => {
  it('服务端集合未升级（远端无 customerIds 键）时保留本地关联', async () => {
    await db.transactions.put(txn({ customerIds: ['c1', 'c2'] }) as never)
    // 远端记录 updatedAt 更新，但集合里根本没有数组字段（collections.json 未导入）
    const res = await mergeRemoteRecord(
      'transactions',
      { id: 'pb1', localId: 't1', summary: '改过的摘要', updatedAt: 200, deleted: 0, rev: 5 },
      async () => undefined,
    )
    expect(res).toBe('write')
    const row = await db.transactions.get('t1')
    expect(row!.summary).toBe('改过的摘要')
    expect(txnCustomerIds(row!)).toEqual(['c1', 'c2'])
  })

  it('老客户端推来旧单值字段时折进数组，不另存一份', async () => {
    await db.transactions.put(txn({ customerIds: ['c1'] }) as never)
    await mergeRemoteRecord(
      'transactions',
      {
        id: 'pb1',
        localId: 't1',
        customerId: 'c9',
        customerIds: JSON.stringify(['c1']),
        updatedAt: 200,
        deleted: 0,
        rev: 5,
      },
      async () => undefined,
    )
    const row = await db.transactions.get('t1')
    expect(txnCustomerIds(row!).sort()).toEqual(['c1', 'c9'])
    expect(row).not.toHaveProperty('customerId')
  })
})

describe('客户级联删除：数组关联只解绑该客户', () => {
  it('多关联流水移除被删客户，其余关联保留，流水不删', async () => {
    await db.customers.put(customer('c1') as never)
    await db.transactions.put(txn({ id: 't1', customerIds: ['c1', 'c2'] }) as never)
    await deleteCustomerCascade('c1')
    const row = await db.transactions.get('t1')
    expect(row!.deleted).toBe(0)
    expect(txnCustomerIds(row!)).toEqual(['c2'])
  })

  it('唯一关联客户被删后关联字段清空（不留下空数组键）', async () => {
    await db.customers.put(customer('c1') as never)
    await db.transactions.put(txn({ id: 't1', customerIds: ['c1'] }) as never)
    await deleteCustomerCascade('c1')
    const row = await db.transactions.get('t1')
    expect(txnCustomerIds(row!)).toEqual([])
    expect(row).not.toHaveProperty('customerIds')
  })
})

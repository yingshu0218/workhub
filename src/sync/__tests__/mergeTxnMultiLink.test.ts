/**
 * Issue #140 回归：交易多关联的同步合并
 * 1. 远端数组字段（含 JSON 字符串形态）拉回归一化为数组落库
 * 2. 远端 Schema 未升级（无数组字段但带旧单值）→ 旧单值包数组兜底
 * 3. 远端字段全空（静默丢字段）→ 保留本地数组
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { mergeRemoteRecord as mergeRemote } from '../mergeRemote'

function txnRecord(over: Record<string, unknown>) {
  return {
    id: 'pb-1',
    localId: 't1',
    ledgerId: 'l1',
    type: 'income',
    amount: 100,
    summary: 's',
    channel: '',
    occurredAt: 1,
    tags: '["a"]', // 服务端 json 字段可能返回字符串
    status: '待对账',
    updatedAt: 200, // > 本地 100，远端胜出
    deleted: 0,
    rev: 2,
    ...over,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.open()
  await db.transactions.put({
    id: 't1', ledgerId: 'l1', type: 'income', amount: 100, summary: 's', channel: '',
    occurredAt: 1, tags: ['a'], status: '待对账', customerIds: ['c-local'], todoIds: [], projectIds: [],
    createdAt: 1, updatedAt: 100, deleted: 0, rev: 1,
  } as never)
})

describe('mergeRemote：交易多关联归一化', () => {
  it('远端返回数组 → 原样落库', async () => {
    await mergeRemote('transactions', txnRecord({ customerIds: ['c1', 'c2'], todoIds: [], projectIds: [] }))
    const t = await db.transactions.get('t1')
    expect(t?.customerIds).toEqual(['c1', 'c2'])
    expect(t && 'customerId' in t).toBe(false)
  })

  it('远端返回 JSON 字符串 → 解析成数组', async () => {
    await mergeRemote('transactions', txnRecord({ customerIds: '["c9"]', todoIds: '[]', projectIds: '[]' }))
    const t = await db.transactions.get('t1')
    expect(t?.customerIds).toEqual(['c9'])
  })

  it('远端 Schema 未升级：无数组字段但有旧单值 → 旧单值包数组兜底', async () => {
    await mergeRemote('transactions', txnRecord({ customerId: 'c-legacy' }))
    const t = await db.transactions.get('t1')
    expect(t?.customerIds).toEqual(['c-legacy'])
  })

  it('远端字段全空（静默丢字段）→ 保留本地数组', async () => {
    await mergeRemote('transactions', txnRecord({}))
    const t = await db.transactions.get('t1')
    expect(t?.customerIds).toEqual(['c-local'])
  })
})

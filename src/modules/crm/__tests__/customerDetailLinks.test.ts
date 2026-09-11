/**
 * 客户详情「点击报错」回归（Issue #147 bug 2）
 *
 * 背景：Issue #140 v11 把 `transactions` 的关联字段单值 → 数组
 * （`customerId/todoId/projectId` → `customerIds/todoIds/projectIds`），
 * 并在 db.ts v11 明确**删掉了这几条索引**、约定改内存过滤。
 * 但两处查询漏改，仍写 `where('customerId')`：
 *   ① `crm/timeline.ts` useCustomerTimeline —— 客户详情页时间轴；
 *   ② `crm/hooks.ts` useCustomerScoreInput —— 健康分算法入参。
 * Dexie 对不存在索引的 where 会抛 `SchemaError: KeyPath customerId on object store
 * transactions is not indexed`，被 useQuery 吞掉后页面渲染崩溃（用户看到「模块出错了」）。
 *
 * 本测试双保险：
 *   A. 源码不变式 —— 全仓不得再对 `db.transactions` 用已删索引（静态拦住同类漏改）；
 *   B. 行为冒烟 —— 用与修复同源的「内存过滤」口径复算，确认能取到关联流水。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { txnCustomerIds, txnTodoIds, txnProjectIds } from '@/modules/finance/links'

const ROOT = path.resolve(__dirname, '../../../..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('A. 源码不变式：transactions 不得再用 v11 已删索引', () => {
  it('全仓无 db.transactions.where(customerId | todoId | projectId)', () => {
    const violations: string[] = []
    for (const file of walk(path.join(ROOT, 'src'))) {
      if (file.includes('__tests__')) continue
      const src = readFileSync(file, 'utf8')
      // 松散匹配：transactions 之后 60 字符内出现 where('customerId' 等
      const re = /db\.transactions[\s\S]{0,80}?\.where\(\s*'(customerId|todoId|projectId)'/g
      re.lastIndex = 0
      if (re.test(src)) violations.push(path.relative(ROOT, file))
    }
    expect(
      violations,
      `以下文件仍对 transactions 使用 v11 已删索引，会抛 SchemaError：\n${violations.join('\n')}`,
    ).toEqual([])
  })
})

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

describe('B. 行为冒烟：内存过滤口径能取到关联流水（不再抛 SchemaError）', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('useCustomerTimeline 同源口径：按数组包含取该客户流水', async () => {
    await db.transactions.put(txn({ id: 't1', customerIds: ['c1'] }) as never)
    await db.transactions.put(txn({ id: 't2', customerIds: ['c2'] }) as never)
    const rows = await db.transactions
      .filter((t) => !t.deleted && txnCustomerIds(t).includes('c1'))
      .toArray()
    expect(rows.map((r) => r.id)).toEqual(['t1'])
  })

  it('旧单值记录（未归一化）也能被内存过滤命中（读取侧兼容）', async () => {
    await db.transactions.put(txn({ id: 'legacy', customerId: 'c1' }) as never)
    const rows = await db.transactions
      .filter((t) => !t.deleted && txnCustomerIds(t).includes('c1'))
      .toArray()
    expect(rows.map((r) => r.id)).toEqual(['legacy'])
  })

  it('多关联：一笔流水分摊多客户时各方都命中；todo/project 同款', async () => {
    await db.transactions.put(
      txn({ id: 't1', customerIds: ['c1', 'c2'], todoIds: ['td1'], projectIds: ['p1'] }) as never,
    )
    const forC2 = await db.transactions
      .filter((t) => !t.deleted && txnCustomerIds(t).includes('c2'))
      .toArray()
    expect(forC2.map((r) => r.id)).toEqual(['t1'])
    expect(txnTodoIds(forC2[0])).toEqual(['td1'])
    expect(txnProjectIds(forC2[0])).toEqual(['p1'])
  })

  it('反向验证：直接对已删索引 where(customerId) 会抛 SchemaError（证明不变式有意义）', async () => {
    await db.transactions.put(txn({ id: 't1', customerIds: ['c1'] }) as never)
    await expect(
      db.transactions
        .where('customerId' as never)
        .equals('c1' as never)
        .toArray(),
    ).rejects.toThrow(/not indexed/)
  })
})

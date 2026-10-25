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
import { groupTxnLinks, txnLinksOf } from '@/modules/finance/links'

const ROOT = path.resolve(__dirname, '../../../..')

async function seedRelated(txnId: string, toType: 'customers' | 'todos' | 'projects', toId: string) {
  const { buildLinkId } = await import('@/repositories/linkId')
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
      // 匹配窗口内不得再出现下一个 `db.` 引用（否则 db.todos.where('customerId') 会被
      // 误算到上一个 db.transactions 头上 —— 关联层 Phase 2 改造时踩到的假阳性）
      const re = /db\.transactions(?:(?!db\.)[\s\S]){0,120}?\.where\(\s*'(customerId|todoId|projectId)'/g
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

describe('B. 行为冒烟：link 索引口径能取到关联流水（不再抛 SchemaError）', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  /** 与 useCustomerTimeline / useCustomerTransactions 同源的 link 反查口径 */
  async function txnIdsOfCustomer(customerId: string): Promise<string[]> {
    const ls = await db.links
      .where('[toType+toId]')
      .equals(['customers', customerId])
      .filter((l) => !l.deleted && l.kind === 'related' && l.fromType === 'transactions')
      .toArray()
    return ls.map((l) => l.fromId)
  }

  it('按 link 反查取该客户流水', async () => {
    await db.transactions.put(txn({ id: 't1' }) as never)
    await db.transactions.put(txn({ id: 't2' }) as never)
    await seedRelated('t1', 'customers', 'c1')
    await seedRelated('t2', 'customers', 'c2')
    expect(await txnIdsOfCustomer('c1')).toEqual(['t1'])
  })

  it('多关联：一笔流水分摊多客户时各方都命中；todo/project 同桶', async () => {
    await db.transactions.put(txn({ id: 't1' }) as never)
    await seedRelated('t1', 'customers', 'c1')
    await seedRelated('t1', 'customers', 'c2')
    await seedRelated('t1', 'todos', 'td1')
    await seedRelated('t1', 'projects', 'p1')
    expect(await txnIdsOfCustomer('c2')).toEqual(['t1'])
    const index = groupTxnLinks(await db.links.where('kind').equals('related').toArray())
    expect(txnLinksOf(index, 't1')).toEqual({
      customerIds: ['c1', 'c2'],
      todoIds: ['td1'],
      projectIds: ['p1'],
    })
  })

  it('反向验证：直接对已删索引 where(customerId) 会抛 SchemaError（证明不变式有意义）', async () => {
    await db.transactions.put(txn({ id: 't1' }) as never)
    await expect(
      db.transactions
        .where('customerId' as never)
        .equals('c1' as never)
        .toArray(),
    ).rejects.toThrow(/not indexed/)
  })
})

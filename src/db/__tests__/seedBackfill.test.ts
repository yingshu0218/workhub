import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { backfillDemoRelations } from '../seed'
import type { Customer } from '../types'

/**
 * 演示关系自愈的回归锁（2026-10-14）
 *
 * 锁三件事：① 该补的时候真的补上（三角、双侧各一条）；② 幂等（再跑不重复写）；
 * ③ **不该补的时候绝不掺和** —— 这是这个功能的安全底线：只要用户自己管过关系，
 * 或者库里不是这份种子数据，一个字节都不许动。
 */

function cust(id: string): Customer {
  return {
    id,
    name: `客户${id}`,
    company: '演示科技',
    title: '总监',
    decisionLevel: '决策人',
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
}

async function relationCountOf(customerId: string): Promise<number> {
  return (
    await db.links.where('kind').equals('relation').toArray()
  ).filter((l) => !l.deleted && (l.fromId === customerId || l.toId === customerId)).length
}

async function relationLabelsOf(customerId: string): Promise<{ label: string; category?: string }[]> {
  return (await db.links.where('kind').equals('relation').toArray())
    .filter((l) => !l.deleted && (l.fromId === customerId || l.toId === customerId))
    .map((l) => ({ label: (l.meta?.label as string | undefined) ?? '', category: l.meta?.category }))
}

beforeEach(async () => {
  await db.customers.clear()
  await db.links.clear()
})

describe('backfillDemoRelations：老本地库的演示关系自愈', () => {
  it('三位演示客户一条关系都没有 → 补齐三角（返回 3，每人在两侧各有一条）', async () => {
    await db.customers.bulkPut([cust('c1'), cust('c2'), cust('c3')])
    expect(await backfillDemoRelations()).toBe(3)

    // v15 起关系在 links：三角 = 3 条 canonical link，每人两端各见 2 条视图
    expect(await db.links.where('kind').equals('relation').count()).toBe(3)
    expect(await relationCountOf('c1')).toBe(2)
    expect(await relationCountOf('c2')).toBe(2)
    expect(await relationCountOf('c3')).toBe(2)
    // 语义与归类与种子里的一致（不是随手编的）
    expect((await relationLabelsOf('c1')).map((r) => r.label).sort()).toEqual(['同行伙伴', '项目合作'])
    expect((await relationLabelsOf('c1')).every((r) => !!r.category)).toBe(true)
  })

  it('幂等：补齐后再跑一次返回 0（不重复写）', async () => {
    await db.customers.bulkPut([cust('c1'), cust('c2'), cust('c3')])
    expect(await backfillDemoRelations()).toBe(3)
    expect(await backfillDemoRelations()).toBe(0)
    expect(await relationCountOf('c1')).toBe(2)
  })

  it('用户自己管过关系（任一条存在）→ 绝不掺和，也不覆盖', async () => {
    await db.customers.bulkPut([cust('c1'), cust('c2'), cust('c3')])
    const { buildLinkId } = await import('@/repositories/linkId')
    await db.links.put({
      id: buildLinkId(
        { type: 'customers', id: 'c1' },
        { type: 'customers', id: 'c3' },
        'relation',
        { label: '我自己设的' },
      ),
      fromType: 'customers',
      fromId: 'c1',
      toType: 'customers',
      toId: 'c3',
      kind: 'relation',
      meta: { label: '我自己设的' },
      createdAt: 1,
      updatedAt: 0,
      rev: 0,
      deleted: 0,
    } as never)
    expect(await backfillDemoRelations()).toBe(0)
    expect(await db.links.where('kind').equals('relation').count()).toBe(1)
    expect((await relationLabelsOf('c1'))[0].label).toBe('我自己设的')
  })

  it('不是这份种子数据（缺 id / 已删除）→ 不动', async () => {
    await db.customers.bulkPut([cust('c1'), cust('c2')]) // 缺 c3
    expect(await backfillDemoRelations()).toBe(0)

    await db.customers.put({ ...cust('c3'), deleted: 1 }) // 有 c3 但已删除
    expect(await backfillDemoRelations()).toBe(0)
  })
})

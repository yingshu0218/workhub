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

function cust(id: string, relations: Customer['relations'] = []): Customer {
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
    relations,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
}

beforeEach(async () => {
  await db.customers.clear()
})

describe('backfillDemoRelations：老本地库的演示关系自愈', () => {
  it('三位演示客户一条关系都没有 → 补齐三角（返回 3，每人在两侧各有一条）', async () => {
    await db.customers.bulkPut([cust('c1'), cust('c2'), cust('c3')])
    expect(await backfillDemoRelations()).toBe(3)

    const rows = await Promise.all(['c1', 'c2', 'c3'].map((id) => db.customers.get(id)))
    expect(rows.map((r) => (r!.relations ?? []).length)).toEqual([2, 2, 2])
    // 语义与归类与种子里的一致（不是随手编的）
    const c1 = rows[0]!
    expect(c1.relations!.map((r) => r.label).sort()).toEqual(['同行伙伴', '项目合作'])
    expect(c1.relations!.every((r) => !!r.category)).toBe(true)
  })

  it('幂等：补齐后再跑一次返回 0（不重复写）', async () => {
    await db.customers.bulkPut([cust('c1'), cust('c2'), cust('c3')])
    expect(await backfillDemoRelations()).toBe(3)
    expect(await backfillDemoRelations()).toBe(0)
    expect((await db.customers.get('c1'))!.relations).toHaveLength(2)
  })

  it('用户自己管过关系（任一条存在）→ 绝不掺和，也不覆盖', async () => {
    await db.customers.bulkPut([
      cust('c1', [{ targetId: 'c3', label: '我自己设的' }]),
      cust('c2'),
      cust('c3'),
    ])
    expect(await backfillDemoRelations()).toBe(0)
    const c1 = await db.customers.get('c1')
    expect(c1!.relations).toHaveLength(1)
    expect(c1!.relations![0]!.label).toBe('我自己设的')
  })

  it('不是这份种子数据（缺 id / 已删除）→ 不动', async () => {
    await db.customers.bulkPut([cust('c1'), cust('c2')]) // 缺 c3
    expect(await backfillDemoRelations()).toBe(0)

    await db.customers.put({ ...cust('c3'), deleted: 1 }) // 有 c3 但已删除
    expect(await backfillDemoRelations()).toBe(0)
  })
})

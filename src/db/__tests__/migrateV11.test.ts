/**
 * Issue #140 v11 迁移：transactions 关联字段单值 → 数组
 *
 * 为什么单独测：Dexie 的 `upgrade()` 只在真实版本跃迁时执行一次，线上的老用户库是
 * 「v10 数据 + v11 schema」这条路径 —— 一旦这里写错，用户全部历史流水的关联会静默丢失
 * 或留下旧键（旧键留着就会被后续"双读 fallback"逻辑反复引用，迟早写漏一处）。
 * 这里复刻 v11 的迁移体对老记录跑一遍，断言：
 * 1. 单值包成数组；2. 空值不落键；3. 旧键被清掉；4. 重复执行幂等。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'

/** 复刻 v11 upgrade 的迁移体（与 db.ts 保持同源，改这里必须同步改实现） */
async function runV11Upgrade() {
  await db
    .table('transactions')
    .toCollection()
    .modify((t: Record<string, unknown>) => {
      const toIds = (v: unknown): string[] | undefined => {
        if (typeof v === 'string' && v) return [v]
        if (Array.isArray(v)) {
          const ids = v.filter((x): x is string => typeof x === 'string' && !!x)
          return ids.length > 0 ? [...new Set(ids)] : undefined
        }
        return undefined
      }
      const customerIds = toIds(t.customerIds ?? t.customerId)
      const todoIds = toIds(t.todoIds ?? t.todoId)
      const projectIds = toIds(t.projectIds ?? t.projectId)
      if (customerIds) t.customerIds = customerIds
      else delete t.customerIds
      if (todoIds) t.todoIds = todoIds
      else delete t.todoIds
      if (projectIds) t.projectIds = projectIds
      else delete t.projectIds
      delete t.customerId
      delete t.todoId
      delete t.projectId
    })
}

function legacyTxn(over: Record<string, unknown>) {
  return {
    ledgerId: 'l1',
    type: 'expense',
    amount: 1,
    summary: 's',
    channel: '微信',
    occurredAt: 1,
    tags: [],
    status: '待对账',
    updatedAt: 1,
    deleted: 0,
    rev: 1,
    ...over,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('v11 迁移：交易关联单值 → 数组', () => {
  it('旧单值包成数组并清掉旧键', async () => {
    await db.transactions.put(legacyTxn({ id: 'a', customerId: 'c1' }) as never)
    await db.transactions.put(legacyTxn({ id: 'b', customerId: 'c2', projectId: 'p1' }) as never)
    await runV11Upgrade()

    const a = (await db.transactions.get('a')) as unknown as Record<string, unknown>
    expect(a.customerIds).toEqual(['c1'])
    expect(a).not.toHaveProperty('customerId')
    expect(a).not.toHaveProperty('todoIds')

    const b = (await db.transactions.get('b')) as unknown as Record<string, unknown>
    expect(b.customerIds).toEqual(['c2'])
    expect(b.projectIds).toEqual(['p1'])
    expect(b).not.toHaveProperty('projectId')
  })

  it('无关联的老记录不留下空键', async () => {
    await db.transactions.put(legacyTxn({ id: 'c' }) as never)
    await runV11Upgrade()
    const c = (await db.transactions.get('c')) as unknown as Record<string, unknown>
    expect(c).not.toHaveProperty('customerIds')
    expect(c).not.toHaveProperty('todoIds')
    expect(c).not.toHaveProperty('projectIds')
    expect(c).not.toHaveProperty('customerId')
  })

  it('重复执行幂等（数组不再被破坏），且空串脏值被清掉', async () => {
    await db.transactions.put(legacyTxn({ id: 'd', customerIds: ['c1', 'c2'] }) as never)
    await db.transactions.put(legacyTxn({ id: 'e', customerId: '' }) as never)
    await runV11Upgrade()
    await runV11Upgrade()

    const d = (await db.transactions.get('d')) as unknown as Record<string, unknown>
    expect(d.customerIds).toEqual(['c1', 'c2'])
    const e = (await db.transactions.get('e')) as unknown as Record<string, unknown>
    expect(e).not.toHaveProperty('customerIds')
  })

  it('schema 版本号不低于 11（防止后续实现回退版本）', () => {
    // 本意是防回退、不是钉死：v12 起为附件补了 updatedAt 索引（P2 #1），
    // 后续再有版本推进也不该让这条断言变红 —— 回退到 11 以下才是要拦的事。
    expect(db.verno).toBeGreaterThanOrEqual(11)
  })
})

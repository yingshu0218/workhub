/**
 * links 关联层 Phase 1 行为锁（docs/关联层设计方案-20261025.md §9-A）
 *
 * ## 锁的是什么
 *
 * - **id 确定性**：同语义恒同 id —— 双端离线各建同一条关联时 LWW 直接合流不产生重复；
 *   relation 的 label 参与 id（同对客户不同语义 = 两条）；方向 canonical（A→B ≡ B→A）；
 * - **幂等**：重复建联不产生第二条（rev 递增）；重复解绑不重复盖章（rev / deletedAt 不动
 *   —— 后者是回收站保留期的口径字段，被重复 bump 会失真）；
 * - **幽灵纪律③**：端点不存在 / 已软删 → 建联抛可操作错误且事务整体回滚，不留半条记录；
 * - **读写路径**：写路径入同步队列（upsert / delete）；读路径按方向与 kind 过滤、墓碑不出现。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { customerRepo, todoRepo } from '@/repositories'
import { buildLinkId, linkAtoms, unlinkAtoms, linksOf, linksTo } from '@/repositories/links'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function seedCustomer(id: string): Promise<void> {
  await customerRepo.put({
    id,
    name: `客户${id}`,
    company: '',
    title: '',
    decisionLevel: '决策人',
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: 0,
    createdAt: Date.now(),
  })
}

async function seedTodo(id: string): Promise<void> {
  await todoRepo.put({
    id,
    title: `待办${id}`,
    desc: '',
    priority: 'mid',
    status: 'todo',
    createdAt: Date.now(),
  })
}

describe('buildLinkId 确定性', () => {
  it('同语义恒同 id；kind 与端点 id 参与判重', () => {
    const txn = { type: 'transactions', id: 'txn-1' } as const
    const cus = { type: 'customers', id: 'cus-1' } as const
    const base = buildLinkId(txn, cus, 'related')
    expect(base).toBe(buildLinkId(txn, cus, 'related'))
    expect(base).not.toBe(buildLinkId(txn, cus, 'mention'))
    expect(base).not.toBe(buildLinkId(txn, { type: 'customers', id: 'cus-2' }, 'related'))
    expect(base.startsWith('lk-')).toBe(true)
  })

  it('relation：label 参与 id（同对客户不同语义 = 两条）；方向 canonical', () => {
    const a = { type: 'customers', id: 'cus-a' } as const
    const b = { type: 'customers', id: 'cus-b' } as const
    const fwd = buildLinkId(a, b, 'relation', { label: '转介绍人' })
    // canonical：任一端发起得到同一条（今日 relations 双侧镜像要写两条，links 只此一条）
    expect(fwd).toBe(buildLinkId(b, a, 'relation', { label: '转介绍人' }))
    expect(fwd).not.toBe(buildLinkId(a, b, 'relation', { label: '同一公司' }))
  })
})

describe('linkAtoms / unlinkAtoms', () => {
  it('幂等：重复建联不产生第二条，rev 递增；写入入同步队列', async () => {
    await seedCustomer('cus-1')
    await seedTodo('todo-1')
    const input = {
      from: { type: 'todos', id: 'todo-1' },
      to: { type: 'customers', id: 'cus-1' },
      kind: 'related',
    } as const
    const id = await linkAtoms(input)
    await linkAtoms(input)

    const alive = (await db.links.toArray()).filter((l) => !l.deleted)
    expect(alive).toHaveLength(1)
    expect((await db.links.get(id))!.rev).toBe(2)

    const queued = await db.syncQueue.where('table').equals('links').toArray()
    expect(queued.some((q) => q.recordId === id && q.op === 'upsert')).toBe(true)
  })

  it('幽灵纪律：端点不存在 → 抛错且事务回滚（不留 link、不入队）', async () => {
    await seedTodo('todo-1')
    await expect(
      linkAtoms({
        from: { type: 'todos', id: 'todo-1' },
        to: { type: 'customers', id: 'ghost' },
        kind: 'related',
      }),
    ).rejects.toThrow(/端点不存在/)
    expect(await db.links.count()).toBe(0)
    expect(await db.syncQueue.where('table').equals('links').count()).toBe(0)
  })

  it('幽灵纪律：端点已软删 → 抛错', async () => {
    await seedCustomer('cus-1')
    await seedTodo('todo-1')
    await customerRepo.softDelete('cus-1')
    await expect(
      linkAtoms({
        from: { type: 'todos', id: 'todo-1' },
        to: { type: 'customers', id: 'cus-1' },
        kind: 'related',
      }),
    ).rejects.toThrow(/端点不存在/)
  })

  it('relation：canonical 落库（from 恒为字典序较小端）且要求 meta.label', async () => {
    await seedCustomer('cus-b')
    await seedCustomer('cus-a')
    await expect(
      linkAtoms({
        from: { type: 'customers', id: 'cus-b' },
        to: { type: 'customers', id: 'cus-a' },
        kind: 'relation',
      }),
    ).rejects.toThrow(/meta\.label/)

    const id = await linkAtoms({
      from: { type: 'customers', id: 'cus-b' },
      to: { type: 'customers', id: 'cus-a' },
      kind: 'relation',
      meta: { label: '转介绍人' },
    })
    const rec = (await db.links.get(id))!
    expect(rec.fromId).toBe('cus-a') // canonical：与发起方向无关
    expect(rec.toId).toBe('cus-b')
    expect(rec.meta?.label).toBe('转介绍人')
  })

  it('解绑：软删 + 入队 delete；重复解绑 / 从未存在 → 幂等静默不盖章', async () => {
    await seedCustomer('cus-1')
    await seedTodo('todo-1')
    const input = {
      from: { type: 'todos', id: 'todo-1' },
      to: { type: 'customers', id: 'cus-1' },
      kind: 'related',
    } as const
    const id = await linkAtoms(input)
    await unlinkAtoms(input)

    const tomb = (await db.links.get(id))!
    expect(tomb.deleted).toBe(1)
    expect(tomb.deletedAt).toBeGreaterThan(0)
    expect(
      await db.syncQueue
        .where('table')
        .equals('links')
        .filter((q) => q.recordId === id && q.op === 'delete')
        .count(),
    ).toBeGreaterThanOrEqual(1)

    // 已是墓碑 → 幂等静默：rev 不动、不入队（deletedAt 也就不会被拉漂）
    const revBefore = tomb.rev
    await db.syncQueue.clear()
    await unlinkAtoms(input)
    expect((await db.links.get(id))!.rev).toBe(revBefore)
    expect(await db.syncQueue.where('table').equals('links').count()).toBe(0)

    // 从未存在 → 同样静默（与 softDelete 幽灵防护同口径）
    await unlinkAtoms({
      from: { type: 'todos', id: 'nope' },
      to: { type: 'customers', id: 'ghost' },
      kind: 'related',
    })
  })
})

describe('linksOf / linksTo 读路径', () => {
  it('按方向与 kind 过滤；墓碑不出现', async () => {
    await seedCustomer('cus-1')
    await seedCustomer('cus-2')
    await seedTodo('todo-1')
    await seedTodo('todo-2')
    const alive = await linkAtoms({
      from: { type: 'todos', id: 'todo-1' },
      to: { type: 'customers', id: 'cus-1' },
      kind: 'related',
    })
    const mention = {
      from: { type: 'todos', id: 'todo-2' },
      to: { type: 'customers', id: 'cus-1' },
      kind: 'mention',
      meta: { label: '王总' },
    } as const
    await linkAtoms(mention)
    await unlinkAtoms(mention)

    expect((await linksTo('customers', 'cus-1')).map((l) => l.id)).toEqual([alive])
    expect(await linksTo('customers', 'cus-1', 'mention')).toHaveLength(0)
    expect(await linksOf('todos', 'todo-1')).toHaveLength(1)
    expect(await linksOf('todos', 'todo-1', 'mention')).toHaveLength(0)
    expect(await linksTo('customers', 'cus-2')).toHaveLength(0)
  })
})

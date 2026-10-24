// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { deleteCustomerCascade, deleteHabitCascade } from '@/repositories'
import { deleteTodoCascade } from '@/modules/todo/cascade'
import { restoreTrashRecord, listTrash } from '@/repositories/trash'

const meta = (over: Record<string, unknown> = {}) => ({
  updatedAt: 100,
  deleted: 0 as const,
  rev: 1,
  ...over,
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('回收站：客户级联删除 → 恢复重建关联', () => {
  it('快照记录子项与链接，恢复后客户/日志/流水/待办/项目/关系全部回来', async () => {
    await db.ledgers.put({ id: 'l1', name: '默认账本', currency: 'CNY', createdAt: 1, ...meta() } as never)
    await db.customers.put(
      {
        id: 'c1',
        name: '甲客户',
        company: '甲公司',
        tags: [],
        relations: [],
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await db.customers.put(
      {
        id: 'c2',
        name: '乙客户',
        company: '乙公司',
        tags: [],
        relations: [{ id: 'rel1', targetId: 'c1', label: '转介绍', category: 'other' }],
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await db.interactions.put(
      { id: 'i1', customerId: 'c1', content: '电话沟通', at: 1, createdAt: 1, ...meta() } as never,
    )
    await db.transactions.put(
      {
        id: 't1',
        ledgerId: 'l1',
        type: 'income',
        amount: 100,
        summary: '回款',
        channel: '',
        occurredAt: 1,
        tags: [],
        customerIds: ['c1'],
        status: '已结算',
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await db.todos.put(
      {
        id: 'td1',
        title: '跟进',
        desc: '',
        priority: 'mid',
        status: 'todo',
        customerId: 'c1',
        createdAt: 1,
        tags: [],
        ...meta(),
      } as never,
    )
    await db.projects.put(
      {
        id: 'p1',
        name: '项目甲',
        status: 'inProgress',
        customerId: 'c1',
        createdAt: 1,
        ...meta(),
      } as never,
    )

    await deleteCustomerCascade('c1')

    const deleted = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(deleted.deleted).toBe(1)
    expect((deleted.trashSnapshot as { children: unknown[] }).children).toHaveLength(1)
    expect(((await db.customers.get('c2')) as never as { relations: unknown[] }).relations).toEqual([])
    expect(
      ((await db.transactions.get('t1')) as never as { customerIds?: string[] }).customerIds ?? [],
    ).toEqual([])

    const result = await restoreTrashRecord('customers', 'c1')

    expect(result.restored).toBe(2) // 客户 + 1 条沟通日志
    expect(result.rebuiltLinks).toBe(4) // 流水 + 待办 + 项目 + c2 关系
    expect(((await db.customers.get('c1')) as never as { deleted: number }).deleted).toBe(0)
    expect(((await db.customers.get('c2')) as never as { relations: unknown[] }).relations).toHaveLength(1)
    expect(((await db.interactions.get('i1')) as never as { deleted: number }).deleted).toBe(0)
    expect(((await db.transactions.get('t1')) as never as { customerIds: string[] }).customerIds).toEqual(['c1'])
    expect(((await db.todos.get('td1')) as never as { customerId: string }).customerId).toBe('c1')
    expect(((await db.projects.get('p1')) as never as { customerId: string }).customerId).toBe('c1')
  })
})

describe('回收站：习惯/待办快照', () => {
  it('习惯恢复连带打卡记录', async () => {
    await db.habits.put(
      {
        id: 'h1',
        name: '阅读',
        icon: 'menu_book',
        color: '#000',
        category: '成长',
        schedule: '每日',
        targetMinutes: 25,
        motivationNote: '',
        crossModuleSync: false,
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await db.habitLogs.put(
      { id: 'hl1', habitId: 'h1', date: '2026-10-23', completedAt: 1, ...meta() } as never,
    )

    await deleteHabitCascade('h1')
    const result = await restoreTrashRecord('habits', 'h1')

    expect(result.restored).toBe(2)
    expect(((await db.habits.get('h1')) as never as { deleted: number }).deleted).toBe(0)
    expect(((await db.habitLogs.get('hl1')) as never as { deleted: number }).deleted).toBe(0)
  })

  it('待办恢复回填流水 todoIds', async () => {
    await db.todos.put(
      {
        id: 'td1',
        title: '跟进',
        desc: '',
        priority: 'mid',
        status: 'todo',
        tags: [],
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await db.transactions.put(
      {
        id: 't1',
        ledgerId: 'l1',
        type: 'expense',
        amount: 10,
        summary: '支出',
        channel: '',
        occurredAt: 1,
        tags: [],
        todoIds: ['td1'],
        status: '已结算',
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await db.ledgers.put({ id: 'l1', name: '默认账本', currency: 'CNY', createdAt: 1, ...meta() } as never)

    await deleteTodoCascade('td1')
    expect(
      ((await db.transactions.get('t1')) as never as { todoIds?: string[] }).todoIds ?? [],
    ).toEqual([])

    const result = await restoreTrashRecord('todos', 'td1')
    expect(result.rebuiltLinks).toBe(1)
    expect(((await db.transactions.get('t1')) as never as { todoIds: string[] }).todoIds).toEqual(['td1'])
  })
})

describe('回收站：列表与父子禁用', () => {
  it('列出墓碑，且父项已删时子项不可单独恢复', async () => {
    await db.customers.put(
      {
        id: 'c1',
        name: '甲客户',
        company: '',
        tags: [],
        relations: [],
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await db.interactions.put(
      { id: 'i1', customerId: 'c1', content: '沟通', at: 1, createdAt: 1, ...meta() } as never,
    )
    await deleteCustomerCascade('c1')

    const items = await listTrash()
    const child = items.find((i) => i.table === 'interactions' && i.id === 'i1')
    expect(child?.parentTable).toBe('customers')
    expect(child?.canRestore).toBe(false)
    await expect(restoreTrashRecord('interactions', 'i1')).rejects.toThrow('请先恢复所属客户')
  })
})

/**
 * 删除时间必须是**独立字段**。
 *
 * 锁的是这条因果：墓碑的 updatedAt 会被同步合并反复抬高（`mergeRemote` 取 max），
 * 若回收站拿它当删除时间，「删除于 / 剩余 N 天」会随每次对端合并漂移，保留期清理也会被续命。
 */
describe('删除时间：deletedAt 不被 updatedAt 漂移带跑', () => {
  it('软删写入 deletedAt，updatedAt 被抬高后回收站仍显示真实删除时间', async () => {
    await db.todos.put(
      {
        id: 'td1',
        title: '待办',
        desc: '',
        priority: 'mid',
        status: 'todo',
        tags: [],
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await deleteTodoCascade('td1')

    const tomb = (await db.todos.get('td1')) as unknown as Record<string, unknown>
    const deletedAt = tomb.deletedAt as number
    expect(typeof deletedAt).toBe('number')

    // 模拟对端墓碑合并把 updatedAt 抬到一天后（真实存在：mergeRemote 取 max）
    await db.todos.update('td1', { updatedAt: deletedAt + 86_400_000 })

    const items = await listTrash()
    expect(items.find((i) => i.id === 'td1')?.deletedAt).toBe(deletedAt)
  })

  it('老墓碑没有 deletedAt 时回退 updatedAt（不做数据迁移）', async () => {
    await db.todos.put(
      {
        id: 'td-old',
        title: '老墓碑',
        desc: '',
        priority: 'mid',
        status: 'todo',
        tags: [],
        createdAt: 1,
        ...meta({ deleted: 1, updatedAt: 1700000000000 }),
      } as never,
    )
    const items = await listTrash()
    expect(items.find((i) => i.id === 'td-old')?.deletedAt).toBe(1700000000000)
  })

  it('恢复后 deletedAt 清空（活记录不得带删除时间）', async () => {
    await db.todos.put(
      {
        id: 'td1',
        title: '待办',
        desc: '',
        priority: 'mid',
        status: 'todo',
        tags: [],
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await deleteTodoCascade('td1')
    await restoreTrashRecord('todos', 'td1')
    expect((await db.todos.get('td1'))?.deletedAt).toBeUndefined()
  })
})

/**
 * 笔记 mention：删除即剪、恢复即回填。
 *
 * 此前只有恢复路径（`pruneDeadRefs`）会剪 mentions，删除侧完全没动 ——
 * 活笔记会长期挂一个指向墓碑的 mention。渲染层有 `EntityMissing` 兜底不崩，
 * 但「删除即解绑」是写入端纪律，不能指望每处读取都记得过滤。
 */
describe('笔记 mention：删除即剪、恢复即回填', () => {
  const seedNote = async () =>
    db.notes.put({
      id: 'n1',
      title: '会谈纪要',
      markdown: '',
      tags: [],
      backlinks: [],
      mentions: [
        { type: 'customer', id: 'c1', label: '甲客户' },
        { type: 'todo', id: 'td1', label: '跟进' },
      ],
      createdAt: 1,
      ...meta(),
    } as never)

  it('删除客户时剪掉客户提及、保留其他提及；恢复后原样补回', async () => {
    await db.customers.put(
      {
        id: 'c1',
        name: '甲客户',
        company: '',
        tags: [],
        relations: [],
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await seedNote()

    await deleteCustomerCascade('c1')
    const afterDelete = (await db.notes.get('n1')) as never as { mentions: unknown[] }
    expect(afterDelete.mentions).toEqual([{ type: 'todo', id: 'td1', label: '跟进' }])

    const result = await restoreTrashRecord('customers', 'c1')
    expect(result.rebuiltLinks).toBe(1)
    const afterRestore = (await db.notes.get('n1')) as never as { mentions: unknown[] }
    expect(afterRestore.mentions).toEqual([
      { type: 'todo', id: 'td1', label: '跟进' },
      { type: 'customer', id: 'c1', label: '甲客户' },
    ])
  })

  it('删除待办时同样剪掉提及', async () => {
    await db.todos.put(
      {
        id: 'td1',
        title: '跟进',
        desc: '',
        priority: 'mid',
        status: 'todo',
        tags: [],
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await seedNote()

    await deleteTodoCascade('td1')
    const note = (await db.notes.get('n1')) as never as { mentions: unknown[] }
    expect(note.mentions).toEqual([{ type: 'customer', id: 'c1', label: '甲客户' }])
  })
})

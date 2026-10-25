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


/** 播种「流水 → 目标」related link（v15 起关联在 links 表；派生行口径） */
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

    await seedRelated('t1', 'customers', 'c1')
    // c1↔c2 的客户关系（v15 起为 relation link）：删除时一并墓碑化，恢复时复活
    const { buildLinkId } = await import('@/repositories/linkId')
    const relationLinkId = buildLinkId(
      { type: 'customers', id: 'c1' },
      { type: 'customers', id: 'c2' },
      'relation',
      { label: '同事' },
    )
    await db.links.put({
      id: relationLinkId,
      fromType: 'customers',
      fromId: 'c1',
      toType: 'customers',
      toId: 'c2',
      kind: 'relation',
      meta: { label: '同事' },
      createdAt: 1,
      updatedAt: 0,
      rev: 0,
      deleted: 0,
    } as never)
    await deleteCustomerCascade('c1')

    const deleted = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(deleted.deleted).toBe(1)
    expect((deleted.trashSnapshot as { children: unknown[] }).children).toHaveLength(1)
    // 关系 link 随级联墓碑化（双侧镜像/数组清扫已退役）
    expect((await db.links.get(relationLinkId))!.deleted).toBe(1)
    expect(
      ((await db.links.toArray()).filter((l) => l.kind === 'related' && l.fromId === 't1' && !l.deleted).map((l) => l.toId)),
    ).toEqual([])

    const result = await restoreTrashRecord('customers', 'c1')

    expect(result.restored).toBe(2) // 客户 + 1 条沟通日志
    // 旧字段级回填：待办 + 项目（relations/customerIds 的 append 项已随 v15 迁 links 退役）
    expect(result.rebuiltLinks).toBe(2)
    // 关联层：related（流水↔客户）+ relation（客户↔客户）两条 link 随客户复活
    expect(result.revivedCascadeLinks).toBe(2)
    expect(((await db.customers.get('c1')) as never as { deleted: number }).deleted).toBe(0)
    expect((await db.links.get(relationLinkId))!.deleted).toBe(0)
    expect(((await db.interactions.get('i1')) as never as { deleted: number }).deleted).toBe(0)
    expect(
      (
        await db.links.toArray()
      ).filter((l) => l.kind === 'related' && l.fromId === 't1' && !l.deleted).map((l) => l.toId),
    ).toEqual(['c1'])
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
        status: '已结算',
        createdAt: 1,
        ...meta(),
      } as never,
    )
    await db.ledgers.put({ id: 'l1', name: '默认账本', currency: 'CNY', createdAt: 1, ...meta() } as never)

    await seedRelated('t1', 'todos', 'td1')
    await deleteTodoCascade('td1')
    expect(
      ((await db.links.toArray()).filter((l) => l.kind === 'related' && l.fromId === 't1' && !l.deleted).map((l) => l.toId)),
    ).toEqual([])

    const result = await restoreTrashRecord('todos', 'td1')
    // 旧字段级回填为零（todoIds 已迁 links）；related link 随待办复活
    expect(result.rebuiltLinks).toBe(0)
    expect(result.revivedCascadeLinks).toBe(1)
    expect(
      (
        await db.links.toArray()
      ).filter((l) => l.kind === 'related' && l.fromId === 't1' && !l.deleted).map((l) => l.toId),
    ).toEqual(['td1'])
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
 * 回收站「N 条关联」计数 = 字段快照（snapshot.links）+ 级联 link 墓碑（cascadeLinkIds）。
 *
 * links 时代（v15）只数前者 → 删客户在回收站显示「1 条关联」、恢复确认也说 1 条，
 * 而实际恢复会带回字段回填 + 全部 link 复活（2026-10-26 真机验收发现：快照 3 条
 * cascadeLinkIds + 1 条字段快照，界面只报 1）。两类凭证不重叠：前者回填字段，后者复活 link 记录。
 */
describe('回收站关联计数：字段快照 + 级联 link 墓碑合计', () => {
  it('删客户后 linkCount 含 cascadeLinkIds（不只旧字段快照）', async () => {
    await db.customers.put(
      { id: 'c1', name: '甲客户', company: '', tags: [], relations: [], createdAt: 1, ...meta() } as never,
    )
    // 字段型关联：待办挂在客户上（级联会以 set 模式记进 snapshot.links，恢复时回填字段）
    await db.todos.put(
      { id: 'td1', title: '跟进', desc: '', priority: 'mid', status: 'todo', tags: [], customerId: 'c1', createdAt: 1, ...meta() } as never,
    )
    // link 型关联：mention（级联会墓碑化并记进 cascadeLinkIds，恢复时复活 link）
    const { buildLinkId } = await import('@/repositories/linkId')
    const mentionId = buildLinkId({ type: 'notes', id: 'n1' }, { type: 'customers', id: 'c1' }, 'mention')
    await db.notes.put({ id: 'n1', title: '纪要', markdown: '', tags: [], createdAt: 1, ...meta() } as never)
    await db.links.put(
      { id: mentionId, fromType: 'notes', fromId: 'n1', toType: 'customers', toId: 'c1', kind: 'mention', createdAt: 1, updatedAt: 0, rev: 0, deleted: 0 } as never,
    )

    await deleteCustomerCascade('c1')

    const tomb = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    const snapshot = tomb.trashSnapshot as { links: unknown[]; cascadeLinkIds: string[] }
    expect(snapshot.links).toHaveLength(1) // 字段快照：todo.customerId
    expect(snapshot.cascadeLinkIds).toHaveLength(1) // link 墓碑：mention

    const item = (await listTrash()).find((i) => i.table === 'customers' && i.id === 'c1')
    expect(item?.linkCount).toBe(2)
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
 * 笔记 mention：删除即解绑、恢复即回填（关联层 Phase 2 版）。
 *
 * mentions 已迁 links（v15）：「剪」不再是改笔记行，而是把指向被删实体的
 * mention link 墓碑化（cascade 钩子，快照 cascadeLinkIds 留档）；「回填」是恢复时
 * 复活对应 link（两端实体都存活才复活）。笔记行本身从头到尾不动。
 */
describe('笔记 mention：删除即解绑 link、恢复即复活', () => {
  const seedNote = async () => {
    await db.notes.put({
      id: 'n1',
      title: '会谈纪要',
      markdown: '',
      tags: [],
      createdAt: 1,
      ...meta(),
    } as never)
    // 两条 mention link（note→客户 c1 / note→待办 td1），派生行口径
    const { buildLinkId } = await import('@/repositories/linkId')
    const put = (toType: 'customers' | 'todos', toId: string, label: string) =>
      db.links.put({
        id: buildLinkId({ type: 'notes', id: 'n1' }, { type: toType, id: toId }, 'mention'),
        fromType: 'notes',
        fromId: 'n1',
        toType,
        toId,
        kind: 'mention',
        meta: { label },
        createdAt: 1,
        updatedAt: 0,
        rev: 0,
        deleted: 0,
      } as never)
    await put('customers', 'c1', '甲客户')
    await put('todos', 'td1', '跟进')
  }

  it('删除客户 → 指向它的 mention link 墓碑化、其它提及不动；笔记行不变；恢复后 link 复活', async () => {
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
    const { buildLinkId } = await import('@/repositories/linkId')
    const c1LinkId = buildLinkId(
      { type: 'notes', id: 'n1' },
      { type: 'customers', id: 'c1' },
      'mention',
    )
    const td1LinkId = buildLinkId(
      { type: 'notes', id: 'n1' },
      { type: 'todos', id: 'td1' },
      'mention',
    )

    await deleteCustomerCascade('c1')
    expect((await db.links.get(c1LinkId))!.deleted).toBe(1) // 指向被删客户：墓碑化
    expect((await db.links.get(td1LinkId))!.deleted).toBe(0) // 其它提及：不动
    // 笔记行全程不动（旧行为会改写 mentions 数组）
    expect(await db.notes.get('n1')).toBeTruthy()

    const result = await restoreTrashRecord('customers', 'c1')
    expect(result.revivedCascadeLinks).toBe(1)
    expect((await db.links.get(c1LinkId))!.deleted).toBe(0)
    expect((await db.links.get(c1LinkId))!.restoredAt).toBeGreaterThan(0)
  })

  it('删除待办 → 指向它的 mention link 墓碑化', async () => {
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
    const { buildLinkId } = await import('@/repositories/linkId')
    const td1LinkId = buildLinkId(
      { type: 'notes', id: 'n1' },
      { type: 'todos', id: 'td1' },
      'mention',
    )

    await deleteTodoCascade('td1')
    expect((await db.links.get(td1LinkId))!.deleted).toBe(1)
    expect(await db.notes.get('n1')).toBeTruthy()
  })
})

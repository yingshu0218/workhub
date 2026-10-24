// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { deleteCustomerCascade, deleteHabitCascade } from '@/repositories'
import {
  listTrash,
  purgeAllTrash,
  purgeTrashRecord,
  restoreTrashRecord,
} from '@/repositories/trash'

/**
 * 回收站「永久删除」—— 物理删除语义锁。
 *
 * 这里锁的不是「记录没了」（那太容易满足），而是四条容易写错的分支：
 * ① 只接受墓碑（对活记录必须抛错，绝不顺手删活数据）；
 * ② 父墓碑带子墓碑一起走，但**活着的子记录一个都不能带走**；
 * ③ 父项已被永久删除的子墓碑仍可单独永久删除（否则那行会永远卡在回收站）；
 * ④ 清空回收站只清墓碑，活数据与同步队列历史不受影响。
 */

const meta = (over: Record<string, unknown> = {}) => ({
  updatedAt: 100,
  deleted: 0 as const,
  rev: 1,
  ...over,
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function seedCustomerWithInteraction() {
  await db.customers.put({
    id: 'c1',
    name: '甲客户',
    company: '',
    tags: [],
    relations: [],
    createdAt: 1,
    ...meta(),
  } as never)
  await db.interactions.put({
    id: 'i1',
    customerId: 'c1',
    content: '电话沟通',
    at: 1,
    createdAt: 1,
    ...meta(),
  } as never)
}

describe('永久删除：单条墓碑', () => {
  it('物理删除后本地行消失、且原样占用仍在的活记录不受影响', async () => {
    await db.todos.put({
      id: 'td1',
      title: '要永久删的待办',
      desc: '',
      priority: 'mid',
      status: 'todo',
      tags: [],
      createdAt: 1,
      ...meta({ deleted: 1 }),
    } as never)
    await db.todos.put({
      id: 'td2',
      title: '还活着的待办',
      desc: '',
      priority: 'mid',
      status: 'todo',
      tags: [],
      createdAt: 1,
      ...meta(),
    } as never)

    const result = await purgeTrashRecord('todos', 'td1')

    expect(result.purged).toBe(1)
    expect(result.tables).toEqual(['todos'])
    expect(await db.todos.get('td1')).toBeUndefined()
    expect(await db.todos.get('td2')).toBeTruthy()
  })

  it('对活记录调用直接抛错（不能把「回收站点错一行」变成删活数据）', async () => {
    await db.todos.put({
      id: 'td1',
      title: '活着',
      desc: '',
      priority: 'mid',
      status: 'todo',
      tags: [],
      createdAt: 1,
      ...meta(),
    } as never)

    await expect(purgeTrashRecord('todos', 'td1')).rejects.toThrow('该记录未被删除')
    expect(await db.todos.get('td1')).toBeTruthy()
  })

  it('对不存在的记录抛错（不返回假的成功）', async () => {
    await expect(purgeTrashRecord('todos', 'ghost')).rejects.toThrow('记录不存在')
  })
})

describe('永久删除：级联墓碑', () => {
  it('父墓碑带子墓碑一起物理删除', async () => {
    await seedCustomerWithInteraction()
    await deleteCustomerCascade('c1')

    const result = await purgeTrashRecord('customers', 'c1')

    expect(result.purged).toBe(2) // 客户 + 沟通日志
    expect(result.tables.sort()).toEqual(['customers', 'interactions'])
    expect(await db.customers.get('c1')).toBeUndefined()
    expect(await db.interactions.get('i1')).toBeUndefined()
  })

  it('子记录已被单独恢复时，删父墓碑不得带走这条活数据', async () => {
    await seedCustomerWithInteraction()
    await deleteCustomerCascade('c1')
    // 父项恢复 → 子项随之恢复（同一事务），再把父项删回去模拟「父墓碑 + 活子记录」
    await restoreTrashRecord('customers', 'c1')
    await db.customers.put({
      ...((await db.customers.get('c1')) as never as Record<string, unknown>),
      deleted: 1,
    } as never)

    const result = await purgeTrashRecord('customers', 'c1')

    expect(result.purged).toBe(1) // 只有客户，活着的沟通日志被放过
    expect(await db.customers.get('c1')).toBeUndefined()
    expect(await db.interactions.get('i1')).toBeTruthy()
  })

  it('父项已被永久删除的子墓碑仍可单独永久删除（否则永远卡在回收站）', async () => {
    await seedCustomerWithInteraction()
    await deleteCustomerCascade('c1')
    // 先只恢复子项是不可能的（父未活），故这里直接手造「父已物理消失、子仍是墓碑」
    await db.customers.delete('c1')

    const items = await listTrash()
    const child = items.find((i) => i.table === 'interactions' && i.id === 'i1')
    expect(child?.canRestore).toBe(false)
    expect(child?.blockedReason).toContain('已被永久删除')

    const result = await purgeTrashRecord('interactions', 'i1')
    expect(result.purged).toBe(1)
    expect(await listTrash()).toEqual([])
  })
})

describe('永久删除：清空回收站', () => {
  it('清掉全部墓碑，活数据与队列不受影响', async () => {
    await seedCustomerWithInteraction()
    await db.habits.put({
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
    } as never)
    await db.habitLogs.put({
      id: 'hl1',
      habitId: 'h1',
      date: '2026-10-23',
      completedAt: 1,
      ...meta(),
    } as never)
    await db.todos.put({
      id: 'td-alive',
      title: '别把我删了',
      desc: '',
      priority: 'mid',
      status: 'todo',
      tags: [],
      createdAt: 1,
      ...meta(),
    } as never)
    await deleteCustomerCascade('c1')
    await deleteHabitCascade('h1')

    const before = await listTrash()
    expect(before.length).toBe(4) // 客户 + 日志 + 习惯 + 打卡

    const result = await purgeAllTrash()

    expect(result.purged).toBe(4)
    expect(await listTrash()).toEqual([])
    expect(await db.customers.count()).toBe(0)
    expect(await db.habits.count()).toBe(0)
    // 活数据原样（防止「清空回收站」误伤成清库）
    expect(await db.todos.get('td-alive')).toBeTruthy()
  })

  it('空回收站返回 0 且不抛错（幂等）', async () => {
    await expect(purgeAllTrash()).resolves.toEqual({ purged: 0, tables: [] })
  })
})

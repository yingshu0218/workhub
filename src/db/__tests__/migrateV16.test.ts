// @vitest-environment jsdom
/**
 * Phase 3 集合层 · v16 迁移锁：todos.listId → kind='member' link
 *
 * 与 migrateV15.test.ts 同口径（迁移体单一实现 migrateLegacyLinks，五条锁面）：
 * 1. 旧字段翻成 link（确定性 id、from=待办 → to=清单、kind='member'）；
 * 2. 派生行盖 updatedAt:0 / rev:0 最低优先级戳、不入同步队列；
 * 3. 端点已删/缺失的旧归属跳过（语义上已离开）；
 * 4. 旧键就地清掉（双写不双读）；
 * 5. 幂等：重复执行不重复派生；本地已有同语义 link（活或墓碑）不动。
 * 后续族（notes.folderId / customers.groupId）并入同实现，届时在本文件加 describe。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { migrateLegacyLinks } from '../legacyLinkMigration'
import { buildLinkId } from '@/repositories/linkId'

const tableOf = (name: string) => db.table(name) as never

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function seedTodo(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await db.todos.put({
    id,
    title: `待办 ${id}`,
    priority: 'mid',
    status: 'todo',
    tags: [],
    createdAt: 5,
    updatedAt: 5,
    deleted: 0,
    rev: 1,
    ...over,
  } as never)
}

async function seedList(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await db.todoLists.put({
    id,
    name: `清单 ${id}`,
    sortOrder: 1,
    createdAt: 5,
    updatedAt: 5,
    deleted: 0,
    rev: 1,
    ...over,
  } as never)
}

describe('v16 · todos 族：listId → kind=member link', () => {
  it('翻成 member link（确定性 id、方向 from=待办），旧键清掉，派生行零戳不入队', async () => {
    await seedList('tl1')
    await seedTodo('td1', { listId: 'tl1' })

    const derived = await migrateLegacyLinks(tableOf)

    expect(derived).toBe(1)
    const link = await db.links.get(
      buildLinkId({ type: 'todos', id: 'td1' }, { type: 'todoLists', id: 'tl1' }, 'member'),
    )
    expect(link).toMatchObject({
      fromType: 'todos',
      fromId: 'td1',
      toType: 'todoLists',
      toId: 'tl1',
      kind: 'member',
      updatedAt: 0,
      rev: 0,
      deleted: 0,
    })
    // 旧键清掉（双写不双读）
    expect((await db.todos.get('td1'))! as unknown as Record<string, unknown>).not.toHaveProperty('listId')
    // 不入同步队列
    expect(await db.syncQueue.toArray()).toHaveLength(0)
  })

  it('清单已删/缺失：跳过派生（语义上已离开），旧键仍清掉', async () => {
    await seedList('tl1', { deleted: 1 })
    await seedTodo('td1', { listId: 'tl1' })
    await seedTodo('td2', { listId: 'nope' })

    await migrateLegacyLinks(tableOf)

    expect(await db.links.toArray()).toHaveLength(0)
    expect((await db.todos.get('td1'))! as unknown as Record<string, unknown>).not.toHaveProperty('listId')
    expect((await db.todos.get('td2'))! as unknown as Record<string, unknown>).not.toHaveProperty('listId')
  })

  it('幂等：重复执行不重复派生；本地已有同语义 link（含墓碑）不动', async () => {
    await seedList('tl1')
    await seedTodo('td1', { listId: 'tl1' })
    await migrateLegacyLinks(tableOf)
    // 第二轮：旧键已清，无派生
    expect(await migrateLegacyLinks(tableOf)).toBe(0)
    // 本地已有墓碑（用户手动移出清单后又拉到带旧键的远端行）：不复活
    await db.todos.put({ ...((await db.todos.get('td1')) as object), listId: 'tl1' } as never)
    const linkId = buildLinkId({ type: 'todos', id: 'td1' }, { type: 'todoLists', id: 'tl1' }, 'member')
    await db.links.update(linkId, { deleted: 1, deletedAt: 99 })
    await migrateLegacyLinks(tableOf)
    expect((await db.links.get(linkId))!.deleted).toBe(1)
  })
})

describe('v16 · notes 族：folderId → kind=member link（同表双族：mentions 见 v15）', () => {
  async function seedNote(id: string, over: Record<string, unknown> = {}): Promise<void> {
    await db.notes.put({
      id,
      title: `笔记 ${id}`,
      markdown: '',
      tags: [],
      createdAt: 5,
      updatedAt: 5,
      deleted: 0,
      rev: 1,
      ...over,
    } as never)
  }

  async function seedFolder(id: string, over: Record<string, unknown> = {}): Promise<void> {
    await db.noteFolders.put({
      id,
      name: `文件夹 ${id}`,
      createdAt: 5,
      updatedAt: 5,
      deleted: 0,
      rev: 1,
      ...over,
    } as never)
  }

  it('folderId 翻成 member link，旧键清掉；mentions（v15 族）同轮共存不互扰', async () => {
    await seedFolder('nf1')
    await seedNote('n1', { folderId: 'nf1', mentions: [{ type: 'customer', id: 'c1', label: '甲' }] })
    await db.customers.put({ id: 'c1', name: '甲', company: '', tags: [], relations: [], createdAt: 5, updatedAt: 5, deleted: 0, rev: 1 } as never)

    await migrateLegacyLinks(tableOf)

    const member = await db.links.get(
      buildLinkId({ type: 'notes', id: 'n1' }, { type: 'noteFolders', id: 'nf1' }, 'member'),
    )
    expect(member).toMatchObject({ kind: 'member', fromType: 'notes', toType: 'noteFolders', toId: 'nf1', updatedAt: 0 })
    const mention = await db.links.get(
      buildLinkId({ type: 'notes', id: 'n1' }, { type: 'customers', id: 'c1' }, 'mention', { label: '甲' }),
    )
    expect(mention).toMatchObject({ kind: 'mention' })
    const row = (await db.notes.get('n1'))! as unknown as Record<string, unknown>
    expect(row).not.toHaveProperty('folderId')
    expect(row).not.toHaveProperty('mentions')
  })

  it('文件夹已删/缺失：跳过派生，旧键仍清掉；幂等不重复', async () => {
    await seedFolder('nf1', { deleted: 1 })
    await seedNote('n1', { folderId: 'nf1' })
    await seedNote('n2', { folderId: 'nope' })

    await migrateLegacyLinks(tableOf)
    expect(await db.links.toArray()).toHaveLength(0)
    expect(await migrateLegacyLinks(tableOf)).toBe(0)
  })
})

describe('v16 · customers 族：groupId → kind=member link（manual 组；relations 见 v15）', () => {
  async function seedCustomer(id: string, over: Record<string, unknown> = {}): Promise<void> {
    await db.customers.put({
      id,
      name: `客户 ${id}`,
      company: '',
      tags: [],
      relations: [],
      createdAt: 5,
      updatedAt: 5,
      deleted: 0,
      rev: 1,
      ...over,
    } as never)
  }

  async function seedGroup(id: string, over: Record<string, unknown> = {}): Promise<void> {
    await db.customerGroups.put({
      id,
      name: `分组 ${id}`,
      kind: 'manual',
      includeTags: [],
      excludeTags: [],
      sortOrder: 1,
      createdAt: 5,
      updatedAt: 5,
      deleted: 0,
      rev: 1,
      ...over,
    } as never)
  }

  it('groupId 翻成 member link，旧键清掉；relations（v15 族）同轮共存', async () => {
    await seedGroup('cg1')
    await seedCustomer('c1', {
      groupId: 'cg1',
      relations: [{ id: 'r1', targetId: 'c2', label: '转介绍人' }],
    })
    await seedCustomer('c2')

    await migrateLegacyLinks(tableOf)

    const member = await db.links.get(
      buildLinkId({ type: 'customers', id: 'c1' }, { type: 'customerGroups', id: 'cg1' }, 'member'),
    )
    expect(member).toMatchObject({ kind: 'member', fromType: 'customers', toType: 'customerGroups', toId: 'cg1' })
    const rel = await db.links.get(
      buildLinkId({ type: 'customers', id: 'c1' }, { type: 'customers', id: 'c2' }, 'relation', { label: '转介绍人' }),
    )
    expect(rel).toMatchObject({ kind: 'relation' })
    expect((await db.customers.get('c1'))! as unknown as Record<string, unknown>).not.toHaveProperty('groupId')
  })

  it('分组已删/缺失：跳过派生，旧键仍清掉；幂等不重复', async () => {
    await seedGroup('cg1', { deleted: 1 })
    await seedCustomer('c1', { groupId: 'cg1' })
    await seedCustomer('c2', { groupId: 'nope' })

    await migrateLegacyLinks(tableOf)
    expect(await db.links.toArray()).toHaveLength(0)
    expect(await migrateLegacyLinks(tableOf)).toBe(0)
  })
})

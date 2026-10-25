/**
 * links 级联与恢复联动锁（docs/关联层设计方案-20261025.md §9-B · R2）
 *
 * ## 锁的是什么
 *
 * - **删除即解绑（关联层版）**：cascade 软删实体的同事务内，指向该实体（含子记录端点）
 *   的 link 一并墓碑化、id 写进根墓碑 `trashSnapshot.cascadeLinkIds`、入队 delete；
 * - **恢复即回填（关联层版）**：restoreTrashRecord 复活实体后，按快照 id 复活 link ——
 *   **两端实体都存活**才复活，对端已删则跳过并计数（不为恢复关联复活无关记录）；
 * - **快照 id 而非时间戳猜**：先删一方的快照才持有 link id（幂等不重复墓碑化），
 *   用户在实体删除前手动解绑的 link 永远不会被恢复路径复活；
 * - **purge 不动 links**（as-built 裁决）：link 墓碑交 cleanupTombstones 30 天机制。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import {
  customerRepo,
  todoRepo,
  habitRepo,
  checkinHabit,
  habitLogId,
  deleteCustomerCascade,
  deleteHabitCascade,
} from '@/repositories'
import { linkAtoms, linksTo, linksOf } from '@/repositories/links'
import { deleteTodoCascade } from '@/modules/todo/cascade'
import { restoreTrashRecord, purgeTrashRecord } from '@/repositories/trash'

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

async function seedHabit(id: string): Promise<void> {
  await habitRepo.put({
    id,
    name: `习惯${id}`,
    icon: 'star',
    color: '#004ac6',
    category: '生活',
    schedule: '每日',
    targetMinutes: 10,
    motivationNote: '',
    crossModuleSync: false,
    createdAt: Date.now(),
  })
}

describe('删除即解绑（关联层）：cascade 同事务墓碑化 links', () => {
  it('删客户 → 指向它的 link 变墓碑、id 进快照、入队 delete；恢复后复活', async () => {
    await seedCustomer('cus-1')
    await seedTodo('todo-1')
    const linkId = await linkAtoms({
      from: { type: 'todos', id: 'todo-1' },
      to: { type: 'customers', id: 'cus-1' },
      kind: 'related',
    })

    await deleteCustomerCascade('cus-1')

    // 同事务墓碑化（cascade 返回即已可见）+ 快照留档 + 入队
    const link = (await db.links.get(linkId))!
    expect(link.deleted).toBe(1)
    expect(link.deletedAt).toBeGreaterThan(0)
    const cusTomb = (await db.customers.get('cus-1'))!
    expect(cusTomb.trashSnapshot?.cascadeLinkIds).toEqual([linkId])
    expect(
      await db.syncQueue
        .where('table')
        .equals('links')
        .filter((q) => q.recordId === linkId && q.op === 'delete')
        .count(),
    ).toBeGreaterThanOrEqual(1)
    expect(await linksTo('customers', 'cus-1')).toHaveLength(0) // 读路径不再见到墓碑

    // 恢复客户 → link 复活（对端 todo 存活）
    const result = await restoreTrashRecord('customers', 'cus-1')
    expect(result.revivedCascadeLinks).toBe(1)
    expect((await db.links.get(linkId))!.deleted).toBe(0)
    expect((await db.links.get(linkId))!.restoredAt).toBeGreaterThan(0)
    expect(await linksTo('customers', 'cus-1')).toHaveLength(1)
  })

  it('habit 级联：子记录端点（habitLogs）一并清扫，随根恢复复活', async () => {
    await seedHabit('h1')
    await seedCustomer('cus-1')
    await checkinHabit('h1', '2026-10-25')
    const logId = habitLogId('h1', '2026-10-25')
    // link 的 from 端点是打卡日志（子记录）：删除习惯时它必须跟着墓碑化
    const linkId = await linkAtoms({
      from: { type: 'habitLogs', id: logId },
      to: { type: 'customers', id: 'cus-1' },
      kind: 'related',
    })

    await deleteHabitCascade('h1')
    expect((await db.links.get(linkId))!.deleted).toBe(1)
    expect((await db.habits.get('h1'))!.trashSnapshot?.cascadeLinkIds).toEqual([linkId])

    const result = await restoreTrashRecord('habits', 'h1')
    expect(result.revivedCascadeLinks).toBe(1)
    expect(await linksOf('habitLogs', logId)).toHaveLength(1)
  })

  it('对端已删 → 恢复跳过并计数；快照只在先删一方（幂等不重复墓碑化）', async () => {
    await seedCustomer('cus-a')
    await seedTodo('todo-t')
    const linkId = await linkAtoms({
      from: { type: 'todos', id: 'todo-t' },
      to: { type: 'customers', id: 'cus-a' },
      kind: 'related',
    })

    // 先删 todo（快照落在 todo 上）→ 再删客户（link 已是墓碑，幂等跳过，客户快照无此 id）
    await deleteTodoCascade('todo-t')
    await deleteCustomerCascade('cus-a')
    expect((await db.customers.get('cus-a'))!.trashSnapshot?.cascadeLinkIds ?? []).toHaveLength(0)

    // 恢复 todo：对端客户仍是墓碑 → 跳过，不复活
    const r1 = await restoreTrashRecord('todos', 'todo-t')
    expect(r1.revivedCascadeLinks).toBe(0)
    expect(r1.skippedCascadeLinks).toBe(1)
    expect((await db.links.get(linkId))!.deleted).toBe(1)

    // 客户后恢复也无档可依（顺序边界：先删的一方要最后恢复）——link 保持墓碑，可手动重建
    const r2 = await restoreTrashRecord('customers', 'cus-a')
    expect(r2.revivedCascadeLinks).toBe(0)
    expect((await db.links.get(linkId))!.deleted).toBe(1)
  })

  it('purge 不物理删 link 墓碑（as-built：交 cleanupTombstones 30 天机制）', async () => {
    await seedCustomer('cus-1')
    await seedTodo('todo-1')
    const linkId = await linkAtoms({
      from: { type: 'todos', id: 'todo-1' },
      to: { type: 'customers', id: 'cus-1' },
      kind: 'related',
    })
    await deleteCustomerCascade('cus-1')
    // 未配置同步中心 → pushTombstonesNow 走 { skipped } 分支，purge 直接物理删实体
    await purgeTrashRecord('customers', 'cus-1')

    expect(await db.customers.get('cus-1')).toBeUndefined() // 实体已物理删
    expect((await db.links.get(linkId))!.deleted).toBe(1) // link 墓碑保留，30 天后统一清理
  })
})

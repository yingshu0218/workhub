/**
 * Issue #140 回归：交易/待办多关联（方案 A 数组化）
 *
 * 覆盖三块：
 * 1. migrate（v10 → v11）：旧单值 customerId/todoId/projectId 包成数组，旧字段清除（双写不双读）
 * 2. 级联解绑数组版：deleteCustomerCascade 从 customerIds 移除被删客户，其余关联保留
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { db } from '@/db/db'
import { deleteCustomerCascade } from '@/repositories'

/**
 * 同一 Dexie 实例两阶段 open：先以 v10 声明打开并写入旧形态数据，关闭后以
 * v11 声明（含与 db.ts 完全一致的 upgrade 回调）重新打开，验证 upgrade 转换。
 * fake-indexeddb 对「同实例 close 后再 open 升级」支持良好。
 */
describe('v11 migrate：单值 → 数组（双写不双读）', () => {
  it('旧单值 customerId/todoId/projectId 包成数组且旧字段被清除', async () => {
    const V10_STORES = {
      workspaces: 'id, updatedAt',
      customers: 'id, tier, updatedAt',
      interactions: 'id, customerId, at, projectId, updatedAt',
      ledgers: 'id, sortOrder, updatedAt',
      transactions: 'id, ledgerId, occurredAt, status, customerId, projectId, updatedAt',
      todos: 'id, status, dueAt, priority, customerId, listId, projectId, updatedAt',
      notes: 'id, folderId, projectId, updatedAt',
      quickNotes: 'id, createdAt, updatedAt',
      habits: 'id, updatedAt',
      habitLogs: 'id, habitId, date, updatedAt, [habitId+date]',
      trophies: 'id, tier, unlockedAt, updatedAt',
      attachments: 'id, refType, refId, createdAt',
      syncQueue: '++seq, table, recordId, sentAt',
      meta: 'key',
      todoLists: 'id, sortOrder, updatedAt',
      noteFolders: 'id, updatedAt',
      projects: 'id, customerId, status, updatedAt',
      projectMilestones: 'id, projectId, sortOrder, updatedAt, [projectId+sortOrder]',
      moduleConfigs: 'id, updatedAt',
    }

    const legacyName = `legacy-txn-migrate-${Date.now()}`
    // 阶段一：v10 打开 + 写入旧形态
    const phase1 = new Dexie(legacyName)
    phase1.version(10).stores(V10_STORES)
    await phase1.open()
    await phase1.table('transactions').bulkPut([
      { id: 't1', ledgerId: 'l1', type: 'income', amount: 1, summary: 's', channel: '',
        occurredAt: 1, tags: [], status: '待对账', customerId: 'c1', todoId: 'td1',
        createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 } as never,
      { id: 't2', ledgerId: 'l1', type: 'expense', amount: 2, summary: 's2', channel: '',
        occurredAt: 2, tags: [], status: '待对账', projectId: 'p1',
        createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 } as never,
      { id: 't3', ledgerId: 'l1', type: 'expense', amount: 3, summary: 's3', channel: '',
        occurredAt: 3, tags: [], status: '待对账',
        createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 } as never,
    ])
    await phase1.table('todos').bulkPut([
      { id: 'td1', title: 'x', desc: '', priority: 'P2', status: 'todo', customerId: 'c1',
        createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 },
    ])
    phase1.close()
    await new Promise((r) => setTimeout(r, 0))

    // 阶段二：追加 v11 声明（upgrade 逻辑与 src/db/db.ts 逐行一致）后重新打开
    const phase2 = new Dexie(legacyName)
    phase2.version(10).stores(V10_STORES)
    phase2
      .version(11)
      .stores({
        transactions: 'id, ledgerId, occurredAt, status, projectId, updatedAt',
        todos: 'id, status, dueAt, priority, listId, projectId, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('transactions')
          .toCollection()
          .modify((t: Record<string, unknown>) => {
            if (t.customerIds === undefined)
              t.customerIds = typeof t.customerId === 'string' && t.customerId ? [t.customerId] : []
            if (t.todoIds === undefined)
              t.todoIds = typeof t.todoId === 'string' && t.todoId ? [t.todoId] : []
            if (t.projectIds === undefined)
              t.projectIds = typeof t.projectId === 'string' && t.projectId ? [t.projectId] : []
            delete t.customerId
            delete t.todoId
            delete t.projectId
          })
        await tx
          .table('todos')
          .toCollection()
          .modify((t: Record<string, unknown>) => {
            if (t.customerIds === undefined)
              t.customerIds = typeof t.customerId === 'string' && t.customerId ? [t.customerId] : []
            delete t.customerId
          })
      })
    await phase2.open()

    const t1 = await phase2.table('transactions').get('t1')
    expect(t1?.customerIds).toEqual(['c1'])
    expect(t1?.todoIds).toEqual(['td1'])
    expect(t1?.projectIds).toEqual([])
    expect(t1 && 'customerId' in t1).toBe(false)
    const t2 = await phase2.table('transactions').get('t2')
    expect(t2?.projectIds).toEqual(['p1'])
    expect(t2?.customerIds).toEqual([])
    const t3 = await phase2.table('transactions').get('t3')
    expect(t3?.customerIds).toEqual([])
    const td1 = await phase2.table('todos').get('td1')
    expect(td1?.customerIds).toEqual(['c1'])
    expect(td1 && 'customerId' in td1).toBe(false)
    phase2.close()
  })
})

describe('级联解绑数组版（deleteCustomerCascade）', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await db.open()
  })

  it('从交易/待办的 customerIds 移除被删客户，其余关联保留；空数组保留字段', async () => {
    await db.ledgers.bulkPut([
      { id: 'l1', name: '主', currency: 'CNY', openingBalance: 0, closingCycle: '月结',
        createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 },
    ])
    await db.customers.bulkPut([
      { id: 'c-del', name: '删我', company: '', title: '', decisionLevel: '决策人', tier: 'A',
        tags: [], phone: '', wechat: '', email: '', address: '', lastContactAt: 0, createdAt: 1,
        updatedAt: 1, deleted: 0, rev: 1 },
      { id: 'c-keep', name: '留我', company: '', title: '', decisionLevel: '决策人', tier: 'A',
        tags: [], phone: '', wechat: '', email: '', address: '', lastContactAt: 0, createdAt: 1,
        updatedAt: 1, deleted: 0, rev: 1 },
    ])
    await db.transactions.bulkPut([
      { id: 't1', ledgerId: 'l1', type: 'income', amount: 1, summary: '多客户', channel: '',
        occurredAt: 1, tags: [], status: '待对账', customerIds: ['c-del', 'c-keep'],
        createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 } as never,
      { id: 't2', ledgerId: 'l1', type: 'expense', amount: 1, summary: '仅被删客户', channel: '',
        occurredAt: 1, tags: [], status: '待对账', customerIds: ['c-del'],
        createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 } as never,
    ])
    await db.todos.bulkPut([
      { id: 'td1', title: '多客户待办', desc: '', priority: 'P2', status: 'todo',
        customerIds: ['c-del', 'c-keep'], createdAt: 1, updatedAt: 1, deleted: 0, rev: 1 } as never,
    ])

    await deleteCustomerCascade('c-del')

    const t1 = await db.transactions.get('t1')
    expect(t1?.customerIds).toEqual(['c-keep']) // 被删客户移除、其余保留
    const t2 = await db.transactions.get('t2')
    expect(t2?.customerIds).toEqual([]) // 空数组保留字段（弱引用解绑，不删流水）
    const td1 = await db.todos.get('td1')
    expect(td1?.customerIds).toEqual(['c-keep'])
  })
})

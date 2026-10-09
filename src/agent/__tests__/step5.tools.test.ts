/**
 * P1 第 5 步对照测试（方案 §9.6.1 打卡收口 / §2.2 读工具投影白名单与条数上限 / §2.3 幂等语义）
 *
 * 覆盖三块：
 *  A. checkinHabit / uncheckHabit 收口 —— 幂等、仅实际新建才 emit、事务 commit 后 emit
 *  B. habit_checkin 工具 —— 走收口函数、目标态幂等、取消不 emit、习惯不存在可操作错误
 *  C. 读工具 —— 投影白名单（不含 Blob/relations 全量/markdown）、条数上限截断、只走活记录
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { eventBus, type AppEvent } from '@/shared/eventBus'
import { checkinHabit, uncheckHabit, habitLogId, habitRepo } from '@/repositories'
import { habit_checkin, dispatchAgentTool } from '../executor'
import { READ_LIMITS } from '../reads'
import type { Customer, Habit, Note, Todo, Transaction } from '@/db/types'

type Captured = { event: keyof AppEvent; payload: unknown }

function capture(): { events: Captured[]; restore: () => void } {
  const events: Captured[] = []
  const orig = eventBus.emit.bind(eventBus)
  eventBus.emit = (event: keyof AppEvent, payload: unknown) => {
    events.push({ event, payload })
    ;(orig as unknown as (e: keyof AppEvent, p: unknown) => void)(event, payload)
  }
  return { events, restore: () => { eventBus.emit = orig } }
}

const TODAY = '2026-09-10'

function newHabit(id: string, over: Partial<Habit> = {}): Habit {
  return {
    id, name: '晨跑', icon: 'directions_run', color: '#000', category: '健康', schedule: '每日',
    targetMinutes: 0, motivationNote: '', crossModuleSync: false, createdAt: 1,
    updatedAt: 0, deleted: 0, rev: 0, ...over,
  } as Habit
}

function newTxn(id: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id, ledgerId: 'l1', type: 'expense', amount: 120, summary: '晚饭', channel: '',
    occurredAt: Date.now(), tags: [], status: '待对账',
    createdAt: Date.now(), updatedAt: 0, deleted: 0, rev: 0, ...over,
  } as Transaction
}

function newCustomer(id: string, over: Partial<Customer> = {}): Customer {
  return {
    id, name: '王五', company: '深蓝科技', title: '采购经理', decisionLevel: '决策人',
    tags: [], phone: '', wechat: '', email: '', address: '', lastContactAt: 0, createdAt: 1,
    updatedAt: 0, deleted: 0, rev: 0, ...over,
  } as Customer
}

function newTodo(id: string, over: Partial<Todo> = {}): Todo {
  return {
    id, title: '回访王五', desc: '', priority: 'mid', status: 'todo', createdAt: Date.now(),
    updatedAt: 0, deleted: 0, rev: 0, ...over,
  } as Todo
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('A. checkinHabit / uncheckHabit 收口（§9.6.1）', () => {
  it('首次打卡：落确定性 id、返回 created:true、事务 commit 后 emit 一次', async () => {
    await habitRepo.put(newHabit('h1'))
    const cap = capture()
    const r = await checkinHabit('h1', TODAY)
    cap.restore()

    expect(r).toEqual({ created: true })
    const log = await db.habitLogs.get(habitLogId('h1', TODAY))
    expect(log).toBeTruthy()
    expect(log!.habitId).toBe('h1')
    expect(log!.date).toBe(TODAY)
    expect(cap.events).toHaveLength(1)
    expect(cap.events[0].event).toBe('habit:checked')
    expect(cap.events[0].payload).toEqual({ habitId: 'h1', date: TODAY })
  })

  it('重复打卡幂等：不落库、不重复 emit（外部 Agent 重试安全）', async () => {
    await habitRepo.put(newHabit('h1'))
    await checkinHabit('h1', TODAY)
    const before = await db.syncQueue.count()
    const cap = capture()
    const r = await checkinHabit('h1', TODAY)
    cap.restore()

    expect(r).toEqual({ created: false })
    expect(cap.events).toHaveLength(0)
    expect(await db.syncQueue.count()).toBe(before)
  })

  it('取消打卡：软删确定性 id、不 emit', async () => {
    await habitRepo.put(newHabit('h1'))
    await checkinHabit('h1', TODAY)
    const cap = capture()
    await uncheckHabit('h1', TODAY)
    cap.restore()

    expect(cap.events).toHaveLength(0)
    const log = await db.habitLogs.get(habitLogId('h1', TODAY))
    expect(log!.deleted).toBe(1)
    // 复活：软删后再打卡视为新建，仍 emit
    const cap2 = capture()
    const r = await checkinHabit('h1', TODAY)
    cap2.restore()
    expect(r).toEqual({ created: true })
    expect(cap2.events).toHaveLength(1)
  })

  it('evidence 可选透传（专注→习惯联动证据文案）', async () => {
    await habitRepo.put(newHabit('h1'))
    await checkinHabit('h1', TODAY, { evidence: '深度专注 30 分钟' })
    const log = await db.habitLogs.get(habitLogId('h1', TODAY))
    expect(log!.evidence).toBe('深度专注 30 分钟')
  })
})

describe('B. habit_checkin 工具', () => {
  it('打卡走收口函数，返回 checked/created，仅实际新建才 emit', async () => {
    await habitRepo.put(newHabit('h1'))
    const cap = capture()
    const r1 = await habit_checkin({ habitId: 'h1', date: TODAY })
    const r2 = await habit_checkin({ habitId: 'h1', date: TODAY })
    cap.restore()

    expect(r1.ok).toBe(true)
    expect(r1.data).toMatchObject({ habitId: 'h1', date: TODAY, checked: true, created: true })
    expect(r2.data).toMatchObject({ checked: true, created: false })
    expect(cap.events).toHaveLength(1)
  })

  it('undo:true 取消打卡且不 emit', async () => {
    await habitRepo.put(newHabit('h1'))
    await checkinHabit('h1', TODAY)
    const cap = capture()
    const r = await habit_checkin({ habitId: 'h1', date: TODAY, undo: true })
    cap.restore()

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ checked: false })
    expect(cap.events).toHaveLength(0)
    expect((await db.habitLogs.get(habitLogId('h1', TODAY)))!.deleted).toBe(1)
  })

  it('习惯不存在 → 可操作错误，不静默落库', async () => {
    const r = await habit_checkin({ habitId: 'nope', date: TODAY })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('习惯不存在')
    expect(await db.habitLogs.count()).toBe(0)
  })

  it('经白名单闸门分发（habit 域）', async () => {
    await habitRepo.put(newHabit('h1'))
    const denied = await dispatchAgentTool('habit_checkin', { habitId: 'h1', date: TODAY }, { habit: false })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('不在能力白名单内')
    const allowed = await dispatchAgentTool('habit_checkin', { habitId: 'h1', date: TODAY }, { habit: true })
    expect(allowed.ok).toBe(true)
  })
})

describe('C. 读工具：投影白名单 + 条数上限（§2.2 / §10.4）', () => {
  it('listTransactions 投影不含附件/note，返回信封含 count/truncated', async () => {
    await db.transactions.put(newTxn('t1', { note: '机密备注', invoiceNo: 'INV-1' }))
    const r = await dispatchAgentTool('listTransactions', {})
    expect(r.ok).toBe(true)
    const items = r.data!.items as Record<string, unknown>[]
    expect(items[0]).toMatchObject({ id: 't1', amount: 120, status: '待对账' })
    // 白名单外字段不下发
    expect(items[0]).not.toHaveProperty('note')
    expect(items[0]).not.toHaveProperty('invoiceNo')
    expect(r.data!.count).toBe(1)
    expect(r.data!.truncated).toBe(false)
  })

  it('投影输出侧保留 customerId 等单值过渡别名（向后兼容已分发的 Agent 契约）', async () => {
    await db.transactions.put(newTxn('t1', { customerIds: ['c1', 'c2'], todoIds: ['td1'], projectIds: ['p1'] }))
    const r = await dispatchAgentTool('listTransactions', {})
    expect(r.ok).toBe(true)
    const items = r.data!.items as Record<string, unknown>[]
    // 数组是真源；单值键 = 数组首元素的只读别名（不落库）
    expect(items[0].customerIds).toEqual(['c1', 'c2'])
    expect(items[0].customerId).toBe('c1')
    expect(items[0].projectIds).toEqual(['p1'])
    expect(items[0].projectId).toBe('p1')
    expect(items[0].todoIds).toEqual(['td1'])
    expect(items[0].todoId).toBe('td1')
  })

  it('listTransactions 支持 customerId/status/日期范围过滤', async () => {
    // Issue #140：关联字段数组化，且一笔流水可挂多个客户（按数组包含匹配）
    await db.transactions.put(
      newTxn('t1', { customerIds: ['c1'], occurredAt: Date.parse('2026-09-01') }),
    )
    await db.transactions.put(
      newTxn('t2', { customerIds: ['c2'], occurredAt: Date.parse('2026-09-20') }),
    )
    // t3 同时挂 c1 + c2：两个客户视角都应命中（分摊多客户的真实场景）
    await db.transactions.put(
      newTxn('t3', { customerIds: ['c1', 'c2'], occurredAt: Date.parse('2026-09-25') }),
    )
    const byCustomer = await dispatchAgentTool('listTransactions', { customerId: 'c1' })
    expect((byCustomer.data!.items as { id: string }[]).map((i) => i.id).sort()).toEqual([
      't1',
      't3',
    ])
    const byCustomer2 = await dispatchAgentTool('listTransactions', { customerId: 'c2' })
    expect((byCustomer2.data!.items as { id: string }[]).map((i) => i.id).sort()).toEqual([
      't2',
      't3',
    ])
    const byRange = await dispatchAgentTool('listTransactions', {
      from: '2026-09-10',
      to: '2026-09-30',
    })
    expect((byRange.data!.items as { id: string }[]).map((i) => i.id).sort()).toEqual(['t2', 't3'])
  })

  it('listTransactions 超上限截断并标记 truncated', async () => {
    for (let i = 0; i < READ_LIMITS.listTransactions + 5; i++) {
      await db.transactions.put(newTxn(`t${i}`))
    }
    const r = await dispatchAgentTool('listTransactions', {})
    expect((r.data!.items as unknown[]).length).toBe(READ_LIMITS.listTransactions)
    expect(r.data!.truncated).toBe(true)
  })

  it('getCustomer 投影不含 relations 全量，仅 relationCount；软删返回空', async () => {
    await db.customers.put(
      newCustomer('c1', { relations: [{ id: 'r1', targetId: 'c2', label: '转介绍人' }] }),
    )
    const r = await dispatchAgentTool('getCustomer', { id: 'c1' })
    const item = (r.data!.items as Record<string, unknown>[])[0]
    expect(item).toMatchObject({ id: 'c1', name: '王五', company: '深蓝科技', relationCount: 1 })
    expect(item).not.toHaveProperty('relations')

    await db.customers.put(newCustomer('cX', { deleted: 1 }))
    const dead = await dispatchAgentTool('getCustomer', { id: 'cX' })
    expect(dead.data!.count).toBe(0)
  })

  it('listTodos / listLedgers / listHabits 最小投影', async () => {
    await db.todos.put(newTodo('td1', { desc: '不应下发的大字段' }))
    const todos = await dispatchAgentTool('listTodos', {})
    const t = (todos.data!.items as Record<string, unknown>[])[0]
    expect(t).toMatchObject({ id: 'td1', title: '回访王五', status: 'todo' })
    expect(t).not.toHaveProperty('desc')

    await db.ledgers.put({
      id: 'l1', name: '主账本', currency: 'CNY', openingBalance: 500, closingCycle: '月结',
      isDefault: true, sortOrder: 0, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0,
    })
    const ledgers = await dispatchAgentTool('listLedgers', {})
    expect((ledgers.data!.items as Record<string, unknown>[])[0]).toMatchObject({
      id: 'l1', name: '主账本', currency: 'CNY', isDefault: true,
    })

    await habitRepo.put(newHabit('h1'))
    const habits = await dispatchAgentTool('listHabits', {})
    expect((habits.data!.items as Record<string, unknown>[])[0]).toMatchObject({ id: 'h1', name: '晨跑' })
  })

  it('searchEntities 复用 6 实体投影；notes 走字段裁剪（不含 markdown）', async () => {
    await db.notes.put({
      id: 'n1', title: '深蓝科技会议纪要', markdown: '# 机密全文'.repeat(100), tags: ['会议'],
      backlinks: [], mentions: [], createdAt: 1, updatedAt: 0, deleted: 0, rev: 0,
    } as Note)
    await db.customers.put(newCustomer('c1'))
    const r = await dispatchAgentTool('searchEntities', { q: '深蓝' })
    const items = r.data!.items as Record<string, unknown>[]
    expect(items.map((i) => i.id).sort()).toEqual(['c1', 'n1'])
    const note = items.find((i) => i.id === 'n1')!
    expect(note).not.toHaveProperty('markdown')
  })

  it('searchEntities 的待办结果带档位语义（与 listTodos 同源，Issue #148 后续）', async () => {
    await db.todos.put({
      id: 'td:p1', title: '深蓝续约', desc: '', priority: 'P1', status: 'todo',
      createdAt: 1, updatedAt: 0, deleted: 0, rev: 0,
    } as never)
    const r = await dispatchAgentTool('searchEntities', { q: '深蓝', types: ['todo'] })
    const todo = (r.data!.items as Record<string, unknown>[])[0] as {
      priority: string
      priorityLabel: string
    }
    // 存量 P1 归一化为 high，并给出四档全称 —— 老 Agent 不再把档位当 P1/P2/P3 解释
    expect(todo.priority).toBe('high')
    expect(todo.priorityLabel).toBe('高 · 重要紧急')
  })

  it('searchEntities 支持 types 过滤', async () => {
    await db.customers.put(newCustomer('c1'))
    await db.notes.put({
      id: 'n1', title: '深蓝科技', markdown: 'x', tags: [], backlinks: [], mentions: [],
      createdAt: 1, updatedAt: 0, deleted: 0, rev: 0,
    } as Note)
    const r = await dispatchAgentTool('searchEntities', { q: '深蓝', types: ['customer'] })
    expect((r.data!.items as { id: string }[]).map((i) => i.id)).toEqual(['c1'])
  })

  it('读工具有域归属（read）且关闭 read 域后不可见', async () => {
    const { visibleToolNames } = await import('../executor')
    const names = visibleToolNames({ read: false })
    for (const n of ['resolveEntity', 'searchEntities', 'getCustomer', 'listTransactions', 'listTodos', 'listLedgers', 'listHabits']) {
      expect(names).not.toContain(n)
    }
    expect(visibleToolNames()).toContain('listTransactions')
  })
})

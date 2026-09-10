/**
 * 待办三态（Issue #128）对照测试
 *
 * 覆盖：
 * ① 状态判定互斥（todo/done/voided 三态，open/done/voided 判定两两不重叠）；
 * ② 「全部待办」口径 = 只含未完成（已完成、已作废都不混入）；
 * ③ 作废/恢复/完成/取消完成 四个动作的字段成对写入纪律（completedAt 与 voidedAt 互斥）；
 * ④ 作废条目不进「今天/逾期」口径（终止就不催办）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import type { Todo } from '@/db/types'
import {
  isTodoOpen,
  isTodoDone,
  isTodoVoided,
  isTodoFinished,
  todoStatusLabel,
  isDueToday,
  backfillTodoVoidedAt,
} from '../domain'
import { setTodoVoided, voidTodo, restoreTodo, toggleTodoDone } from '../toggle'

const base = { desc: '', updatedAt: 0, deleted: 0 as const, rev: 0, createdAt: 1 }

function mk(id: string, status: Todo['status'], extra: Partial<Todo> = {}): Todo {
  return { ...base, id, title: `任务 ${id}`, priority: 'P2', status, ...extra }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('① 三态判定互斥', () => {
  it('open / done / voided 判定两两不重叠，且三态并集 == 全部记录', () => {
    const rows = [mk('a', 'todo'), mk('b', 'done'), mk('c', 'voided')]
    for (const t of rows) {
      const flags = [isTodoOpen(t), isTodoDone(t), isTodoVoided(t)]
      expect(flags.filter(Boolean)).toHaveLength(1)
    }
    expect(rows.filter(isTodoOpen).map((t) => t.id)).toEqual(['a'])
    expect(rows.filter(isTodoDone).map((t) => t.id)).toEqual(['b'])
    expect(rows.filter(isTodoVoided).map((t) => t.id)).toEqual(['c'])
    // isTodoFinished = 非未完成（完成 ∪ 作废）
    expect(rows.filter(isTodoFinished).map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('状态文案三态一一对应', () => {
    expect(todoStatusLabel({ status: 'todo' })).toBe('待处理')
    expect(todoStatusLabel({ status: 'done' })).toBe('已完成')
    expect(todoStatusLabel({ status: 'voided' })).toBe('已作废')
  })

  it('②「全部待办」只装未完成：已完成与已作废都不混入', () => {
    const rows = [mk('a', 'todo'), mk('b', 'done'), mk('c', 'voided')]
    expect(rows.filter(isTodoOpen).map((t) => t.id)).toEqual(['a'])
  })
})

describe('③ 动作字段成对写入纪律', () => {
  it('作废：status=voided + voidedAt，且清空 completedAt（互斥）', async () => {
    const todo = mk('t1', 'todo')
    await db.todos.put(todo)
    const next = await voidTodo(todo)
    expect(next.status).toBe('voided')
    expect(next.voidedAt).toBeGreaterThan(0)
    expect(next.completedAt).toBeUndefined()
    // 落库校验（不只是内存对象）
    const stored = await db.todos.get('t1')
    expect(stored?.status).toBe('voided')
    expect(stored?.voidedAt).toBe(next.voidedAt)
  })

  it('已完成的待办被作废时：completedAt 清空，完成率不再误计', async () => {
    const doneTodo = mk('t2', 'done', { completedAt: 1000 })
    await db.todos.put(doneTodo)
    const next = await setTodoVoided(doneTodo, true)
    expect(next.status).toBe('voided')
    expect(next.completedAt).toBeUndefined()
    expect(next.voidedAt).toBeGreaterThan(0)
  })

  it('恢复：回到 todo 且 voidedAt / completedAt 一并清空', async () => {
    const voided = mk('t3', 'voided', { voidedAt: 2000 })
    await db.todos.put(voided)
    const next = await restoreTodo(voided)
    expect(next.status).toBe('todo')
    expect(next.voidedAt).toBeUndefined()
    expect(next.completedAt).toBeUndefined()
  })

  it('打勾完成会清掉 voidedAt（避免两个时间戳并存污染统计）', async () => {
    const t = mk('t4', 'todo', { voidedAt: 3000 })
    await db.todos.put(t)
    const next = await toggleTodoDone({ ...t, voidedAt: undefined, status: 'todo' })
    expect(next.status).toBe('done')
    expect(next.completedAt).toBeGreaterThan(0)
    expect(next.voidedAt).toBeUndefined()
  })

  it('幂等：已是目标态时不落库、不推进时间戳', async () => {
    const voided = mk('t5', 'voided', { voidedAt: 5000 })
    await db.todos.put(voided)
    const next = await setTodoVoided(voided, true)
    expect(next.voidedAt).toBe(5000)
    // 未落库 → 同步队列为空
    expect(await db.syncQueue.count()).toBe(0)
  })
})

describe('④ 作废不进「今天 / 逾期」催办口径', () => {
  const today = '2026-09-10'
  it('作废条目即使截止日在今天也不算 dueToday', () => {
    const voided = mk('v1', 'voided', { dueAt: new Date('2026-09-09T10:00:00').getTime() })
    expect(isDueToday(voided, today)).toBe(false)
  })

  it('未完成且逾期 → 仍算 dueToday（既有口径不回归）', () => {
    const overdue = mk('o1', 'todo', { dueAt: new Date('2026-09-09T10:00:00').getTime() })
    expect(isDueToday(overdue, today)).toBe(true)
  })
})

describe('⑤ 存量兜底 backfillTodoVoidedAt（启动链已接线）', () => {
  it('voided 缺 voidedAt 的记录被补盖时间戳并推同步队列，其余记录不受影响', async () => {
    await db.todos.put(mk('v-missing', 'voided'))
    await db.todos.put(mk('v-ok', 'voided', { voidedAt: 111 }))
    await db.todos.put(mk('open-1', 'todo'))
    const n = await backfillTodoVoidedAt()
    expect(n).toBe(1)
    const fixed = await db.todos.get('v-missing')
    expect(fixed?.voidedAt).toBeGreaterThan(0)
    // 已有时间戳的不动、未完成的不动
    expect((await db.todos.get('v-ok'))?.voidedAt).toBe(111)
    expect((await db.todos.get('open-1'))?.voidedAt).toBeUndefined()
    // 补盖必须入同步队列（跨设备同步不丢）
    expect(await db.syncQueue.where('recordId').equals('v-missing').count()).toBe(1)
  })

  it('幂等：重复执行不再命中（第二次返回 0）', async () => {
    await db.todos.put(mk('v-idem', 'voided'))
    expect(await backfillTodoVoidedAt()).toBe(1)
    expect(await backfillTodoVoidedAt()).toBe(0)
  })
})

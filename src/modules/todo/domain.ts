/**
 * 待办领域常量与工具 —— 全站状态口径的唯一来源
 *
 * 背景（Issue #74 口径统一讨论）：
 * - status 收窄为两态：'todo' | 'done'。原 'doing' 是死枚举（全仓零写入、
 *   零专属展示），「专注中」是 focus store 的运行时 UI 状态，不落库。
 * - 未完成判断统一用 isTodoOpen()，禁止各处手写 status !== 'done'。
 * - 状态文案统一用 todoStatusLabel()，禁止各模块自己写三元表达式。
 */
import dayjs from 'dayjs'
import { db } from '@/db/db'
import { syncEngine } from '@/sync/engine'
import type { Todo } from '@/db/types'

export type TodoStatus = Todo['status']

/** 未完成（待处理）判定：所有「未完成」口径的唯一入口 */
export function isTodoOpen(t: Pick<Todo, 'status'>): boolean {
  return t.status === 'todo'
}

/** 状态文案：todo → 待处理 / done → 已完成 */
export function todoStatusLabel(t: Pick<Todo, 'status'>): string {
  return t.status === 'done' ? '已完成' : '待处理'
}

/**
 * 「今天」口径（待办软件通行做法）：今日截止 ∪ 逾期未完成。
 * 待办中心筛选/计数、工作台今日日程卡、待办达成分母统一引用本函数。
 */
export function isDueToday(t: Pick<Todo, 'status' | 'dueAt'>, todayStr: string): boolean {
  if (t.status !== 'todo' || !t.dueAt) return false
  return dayjs(t.dueAt).format('YYYY-MM-DD') <= todayStr
}

/**
 * 存量数据兜底（一次性，幂等）：凡 status='done' 但缺 completedAt 的待办，
 * 以 updatedAt 补盖完成时间。没有这条兜底，「今日已完成」统计、CRM 时间轴、
 * 工作台完成数（均要求 completedAt）会静默漏计这些记录。
 * 兼容历史散写路径（灵感/CRM 等曾直接写 status='done' 不写 completedAt）。
 */
export async function backfillTodoCompletedAt(): Promise<number> {
  const todos = await db.todos.toArray()
  const need = todos.filter((t) => !t.deleted && t.status === 'done' && !t.completedAt)
  if (need.length === 0) return 0
  const now = Date.now()
  await db.transaction('rw', [db.todos, db.syncQueue], async () => {
    for (const t of need) {
      await db.todos.put({
        ...t,
        completedAt: t.updatedAt || now,
        updatedAt: now,
        rev: t.rev + 1,
      })
      await db.syncQueue.add({
        table: 'todos',
        recordId: t.id,
        op: 'upsert',
        createdAt: now,
      })
    }
  })
  syncEngine.requestSync()
  return need.length
}

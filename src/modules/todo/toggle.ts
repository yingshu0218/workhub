import { todoRepo } from '@/repositories'
import type { Todo } from '@/db/types'

/**
 * 待办完成状态切换（唯一入口）—— Issue #74
 *
 * 背景：完成态由 status + completedAt 两个字段共同表达，多个入口（待办中心、
 * 工作台今日日程卡、灵感转待办）各自散写，容易出现「只改 status 不清 / 不盖
 * completedAt」的不一致写入，导致完成态丢失。
 *
 * 语义：
 * - 未完成 → 完成：status='done' 且 completedAt=now
 *   （completedAt 是「今日已完成」统计与 CRM 时间轴的唯一依据，必须成对写入）
 * - 完成 → 未完成：status='todo' 且显式清空 completedAt
 *   （put 为整体覆盖，字段残留会让记录带着旧完成时间被重新统计）
 *
 * 口径统一（Issue #74）：status 已收窄为两态 'todo' | 'done'，'doing' 死枚举已移除；
 * 「专注中」是 focus store 的运行时 UI 状态，不落库。
 */
export async function toggleTodoDone(todo: Todo): Promise<Todo> {
  const done = todo.status === 'done'
  const next: Todo = done
    ? { ...todo, status: 'todo', completedAt: undefined }
    : { ...todo, status: 'done', completedAt: Date.now() }
  await todoRepo.put(next)
  return next
}

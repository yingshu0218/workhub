import { todoRepo } from '@/repositories'
import type { Todo } from '@/db/types'

/**
 * 待办状态变更入口（唯一）—— Issue #74 / Issue #128
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
 * - 作废（Issue #128）：status='voided' 且 voidedAt=now，同时清空 completedAt
 *   —— 作废是终止而非完成，两个时间戳不可同时存在，否则完成率会误计。
 * - 恢复（Issue #128）：回到 status='todo'，completedAt / voidedAt 一并清空。
 *
 * 口径统一：status 为三态 'todo' | 'done' | 'voided'，'doing' 死枚举已移除；
 * 「专注中」是 focus store 的运行时 UI 状态，不落库。
 */
export async function toggleTodoDone(todo: Todo): Promise<Todo> {
  const done = todo.status === 'done'
  const next: Todo = done
    ? // 取消完成/从已完成恢复：同时清掉作废时间，保证「回到未完成」是干净态
      { ...todo, status: 'todo', completedAt: undefined, voidedAt: undefined }
    : { ...todo, status: 'done', completedAt: Date.now(), voidedAt: undefined }
  await todoRepo.put(next)
  return next
}

/**
 * 作废 / 恢复 —— Issue #128
 *
 * 「作废」= 事项终止，与「删除」（软删、记录消失）严格区分：
 * 记录保留、可查、可恢复，只是不再是待办、不再催办、不计完成率。
 *
 * @param todo 目标待办（UI 传列表实时记录）
 * @param voided 目标态：true 作废，false 恢复为未完成
 * @returns 幂等——已是目标态时直接返回原记录，不落库（避免多推一次同步队列）
 */
export async function setTodoVoided(todo: Todo, voided = true): Promise<Todo> {
  const target: Todo['status'] = voided ? 'voided' : 'todo'
  if (todo.status === target) return todo
  const next: Todo = voided
    ? { ...todo, status: 'voided', voidedAt: Date.now(), completedAt: undefined }
    : { ...todo, status: 'todo', voidedAt: undefined, completedAt: undefined }
  await todoRepo.put(next)
  return next
}

/**
 * 一键作废（列表行「作废」按钮入口）：语义同 setTodoVoided(todo, true)，
 * 封装成动词便于 UI 侧读起来是「动作」而非「设置状态位」。
 */
export function voidTodo(todo: Todo): Promise<Todo> {
  return setTodoVoided(todo, true)
}

/** 一键恢复（已作废列表行「恢复」按钮入口）：回到未完成 */
export function restoreTodo(todo: Todo): Promise<Todo> {
  return setTodoVoided(todo, false)
}

import { db } from '@/db/db'
import { newId } from '@/repositories'
import type { TodoList, Todo } from '@/db/types'
import { useQuery } from '@/queries/hooks'
import { syncEngine } from '@/sync/engine'
import dayjs from 'dayjs'

/**
 * 待办清单数据层（模块内合法 Dexie 访问层，组件禁止直连）
 * 自定义清单：增删改 + 拖拽排序 + 级联解绑
 */

/** 订阅自定义清单（按 sortOrder 排序，过滤软删） */
export function useTodoLists(): TodoList[] {
  const lists = useQuery<TodoList[]>(async () => {
    const all = await db.todoLists.toArray()
    return all.filter((l) => !l.deleted).sort((a, b) => a.sortOrder - b.sortOrder)
  }, [])
  return lists ?? []
}

/** 新建清单 */
export async function createTodoList(name: string): Promise<TodoList> {
  const existing = await db.todoLists.toArray()
  const alive = existing.filter((l) => !l.deleted)
  const list: TodoList = {
    id: newId('tl'),
    name: name.trim(),
    // 取当前最大 sortOrder + 1：用「列表长度」在删除后会产生重号（如 0,2,3 后再新建又得 3）
    sortOrder: alive.reduce((max, l) => Math.max(max, l.sortOrder), -1) + 1,
    createdAt: Date.now(),
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
  const now = Date.now()
  await db.transaction('rw', [db.todoLists, db.syncQueue], async () => {
    await db.todoLists.put({ ...list, updatedAt: now, rev: 1 })
    await db.syncQueue.add({ table: 'todoLists', recordId: list.id, op: 'upsert', createdAt: now })
  })
  syncEngine.requestSync()
  return list
}

/** 重命名 */
export async function renameTodoList(id: string, name: string): Promise<void> {
  const prev = await db.todoLists.get(id)
  if (!prev || prev.deleted) return
  const now = Date.now()
  await db.transaction('rw', [db.todoLists, db.syncQueue], async () => {
    await db.todoLists.put({ ...prev, name: name.trim(), updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({ table: 'todoLists', recordId: id, op: 'upsert', createdAt: now })
  })
  syncEngine.requestSync()
}

/** 删除清单（级联：名下待办解绑 listId 归入「全部待办」） */
export async function deleteTodoListCascade(id: string): Promise<void> {
  const prev = await db.todoLists.get(id)
  if (!prev) return
  const now = Date.now()
  const todos = await db.todos.where('listId').equals(id).toArray()
  await db.transaction('rw', [db.todoLists, db.todos, db.syncQueue], async () => {
    if (prev) {
      await db.todoLists.put({ ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
      await db.syncQueue.add({ table: 'todoLists', recordId: id, op: 'delete', createdAt: now })
    }
    // 含已软删待办一并解绑：否则其 listId 指向已删清单，UI 上既不在任何清单、也不进「收集箱」
    for (const t of todos) {
      await db.todos.put({ ...t, listId: undefined, updatedAt: now, rev: t.rev + 1 })
      await db.syncQueue.add({ table: 'todos', recordId: t.id, op: 'upsert', createdAt: now })
    }
  })
  syncEngine.requestSync()
}

/** 拖拽排序：按传入的 id 顺序重写 sortOrder */
export async function reorderTodoLists(orderedIds: string[]): Promise<void> {
  const now = Date.now()
  const all = await db.todoLists.toArray()
  await db.transaction('rw', [db.todoLists, db.syncQueue], async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      const l = all.find((x) => x.id === orderedIds[i])
      if (!l || l.sortOrder === i) continue
      await db.todoLists.put({ ...l, sortOrder: i, updatedAt: now, rev: l.rev + 1 })
      await db.syncQueue.add({ table: 'todoLists', recordId: l.id, op: 'upsert', createdAt: now })
    }
  })
  syncEngine.requestSync()
}

/** 各清单的未完成计数 */
export function useTodoListCounts(): Record<string, number> {
  const lists = useQuery<TodoList[]>(
    async () => (await db.todoLists.toArray()).filter((l) => !l.deleted),
    [],
  )
  const counts = useQuery<Record<string, number>>(async () => {
    const todos = await db.todos.toArray()
    const map: Record<string, number> = {}
    for (const t of todos) {
      if (t.deleted || t.status === 'done' || !t.listId) continue
      map[t.listId] = (map[t.listId] ?? 0) + 1
    }
    return map
  }, [lists?.length])
  return counts ?? {}
}

/** 待办表单用：可选清单选项 */
export function useTodoListOptions(): { id: string; name: string }[] {
  const lists = useTodoLists()
  return lists.map((l) => ({ id: l.id, name: l.name }))
}

/** 供类型引用（防 dayjs 未用告警的占位导出不必要——保留工具函数） */
export const todayKey = () => dayjs().format('YYYY-MM-DD')

/** 类型 占位（Todo 引用防 tree-shake 误报） */
export type { Todo }

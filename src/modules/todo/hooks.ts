import { db } from '@/db/db'
import { storage } from '@/storage'
import { newId } from '@/repositories'
import type { TodoList, Todo } from '@/db/types'
import { useQuery } from '@/queries/hooks'
import { isTodoOpen } from './domain'
import dayjs from 'dayjs'

/**
 * 待办清单数据层（模块内查询层，组件不直连存储）
 * 自定义清单：增删改 + 拖拽排序 + 级联解绑
 *
 * ⚠️ 写入口纪律（2026-10-21 审计 P1 收口）：本文件**禁止** `db.transaction` 直写。
 * 读走 `db.*`（订阅/查询），**写一律经 `storage.transaction`（StorageAdapter 原语）**
 * —— 这样换存储（Tauri SQLite）时写入路径随之迁移，而 Dexie 直写会留下不迁移的死角。
 * 判据与样板见 `repositories/index.ts#deleteHabitCascade` 与 `modules/todo/cascade.ts`。
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
  const all = await storage.list<TodoList>('todoLists')
  const alive = all.filter((l) => !l.deleted)
  const now = Date.now()
  const list: TodoList = {
    id: newId('tl'),
    name: name.trim(),
    // 取当前最大 sortOrder + 1：用「列表长度」在删除后会产生重号（如 0,2,3 后再新建又得 3）
    sortOrder: alive.reduce((max, l) => Math.max(max, l.sortOrder), -1) + 1,
    createdAt: now,
    updatedAt: now,
    deleted: 0,
    rev: 1,
  }
  await storage.transaction(['todoLists', 'syncQueue'], async (tx) => {
    await tx.put('todoLists', list)
    await tx.enqueue('todoLists', list.id, 'upsert', now)
  })
  storage.requestSync()
  return list
}

/** 重命名 */
export async function renameTodoList(id: string, name: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['todoLists', 'syncQueue'], async (tx) => {
    const prev = await tx.get<TodoList>('todoLists', id)
    if (!prev || prev.deleted) return
    await tx.put('todoLists', { ...prev, name: name.trim(), updatedAt: now, rev: prev.rev + 1 })
    await tx.enqueue('todoLists', id, 'upsert', now)
  })
  storage.requestSync()
}

/**
 * 删除清单（级联：名下待办解绑 listId 归入「全部待办」）
 *
 * Issue #169 P2-A：子表读取**在事务内**。此前 `db.todos.where('listId').equals(id).toArray()`
 * 在事务外先读、再进事务改，构成 TOCTOU 窗口 —— 窗口内新建的待办不会被解绑，
 * 留下「listId 指向已删清单」的悬挂外键（该待办既不在任何清单、也不进「收集箱」）。
 * `deleteCustomerCascade` / `deleteProjectCascade` / `deleteTodoCascade` 都在事务内读，本处此前是例外。
 */
export async function deleteTodoListCascade(id: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['todoLists', 'todos', 'syncQueue'], async (tx) => {
    const prev = await tx.get<TodoList>('todoLists', id)
    if (!prev || prev.deleted) return
    await tx.put('todoLists', { ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
    await tx.enqueue('todoLists', id, 'delete', now)
    // 含已软删待办一并解绑：否则其 listId 指向已删清单，UI 上既不在任何清单、也不进「收集箱」
    const todos = (await tx.list<Todo>('todos')).filter((t) => t.listId === id)
    for (const t of todos) {
      await tx.put('todos', { ...t, listId: undefined, updatedAt: now, rev: t.rev + 1 })
      await tx.enqueue('todos', t.id, 'upsert', now)
    }
  })
  storage.requestSync()
}


/** 拖拽排序：按传入的 id 顺序重写 sortOrder */
export async function reorderTodoLists(orderedIds: string[]): Promise<void> {
  const now = Date.now()
  await storage.transaction(['todoLists', 'syncQueue'], async (tx) => {
    const all = await tx.list<TodoList>('todoLists')
    for (let i = 0; i < orderedIds.length; i++) {
      const l = all.find((x) => x.id === orderedIds[i])
      if (!l || l.deleted || l.sortOrder === i) continue
      await tx.put('todoLists', { ...l, sortOrder: i, updatedAt: now, rev: l.rev + 1 })
      await tx.enqueue('todoLists', l.id, 'upsert', now)
    }
  })
  storage.requestSync()
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
      // 清单计数 = 未完成数（Issue #128）：已完成与已作废都不计入（与左栏智能清单口径一致）
      if (t.deleted || !isTodoOpen(t) || !t.listId) continue
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

// deleteTodoCascade 已拆至 './cascade'（P3：executor 执行链需要零 db/react 的纯实现）
export { deleteTodoCascade } from './cascade'

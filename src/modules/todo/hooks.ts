import { db } from '@/db/db'
import { newId, toLinkFieldPatch } from '@/repositories'
import { txnTodoIds } from '@/modules/finance/links'
import type { TodoList, Todo } from '@/db/types'
import { useQuery } from '@/queries/hooks'
import { syncEngine } from '@/sync/engine'
import { isTodoOpen } from './domain'
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

/**
 * 删除清单（级联：名下待办解绑 listId 归入「全部待办」）
 *
 * Issue #169 P2-A：子表读取**移入事务内**。此前 `db.todos.where('listId').equals(id).toArray()`
 * 在事务外先读、再进事务改，构成 TOCTOU 窗口 —— 窗口内新建的待办不会被解绑，
 * 留下「listId 指向已删清单」的悬挂外键（该待办既不在任何清单、也不进「收集箱」）。
 * `deleteCustomerCascade` / `deleteProjectCascade` / `deleteTodoCascade` 都在事务内读，本处此前是例外。
 */
export async function deleteTodoListCascade(id: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', [db.todoLists, db.todos, db.syncQueue], async () => {
    const prev = await db.todoLists.get(id)
    if (!prev) return
    await db.todoLists.put({ ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({ table: 'todoLists', recordId: id, op: 'delete', createdAt: now })
    // 含已软删待办一并解绑：否则其 listId 指向已删清单，UI 上既不在任何清单、也不进「收集箱」
    const todos = await db.todos.where('listId').equals(id).toArray()
    for (const t of todos) {
      await db.todos.put({ ...t, listId: undefined, updatedAt: now, rev: t.rev + 1 })
      await db.syncQueue.add({ table: 'todos', recordId: t.id, op: 'upsert', createdAt: now })
    }
  })
  syncEngine.requestSync()
}

/**
 * 待办级联删除（Issue #148 后续 · #140 审计留档项的收口）：
 * 软删待办的同时，把 `transactions.todoIds` 里指向它的关联**解绑**。
 *
 * 为什么必须级联（此前靠读取端兜底，属隐性欠账）：
 * `transactions.todoIds` 是弱引用数组，待办被删后读取端 `links.ts` 的
 * `pruneTxnLinkIds` / 存活实体过滤会把它滤掉，所以界面不炸 —— 但库里留下悬挂 id，
 * 后续任何**按 todoIds 直查**的路径（导出、统计、Agent 读投影）都会命中幽灵引用。
 * 与 `deleteCustomerCascade` / `deleteProjectCascade` 同款纪律：删除即解绑，
 * 悬挂由写入端消除，而不是全仓指望每一处读取都记得过滤。
 *
 * 单 Dexie 事务覆盖 todos / transactions / syncQueue，任一步失败整体回滚；
 * 待办不存在或已删除时静默返回（幂等）。
 *
 * @returns 解绑的流水条数（供 Agent 工具回传副作用清单 `sideEffects.unlinked`）
 */
export async function deleteTodoCascade(todoId: string): Promise<number> {
  const now = Date.now()
  let unlinked = 0
  await db.transaction('rw', [db.todos, db.transactions, db.syncQueue], async () => {
    const prev = await db.todos.get(todoId)
    if (!prev || prev.deleted) return

    await db.todos.put({ ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({ table: 'todos', recordId: todoId, op: 'delete', createdAt: now })

    // transactions.todoIds 已数组化（Issue #140 v11）：按数组解绑，空数组不落键（toLinkFieldPatch）。
    // 不能写 `todoId: undefined` —— 既解不掉数组里的 id，还会按「双写不双读」留下永不读取的旧键。
    const txns = (await db.transactions.filter((t) => !t.deleted).toArray()).filter((t) =>
      txnTodoIds(t).includes(todoId),
    )
    for (const txn of txns) {
      await db.transactions.update(txn.id, {
        ...toLinkFieldPatch('todoIds', txnTodoIds(txn).filter((id) => id !== todoId)),
        updatedAt: now,
        rev: txn.rev + 1,
      })
      await db.syncQueue.add({
        table: 'transactions',
        recordId: txn.id,
        op: 'upsert',
        createdAt: now,
      })
      unlinked++
    }
  })
  syncEngine.requestSync()
  return unlinked
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

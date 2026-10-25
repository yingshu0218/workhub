import { db } from '@/db/db'
import { storage } from '@/storage'
import { newId, setTodoList } from '@/repositories'
import { cascadeSoftDeleteLinks, memberIndexOf } from '@/repositories/links'
import type { Link } from '@/db/types'
import { nextSortOrder, reorderBySortOrder } from '@/repositories/sortOrder'
import type { TodoList, Todo, TrashSnapshot } from '@/db/types'
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
  const now = Date.now()
  const list: TodoList = {
    id: newId('tl'),
    name: name.trim(),
    // 尾值走收口实现（max+1，非 length —— length 在删除后会产生重号，见 repositories/sortOrder.ts）
    sortOrder: await nextSortOrder('todoLists'),
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
 * 删除清单（Phase 3 集合层版：成员 = member link，删除即统一墓碑化）
 *
 * 旧路径（解绑 listId 字段 + mode:'set' 快照）随 v16 整体退役：名下待办的 member link
 * 由 cascadeSoftDeleteLinks 与清单软删同事务墓碑化（含已软删待办的 link —— 与旧口径
 * 一致，不留悬挂归属），快照 `cascadeLinkIds` 留档；恢复时按「两端存活」逐条复活
 * （待办活着才回来，见 links.ts#reviveCascadeLinks）。待办行全程不动 —— 待办不属于
 * 任何清单后自然落入收集箱（无 member link = 收集箱口径）。
 */
export async function deleteTodoListCascade(id: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['todoLists', 'todos', 'links', 'syncQueue'], async (tx) => {
    const prev = await tx.get<TodoList>('todoLists', id)
    if (!prev || prev.deleted) return
    const cascadeLinkIds = await cascadeSoftDeleteLinks(tx, [{ type: 'todoLists', id }], now)
    const trashSnapshot: TrashSnapshot = {
      children: [],
      links: [],
      ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
    }
    await tx.update('todoLists', id, {
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot,
    })
    await tx.enqueue('todoLists', id, 'delete', now)
  })
  storage.requestSync()
}

/** 拖拽排序：按传入的 id 顺序重写 sortOrder（收口实现，见 repositories/sortOrder.ts） */
export async function reorderTodoLists(orderedIds: string[]): Promise<void> {
  await reorderBySortOrder('todoLists', orderedIds)
}

/** 各清单的未完成计数 */
export function useTodoListCounts(): Record<string, number> {
  const lists = useQuery<TodoList[]>(
    async () => (await db.todoLists.toArray()).filter((l) => !l.deleted),
    [],
  )
  const counts = useQuery<Record<string, number>>(async () => {
    const todos = await db.todos.toArray()
    // 归属已迁 links（v16）：kind='member' 索引代替行字段（useTodoListIdOf 同款口径）
    const links = await db.links
      .where('kind')
      .equals('member')
      .filter((l) => !l.deleted && l.fromType === 'todos' && l.toType === 'todoLists')
      .toArray()
    const listOf = memberIndexOf(links)
    const map: Record<string, number> = {}
    for (const t of todos) {
      // 清单计数 = 未完成数（Issue #128）：已完成与已作废都不计入（与左栏智能清单口径一致）
      const lid = listOf.get(t.id)
      if (t.deleted || !isTodoOpen(t) || !lid) continue
      map[lid] = (map[lid] ?? 0) + 1
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

/**
 * 待办 → 清单归属索引（Phase 3 读侧收口）：Map<todoId, listId>。
 * liveQuery 订阅 links 表 —— 拖拽/保存/级联/恢复/同步对 member link 的任何变更
 * 都自动重渲染消费组件。全页面共用一份（TodoPage 过滤与计数、详情抽屉、表单回填）。
 */
export function useTodoListIdOf(): Map<string, string> {
  const rows =
    useQuery<Link[]>(
      () =>
        db.links
          .where('kind')
          .equals('member')
          .filter((l) => !l.deleted && l.fromType === 'todos' && l.toType === 'todoLists')
          .toArray(),
      [],
    ) ?? EMPTY_MEMBER_ROWS
  return memberIndexOf(rows)
}

const EMPTY_MEMBER_ROWS: Link[] = []

export { setTodoList }

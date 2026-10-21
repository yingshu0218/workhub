import { storage } from '@/storage'
import { normalizeTodoPriority } from './priority'
import type { Todo } from '@/db/types'

/**
 * 待办存量数据兜底 / 显式迁移（agentOps 服务端化 P2 自 domain.ts 拆出）
 *
 * 拆出动机：`agent/serverReads.ts` 的服务端 bundle 经 `shared/search.ts#todoFocusPath`
 * 依赖 `modules/todo/domain`，而本组函数直用 Dexie（db/syncEngine）——留在 domain.ts
 * 会把 Dexie 拖进 Node 环境。纯口径函数（isTodoOpen / todoFocusPath 等）留在 domain.ts
 * 零依赖；本文件只装「需要存储访问」的存量数据动作。
 *
 * ⚠️ 写入经 `storage.transaction`（StorageAdapter 原语），不直写 Dexie
 * —— 审计 P1（2026-10-21）：模块直写 `db.transaction` 的 30 处不随存储迁移。
 */
export async function backfillTodoCompletedAt(): Promise<number> {
  const todos = await storage.list<Todo>('todos')
  const need = todos.filter((t) => !t.deleted && t.status === 'done' && !t.completedAt)
  if (need.length === 0) return 0
  const now = Date.now()
  await storage.transaction(['todos', 'syncQueue'], async (tx) => {
    for (const t of need) {
      await tx.put('todos', {
        ...t,
        completedAt: t.updatedAt || now,
        updatedAt: now,
        rev: t.rev + 1,
      })
      await tx.enqueue('todos', t.id, 'upsert', now)
    }
  })
  storage.requestSync()
  return need.length
}

/**
 * 存量数据迁移（**显式动作，非启动自动**）：把旧档位 `P1/P2/P3` 归一化为四档 `high/mid/low`。
 *
 * 为什么不做启动自动迁移（Issue #148 后续 · 上轮审计建议 4）：
 * `high|mid|low|none` 是 Dexie 的**合法键名**（与 v11 数组化那次「旧键是脏数据」不同），
 * 老数据 `P1/P2/P3` 读侧已被 `normalizeTodoPriority` 兜住，功能上无需改写；
 * 而自动把每条老记录 `rev+1` 会推进 `updatedAt`，进而破坏跨设备同步的 LWW 判据
 * （在本机没编辑过的记录会在其他设备上"胜出"覆盖）。故改为**用户显式触发**的一次性迁移：
 *
 * - 扫描未软删待办，凡档位不是四档合法值 => `normalizeTodoPriority` 归一化后落库 + 入同步队列；
 * - 幂等：已是新档位的记录不动、不入队（重复点击第二次返回 0）；
 * - 返回迁移条数，供 UI/Agent 如实反馈。
 */
export async function migrateLegacyTodoPriority(): Promise<number> {
  const todos = await storage.list<Todo>('todos')
  const need = todos.filter((t) => !t.deleted && t.priority !== normalizeTodoPriority(t.priority))
  if (need.length === 0) return 0
  const now = Date.now()
  await storage.transaction(['todos', 'syncQueue'], async (tx) => {
    for (const t of need) {
      await tx.put('todos', {
        ...t,
        priority: normalizeTodoPriority(t.priority),
        updatedAt: now,
        rev: t.rev + 1,
      })
      await tx.enqueue('todos', t.id, 'upsert', now)
    }
  })
  storage.requestSync()
  return need.length
}

/**
 * 存量数据兜底（一次性，幂等）：status='voided' 但缺 voidedAt 的待办补盖作废时间。
 * 与 backfillTodoCompletedAt 同款纪律（成对写入的字段不允许单边存在）。
 */
export async function backfillTodoVoidedAt(): Promise<number> {
  const todos = await storage.list<Todo>('todos')
  const need = todos.filter((t) => !t.deleted && t.status === 'voided' && !t.voidedAt)
  if (need.length === 0) return 0
  const now = Date.now()
  await storage.transaction(['todos', 'syncQueue'], async (tx) => {
    for (const t of need) {
      await tx.put('todos', {
        ...t,
        voidedAt: t.updatedAt || now,
        updatedAt: now,
        rev: t.rev + 1,
      })
      await tx.enqueue('todos', t.id, 'upsert', now)
    }
  })
  storage.requestSync()
  return need.length
}

/** 类型占位（防 Todo 未用告警） */
export type { Todo }

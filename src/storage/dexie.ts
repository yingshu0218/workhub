import type { StorageAdapter, StorageTx, SyncOp, TableName } from './types'

/**
 * DexieAdapter —— StorageAdapter 的浏览器端实现（P1；P2 重组为纯工厂）
 *
 * ⚠️ 本文件**不得顶层 import `@/db/db` / `@/sync/engine`**（P2 硬约束）：
 * 服务端执行器 bundle 会打包执行链（reads/resolver → storage），若这里静态 import db，
 * Dexie 就被拖进 Node 环境（`new NexusDB()` 需要 indexedDB，进程启动即炸）。
 * 依赖（db 实例 + 同步引擎）由 `storage/browser.ts` 注入；服务端注入 PocketBaseAdapter，互不相干。
 *
 * 设计要点（行为与 P1 直连版逐语义一致）：
 * - transaction 直映射 Dexie 原生事务（tables 数组含 syncQueue，与既有复合函数写法一致）；
 * - enqueue 直写 syncQueue 表（字段形状与既有 `db.syncQueue.add` 逐字段一致）；
 * - requestSync 代理 syncEngine.requestSync（与既有函数出口调用一致）。
 */

/** Dexie 最小形状视图（type-only import 不产生运行时依赖，db.ts 不进服务端 bundle） */
type DexieDB = typeof import('@/db/db')['db']
type SyncEngineLike = { requestSync(): void }

/** Dexie 表的窄形状视图（db.ts 表类型各异，此处只取执行链用到的方法） */
interface DexieTableLike {
  get(id: string): Promise<unknown>
  put(value: unknown): Promise<unknown>
  update(id: string, changes: Record<string, unknown>): Promise<number>
  toArray(): Promise<unknown[]>
}

export interface DexieAdapterDeps {
  db: DexieDB
  syncEngine: SyncEngineLike
}

function tableOf(deps: DexieAdapterDeps, name: TableName): DexieTableLike {
  const t = (deps.db as unknown as Record<string, DexieTableLike | undefined>)[name]
  if (!t) throw new Error(`[storage] 未知表：${name}（检查调用方表名拼写）`)
  return t
}

function makeTx(deps: DexieAdapterDeps): StorageTx {
  return {
    async get(table, id) {
      return (await tableOf(deps, table).get(id)) as never
    },
    async put(table, record) {
      await tableOf(deps, table).put(record)
    },
    async update(table, id, patch) {
      await tableOf(deps, table).update(id, patch)
    },
    async enqueue(table, recordId, op: SyncOp, createdAt) {
      await deps.db.syncQueue.add({ table, recordId, op, createdAt })
    },
    async list(table) {
      return (await tableOf(deps, table).toArray()) as never
    },
  }
}

export function createDexieAdapter(deps: DexieAdapterDeps): StorageAdapter {
  return {
    async transaction(tables, fn) {
      // 与既有复合函数同口径：事务表数组必须显式含 syncQueue（落库与入队同一原子单元）
      return deps.db.transaction(
        'rw',
        tables.map(
          (t) => (t === 'syncQueue' ? deps.db.syncQueue : (deps.db as unknown as Record<string, never>)[t]),
        ),
        async () => fn(makeTx(deps)),
      )
    },
    async get(table, id) {
      return (await tableOf(deps, table).get(id)) as never
    },
    async list(table) {
      return (await tableOf(deps, table).toArray()) as never
    },
    requestSync() {
      deps.syncEngine.requestSync()
    },
  }
}

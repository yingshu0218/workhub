import { db } from '@/db/db'
import { DEFAULT_WORKSPACE_ID } from '@/db/db'
import { nanoid } from 'nanoid'
import type { SyncMeta } from '@/db/types'
import { syncEngine } from '@/sync/engine'

/**
 * Repository 层 —— 存储可插拔的关键（开发计划 2.0/2.3）
 * 上层模块只依赖本接口，换存储（如 Tauri SQLite / SQLite WASM）仅需换实现。
 * 写入路径：统一盖章 updatedAt/rev → 落本地 → 进同步队列（在线时由引擎推送）
 */

/** 写入入参：同步元数据可缺省，由实现层统一盖章 */
export type PutInput<T> = Omit<T, keyof SyncMeta> & Partial<SyncMeta>

export interface Repository<T extends { id: string }> {
  get(id: string): Promise<T | undefined>
  list(): Promise<T[]>
  put(record: PutInput<T>): Promise<string>
  softDelete(id: string): Promise<void>
}

/** 模块级仓储工厂：注入 Dexie 表 */
export function createRepository<T extends { id: string } & Partial<SyncMeta>>(
  tableName: keyof typeof db,
): Repository<T> {
  const table = () => db[tableName] as unknown as {
    get(id: string): Promise<T | undefined>
    toArray(): Promise<T[]>
    put(record: T): Promise<string>
    update(id: string, changes: Partial<T>): Promise<number>
  }

  return {
    async get(id) {
      const rec = await table().get(id)
      return rec && !(rec as SyncMeta).deleted ? rec : undefined
    },

    async list() {
      const all = await table().toArray()
      return all.filter((r) => !(r as SyncMeta).deleted)
    },

    async put(record) {
      const now = Date.now()
      const prev = await table().get(record.id)
      const stamped = {
        ...record,
        updatedAt: now,
        rev: (prev?.rev ?? 0) + 1,
        deleted: 0 as const,
      } as T
      await table().put(stamped)
      await db.syncQueue.add({
        table: String(tableName),
        recordId: record.id,
        op: 'upsert',
        createdAt: now,
      })
      syncEngine.requestSync()
      return record.id
    },

    async softDelete(id) {
      const now = Date.now()
      const prev = await table().get(id)
      await table().update(id, {
        deleted: 1,
        updatedAt: now,
        rev: (prev?.rev ?? 0) + 1,
      } as Partial<T>)
      await db.syncQueue.add({
        table: String(tableName),
        recordId: id,
        op: 'delete',
        createdAt: now,
      })
      syncEngine.requestSync()
    },
  }
}

/** 新实体 id 助手（带 workspace 前缀便于排查） */
export function newId(prefix: string): string {
  return `${DEFAULT_WORKSPACE_ID}:${prefix}:${nanoid(10)}`
}

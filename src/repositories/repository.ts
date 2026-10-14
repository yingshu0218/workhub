import { nanoid } from 'nanoid'
import { storage } from '@/storage'
import { DEFAULT_WORKSPACE_ID } from '@/storage/workspace'
import type { SyncMeta } from '@/db/types'

/**
 * Repository 层 —— 存储可插拔的关键（开发计划 2.0/2.3；agentOps 服务端化 P1 改造）
 * 上层模块只依赖本接口，换存储（Dexie / Tauri SQLite / 服务端 PocketBase）仅需换 StorageAdapter。
 * 写入路径：统一盖章 updatedAt/rev → 落本地 → 进同步队列（在线时由引擎推送）
 *
 * P1 改造说明（docs/agentOps服务端化方案.md §5.1）：此前工厂直接注入 Dexie 表对象，
 * 「存储无关」只是接口形状；现改为经 `storage`（StorageAdapter 单例）读写，
 * DexieAdapter 下行为与旧实现逐语义一致（同事务、同盖章、同入队时机）。
 */

/** 写入入参：同步元数据可缺省，由实现层统一盖章 */
export type PutInput<T> = Omit<T, keyof SyncMeta> & Partial<SyncMeta>

export interface Repository<T extends { id: string }> {
  get(id: string): Promise<T | undefined>
  list(): Promise<T[]>
  put(record: PutInput<T>): Promise<string>
  softDelete(id: string): Promise<void>
}

/** 模块级仓储工厂：表名寻址，读写经 StorageAdapter（浏览器默认 Dexie） */
export function createRepository<T extends { id: string } & Partial<SyncMeta>>(
  tableName: string,
): Repository<T> {
  return {
    async get(id) {
      const rec = await storage.get<T>(tableName, id)
      return rec && !rec.deleted ? rec : undefined
    },

    async list() {
      const all = await storage.list<T>(tableName)
      return all.filter((r) => !r.deleted)
    },

    async put(record) {
      const now = Date.now()
      // 盖章、落库、入队必须在同一事务：落库成功而入队失败 = 变更永远不再推送
      await storage.transaction([tableName, 'syncQueue'], async (tx) => {
        const prev = await tx.get<T>(tableName, record.id)
        await tx.put(tableName, {
          ...record,
          updatedAt: now,
          rev: (prev?.rev ?? 0) + 1,
          deleted: 0 as const,
        } as T)
        await tx.enqueue(tableName, record.id, 'upsert', now)
      })
      storage.requestSync()
      return record.id
    },

    async softDelete(id) {
      await storage.transaction([tableName, 'syncQueue'], async (tx) => {
        const prev = await tx.get<T>(tableName, id)
        if (!prev) return // 不存在的 id：不动库、不入队
        const now = Date.now()
        await tx.update(tableName, id, {
          deleted: 1,
          updatedAt: now,
          rev: (prev?.rev ?? 0) + 1,
        })
        await tx.enqueue(tableName, id, 'delete', now)
      })
      storage.requestSync()
    },
  }
}

/** 新实体 id 助手（带 workspace 前缀便于排查） */
export function newId(prefix: string): string {
  return `${DEFAULT_WORKSPACE_ID}:${prefix}:${nanoid(10)}`
}

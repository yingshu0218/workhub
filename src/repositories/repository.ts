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
  /** 部分字段更新（读-盖章-写-入队同事务；patch 显式 undefined 在 Dexie update 语义下删键） */
  update(id: string, patch: Partial<T>): Promise<void>
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
        assertExpectedRevision(record, prev)
        if (prev?.deleted) throw new Error('DELETED: 请从回收站显式恢复记录')
        /**
         * 回收站恢复标记（粘性）：
         * - 对墓碑 put = 显式复活，盖 restoredAt（这是同步层允许复活的唯一凭证）；
         * - 对活记录 put = 普通编辑，沿用 prev 的标记（表单常只提交部分字段，不能把标记弄丢）。
         */
        const reviving = prev?.deleted === 1
        const restoredAt = reviving ? now : (record.restoredAt ?? prev?.restoredAt)
        await tx.put(tableName, {
          ...record,
          updatedAt: now,
          rev: (prev?.rev ?? 0) + 1,
          deleted: 0 as const,
          // 活记录不得带删除时间：调用方常把墓碑对象展开后改几个字段再 put，
          // 残留的 deletedAt 会让回收站口径与 30 天清理 cutoff 读到脏值
          deletedAt: undefined,
          ...(restoredAt ? { restoredAt } : {}),
        } as T)
        await tx.enqueue(tableName, record.id, 'upsert', now)
      })
      storage.requestSync()
      return record.id
    },

    /** 部分更新：与 softDelete 同款事务纪律（盖章 + 入队必须同事务，防变更漏推送）。
     *  消费方：待办拖入清单（listId）、客户拖入分组（tags 补齐）等「只动一两个字段」的快捷编辑 */
    async update(id, patch) {
      await storage.transaction([tableName, 'syncQueue'], async (tx) => {
        const prev = await tx.get<T>(tableName, id)
        if (!prev || prev.deleted) throw new Error(`NOT_FOUND: ${tableName}/${id}`)
        const now = Date.now()
        await tx.update(tableName, id, {
          ...patch,
          updatedAt: now,
          rev: (prev.rev ?? 0) + 1,
        })
        await tx.enqueue(tableName, id, 'upsert', now)
      })
      storage.requestSync()
    },

    async softDelete(id) {
      await storage.transaction([tableName, 'syncQueue'], async (tx) => {
        const prev = await tx.get<T>(tableName, id)
        if (!prev || prev.deleted) throw new Error(`NOT_FOUND: ${tableName}/${id}`)
        const now = Date.now()
        await tx.update(tableName, id, {
          deleted: 1,
          updatedAt: now,
          rev: (prev?.rev ?? 0) + 1,
          // 删除时刻写一次（updatedAt 会被后续同步合并抬高，不能拿来当删除时间）
          deletedAt: now,
          // 删除即清空恢复标记与旧快照；再次删除时由 cascade 重新采集
          restoredAt: undefined,
          trashSnapshot: undefined,
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

/** 表单打开时的版本不能被保存前的一次读取悄悄升级，否则会覆盖其他设备的新修改。 */
export function assertExpectedRevision(record: { rev?: number }, previous?: { rev?: number; deleted?: number }): void {
  if (record.rev !== undefined && record.rev > 0 && previous && record.rev !== previous.rev) throw new Error('VERSION_CONFLICT: 记录已变化，请保留输入并重新核对')
}

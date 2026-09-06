import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'

/**
 * 统一查询 Hook —— 存储可插拔的另一半（开发计划 2.0）
 * 组件不得直接依赖 Dexie API，一律经由这里订阅数据；
 * 将来切 SQLite WASM / Tauri SQLite 时只改本文件实现。
 */

/** 订阅一张表的未删除记录列表 */
export function useCollection<T extends { id: string; deleted?: 0 | 1 }>(
  tableName: keyof typeof db,
): T[] {
  const data = useLiveQuery(
    () =>
      (db[tableName] as unknown as { toArray(): Promise<T[]> })
        .toArray()
        .then((rows) => rows.filter((r) => !r.deleted)),
    [tableName],
    [] as T[],
  )
  return data ?? []
}

/** 订阅单条记录 */
export function useRecord<T extends { id: string; deleted?: 0 | 1 }>(
  tableName: keyof typeof db,
  id: string | undefined,
): T | undefined {
  const data = useLiveQuery(
    () =>
      (id
        ? (db[tableName] as unknown as { get(id: string): Promise<T | undefined> }).get(id)
        : undefined),
    [tableName, id],
  )
  return data && !data.deleted ? data : undefined
}

/** 自定义查询逃生口（仍走抽象层，不直接暴露 db 给组件） */
export function useQuery<T>(queryFn: () => Promise<T>, deps: unknown[]): T | undefined {
  return useLiveQuery(queryFn, deps)
}

export { db }

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import dayjs from 'dayjs'

/**
 * 统一查询 Hook —— 存储可插拔的另一半（开发计划 2.0）
 * 组件不得直接依赖 Dexie API，一律经由这里订阅数据；
 * 将来切 SQLite WASM / Tauri SQLite 时只改本文件实现。
 */

/**
 * 订阅一张表的未删除记录列表。
 * pick（审计 P2-9 搜索投影下沉）：可选字段投影 —— 命中后立即裁剪到指定字段再交给响应层，
 * 大字段（如笔记整篇 markdown）不进入 React 状态与内存； Dexie 层无原生投影索引，
 * 此处取回后立即裁剪并保持 liveQuery 响应式。
 */
export function useCollection<T extends { id: string; deleted?: 0 | 1 }>(
  tableName: keyof typeof db,
  pick?: string[],
): T[] {
  const pickKey = pick?.join(',') ?? ''
  const data = useLiveQuery(
    () =>
      (db[tableName] as unknown as { toArray(): Promise<T[]> })
        .toArray()
        .then((rows) => {
          const alive = rows.filter((r) => !r.deleted)
          if (!pickKey) return alive
          const fields = pickKey.split(',')
          return alive.map((r) => {
            const out = {} as Record<string, unknown>
            for (const k of fields) out[k] = (r as unknown as Record<string, unknown>)[k]
            return out as T
          })
        }),
    [tableName, pickKey],
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

/** 今日专注分钟数（focusSessions 本地推导，不参与同步） */
export function useTodayFocusMinutes(): number {
  return useLiveQuery(async () => {
    const start = dayjs().startOf('day').valueOf()
    const sessions = await db.focusSessions.where('completedAt').aboveOrEqual(start).toArray()
    return sessions.reduce((sum, s) => sum + s.minutes, 0)
  }, []) ?? 0
}

/** 最佳习惯连击天数（全部习惯中的最大连续打卡） */
export function useBestHabitStreak(): number {
  return useLiveQuery(async () => {
    const logs = await db.habitLogs.filter((l) => !l.deleted).toArray()
    const byHabit = new Map<string, Set<string>>()
    logs.forEach((l) => {
      if (!byHabit.has(l.habitId)) byHabit.set(l.habitId, new Set())
      byHabit.get(l.habitId)!.add(l.date)
    })
    let best = 0
    const todayStr = dayjs().format('YYYY-MM-DD')
    byHabit.forEach((dates) => {
      let n = 0
      let cursor = dates.has(todayStr) ? dayjs() : dayjs().subtract(1, 'day')
      while (dates.has(cursor.format('YYYY-MM-DD'))) {
        n++
        cursor = cursor.subtract(1, 'day')
      }
      best = Math.max(best, n)
    })
    return best
  }, []) ?? 0
}

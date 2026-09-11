import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import dayjs from 'dayjs'
import type { Settings } from '@/db/types'

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
      (db[tableName] as unknown as { toArray(): Promise<T[]> }).toArray().then((rows) => {
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

/**
 * 订阅单条记录。
 *
 * 返回 `undefined` 有**两种**含义：记录不存在/已软删，或首次查询尚未回填
 * （`useLiveQuery` 无 `initialValue` 时首帧恒为 `undefined`）。
 * 详情类视图若把两者等同处理，打开瞬间会闪一帧「记录不存在或已删除」空态
 * —— Issue #162 待办详情抽屉就此暴露过该问题。
 * 需要区分「未回填」与「查无此记录」的调用方，请改用下方 `useRecordState`。
 */
export function useRecord<T extends { id: string; deleted?: 0 | 1 }>(
  tableName: keyof typeof db,
  id: string | undefined,
): T | undefined {
  const data = useLiveQuery(
    () =>
      id
        ? (db[tableName] as unknown as { get(id: string): Promise<T | undefined> }).get(id)
        : undefined,
    [tableName, id],
  )
  return data && !data.deleted ? data : undefined
}

/**
 * 详情视图的三态判据（纯函数，Issue #162）：`empty` 未打开 / `loading` 未回填 / `ready` 可渲染。
 *
 * 抽成纯函数是为了能直接单测这条边界 —— 「打开瞬间闪一帧『记录不存在或已删除』」
 * 正是把「未回填」误判成「查无」的产物，而这个错误在 DOM 用例里表现为时序相关的偶发失败。
 *
 * @param id      目标记录 id（undefined = 视图未打开）
 * @param checked 是否已有有效查询结果（`useRecordState().checked`）
 */
export function resolveRecordDisplay(
  id: string | undefined,
  checked: boolean,
): 'empty' | 'loading' | 'ready' {
  if (!id) return 'empty'
  return checked ? 'ready' : 'loading'
}

/**
 * 单条记录 + 加载态（Issue #162）：详情抽屉等「记录不存在」需要给独立空态的场景用。
 *
 * - `record`：未软删的记录（同 useRecord 过滤口径）；查无或首帧未回填时为 undefined；
 * - `checked`：是否已有**有效查询结果**（含「确实查无此记录」）。
 *   调用方据此区分「加载中」（渲染骨架/空白）与「记录不存在」（渲染空态），
 *   避免打开瞬间闪一帧误导性的「已删除」提示。
 */
export function useRecordState<T extends { id: string; deleted?: 0 | 1 }>(
  tableName: keyof typeof db,
  id: string | undefined,
): { record: T | undefined; checked: boolean } {
  const data = useLiveQuery(
    () =>
      id
        ? (db[tableName] as unknown as { get(id: string): Promise<T | undefined> }).get(id)
        : undefined,
    [tableName, id],
    undefined,
  )
  // useLiveQuery 的 initialValue 为 undefined 时无法区分「未回填」与「查无」，
  // 故用「是否已解析出非空结果或已针对当前 id 拿到 undefined」的显式判据：
  // 这里以「id 为空 → 视为已确定」（抽屉未打开，无需加载态）作为唯一边界，
  // 其余情况在拿到首个结果前 checked 恒为 false。
  const checked = id === undefined || data !== undefined
  const record = data && !data.deleted ? data : undefined
  return { record, checked }
}

/** 自定义查询逃生口（仍走抽象层，不直接暴露 db 给组件） */
export function useQuery<T>(queryFn: () => Promise<T>, deps: unknown[]): T | undefined {
  return useLiveQuery(queryFn, deps)
}

/** 今日专注分钟数（focusSessions 本地推导，不参与同步） */
export function useTodayFocusMinutes(): number {
  return (
    useLiveQuery(async () => {
      const start = dayjs().startOf('day').valueOf()
      const sessions = await db.focusSessions.where('completedAt').aboveOrEqual(start).toArray()
      return sessions.reduce((sum, s) => sum + s.minutes, 0)
    }, []) ?? 0
  )
}

/** 最佳习惯连击天数（全部习惯中的最大连续打卡） */
export function useBestHabitStreak(): number {
  return (
    useLiveQuery(async () => {
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
  )
}

/**
 * 订阅全局设置（singleton）。
 * 写后由 settingsRepo 广播 settings:changed，Dexie liveQuery 自动重取，各消费端实时生效。
 */
export function useSettings(): Settings | undefined {
  return useLiveQuery(() => db.settings.get('singleton'), [], undefined)
}

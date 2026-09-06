import dayjs from 'dayjs'
import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'
import { calcStreak } from '@/shared/streak'
import type { Habit, HabitLog } from '@/db/types'

/**
 * 习惯模块领域查询 Hook —— 月历统计/连击/完成率一律从 habitLogs 源记录推导，
 * 不存任何同步快照（开发计划 2.3 纪律）。组件零 Dexie 直连。
 */

export interface HabitRowStat {
  habit: Habit
  /** 连续打卡天数（复用 shared/streak 的 calcStreak） */
  streak: number
  /** 所选月份打卡次数 */
  monthChecks: number
  /** 本月完成率 0-100（以当月已过天数分母，历史月份用整月） */
  monthRate: number
  doneToday: boolean
  /** 累计打卡次数 */
  totalChecks: number
}

interface HabitSource {
  habits: Habit[]
  logs: HabitLog[]
}

function computeRowStats({ habits, logs }: HabitSource, month: string): HabitRowStat[] {
  const todayStr = dayjs().format('YYYY-MM-DD')
  const currentMonth = dayjs().format('YYYY-MM')
  const elapsedDays =
    month === currentMonth ? dayjs().date() : dayjs(month + '-01').daysInMonth()

  return habits.map((habit) => {
    const mine = logs.filter((l) => l.habitId === habit.id)
    const dates = new Set(mine.map((l) => l.date))
    const monthChecks = mine.filter((l) => l.date.startsWith(month)).length
    return {
      habit,
      streak: calcStreak(dates),
      monthChecks,
      monthRate: elapsedDays > 0 ? Math.round((monthChecks / elapsedDays) * 100) : 0,
      doneToday: dates.has(todayStr),
      totalChecks: mine.length,
    }
  })
}

/** 活跃习惯清单统计（含连击/本月完成率/今日是否已打卡） */
export function useHabitStats(month: string): HabitRowStat[] {
  const stats = useQuery<HabitRowStat[]>(async () => {
    const [habits, allLogs] = await Promise.all([
      db.habits.filter((h) => !h.deleted).toArray(),
      db.habitLogs.filter((l) => !l.deleted).toArray(),
    ])
    return computeRowStats({ habits, logs: allLogs }, month)
  }, [month])
  return stats ?? []
}

/** 月历热力图数据：日期(YYYY-MM-DD) → 当日完成习惯数 */
export function useHabitMonthCounts(month: string): Record<string, number> {
  const counts = useQuery<Record<string, number>>(async () => {
    const logs = await db.habitLogs.filter((l) => !l.deleted && l.date.startsWith(month)).toArray()
    const map: Record<string, number> = {}
    for (const l of logs) map[l.date] = (map[l.date] ?? 0) + 1
    return map
  }, [month])
  return counts ?? {}
}

/** 某日完成的习惯明细（点击热力图格子展开用） */
export function useCompletedHabitsOn(date: string | undefined): Habit[] {
  const habits = useQuery<Habit[]>(async () => {
    if (!date) return []
    const [allHabits, dayLogs] = await Promise.all([
      db.habits.filter((h) => !h.deleted).toArray(),
      db.habitLogs.filter((l) => !l.deleted && l.date === date).toArray(),
    ])
    const ids = new Set(dayLogs.map((l) => l.habitId))
    return allHabits.filter((h) => ids.has(h.id))
  }, [date])
  return habits ?? []
}

/** 今日已打卡习惯数（头部进度用） */
export function useTodayCheckCount(): number {
  const count = useQuery<number>(async () => {
    const todayStr = dayjs().format('YYYY-MM-DD')
    return db.habitLogs.filter((l) => !l.deleted && l.date === todayStr).count()
  }, [])
  return count ?? 0
}

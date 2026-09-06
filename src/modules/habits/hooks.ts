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
  /** 本月完成率 0-100；分母按 schedule 推导当月应打卡天数，分母为 0（未来月份）时为 null 显示 — */
  monthRate: number | null
  doneToday: boolean
  /** 累计打卡次数 */
  totalChecks: number
}

interface HabitSource {
  habits: Habit[]
  logs: HabitLog[]
}

/** 当月已过天数：当月=今天几号；历史月份=整月；未来月份=0 */
function elapsedDaysOfMonth(month: string): number {
  const monthStart = dayjs(month + '-01')
  if (month === dayjs().format('YYYY-MM')) return dayjs().date()
  return monthStart.isAfter(dayjs(), 'month') ? 0 : monthStart.daysInMonth()
}

/** 已过天数中周一至周五的天数（'工作日' 排程分母） */
function weekdayCount(month: string, elapsedDays: number): number {
  const monthStart = dayjs(month + '-01')
  let count = 0
  for (let i = 0; i < elapsedDays; i++) {
    const dow = monthStart.date(i + 1).day()
    if (dow >= 1 && dow <= 5) count++
  }
  return count
}

/**
 * 按 schedule 推导当月应打卡天数（完成率分母，与进度条同源）：
 * - '每日'（含自定义描述兜底）：当月已过天数 elapsed
 * - '工作日'：当月已过天数中的周一至周五天数
 * - '每周N次'：min(N × ⌊elapsed / 7⌋ + round(N × (elapsed mod 7) / 7), elapsed)
 *   即 N × 已过完整周数 + 本周已过天数按 N/7 比例折算，并以已过天数封顶（N=7 时退化为每日）
 */
function monthDenominator(schedule: string, month: string, elapsed: number): number {
  if (elapsed <= 0) return 0
  if (schedule === '工作日') return weekdayCount(month, elapsed)
  const m = schedule.match(/^每周(\d+)次$/)
  if (m) {
    const n = Math.min(7, Math.max(1, Number(m[1])))
    const fullWeeks = Math.floor(elapsed / 7)
    const remainder = elapsed % 7
    return Math.min(n * fullWeeks + Math.round((n * remainder) / 7), elapsed)
  }
  return elapsed
}

function computeRowStats({ habits, logs }: HabitSource, month: string): HabitRowStat[] {
  const todayStr = dayjs().format('YYYY-MM-DD')
  const elapsedDays = elapsedDaysOfMonth(month)

  return habits.map((habit) => {
    const mine = logs.filter((l) => l.habitId === habit.id)
    const dates = new Set(mine.map((l) => l.date))
    const monthChecks = mine.filter((l) => l.date.startsWith(month)).length
    const denominator = monthDenominator(habit.schedule, month, elapsedDays)
    return {
      habit,
      streak: calcStreak(dates),
      monthChecks,
      monthRate: denominator > 0 ? Math.round((monthChecks / denominator) * 100) : null,
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

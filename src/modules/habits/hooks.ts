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

/** 月历热力图数据：日期(YYYY-MM-DD) → 当日完成习惯数（仅统计现存习惯，孤儿日志不计入） */
export function useHabitMonthCounts(month: string): Record<string, number> {
  const counts = useQuery<Record<string, number>>(async () => {
    const [habits, logs] = await Promise.all([
      db.habits.filter((h) => !h.deleted).toArray(),
      db.habitLogs.filter((l) => !l.deleted && l.date.startsWith(month)).toArray(),
    ])
    const aliveIds = new Set(habits.map((h) => h.id))
    const map: Record<string, number> = {}
    for (const l of logs) {
      if (!aliveIds.has(l.habitId)) continue
      map[l.date] = (map[l.date] ?? 0) + 1
    }
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

/** 今日已打卡习惯数（头部进度用；仅统计现存习惯，孤儿日志不计入） */
export function useTodayCheckCount(): number {
  const count = useQuery<number>(async () => {
    const todayStr = dayjs().format('YYYY-MM-DD')
    const [habits, logs] = await Promise.all([
      db.habits.filter((h) => !h.deleted).toArray(),
      db.habitLogs.filter((l) => !l.deleted && l.date === todayStr).toArray(),
    ])
    const aliveIds = new Set(habits.map((h) => h.id))
    return logs.filter((l) => aliveIds.has(l.habitId)).length
  }, [])
  return count ?? 0
}

export interface HabitMood {
  /** 评语文案 */
  label: string
  /** 色点色调（对应设计系统语义色） */
  tone: 'green' | 'amber' | 'red' | 'blue'
}

/** 某习惯当日期望权重：每日=1 / 工作日=周一至五 / 每周N次=N/7（完成率分母同源） */
function dailyExpectedWeight(schedule: string, dow: number): number {
  if (schedule === '工作日') return dow >= 1 && dow <= 5 ? 1 : 0
  const m = schedule.match(/^每周(\d+)次$/)
  if (m) return Math.min(7, Math.max(1, Number(m[1]))) / 7
  return 1
}

/**
 * 稳态评语（热力图卡片头部右侧，对齐原型 07）：
 * 近 7 天完成率≥80% 且当前连击≥7 → 稳态保持中 🔥；连击 3-6 → 习惯巩固中；
 * 近 7 天完成率<30% → 波动期，别放弃；其余 → 稳步积累中
 */
export function useHabitMood(): HabitMood | null {
  const mood = useQuery<HabitMood | null>(async () => {
    const [habits, logs] = await Promise.all([
      db.habits.filter((h) => !h.deleted).toArray(),
      db.habitLogs.filter((l) => !l.deleted).toArray(),
    ])
    if (habits.length === 0) return null
    const today = dayjs()
    const doneKeys = new Set(logs.map((l) => `${l.habitId}|${l.date}`))
    // 近 7 天完成率：完成权重 / 期望权重（按 schedule 逐日推导）
    let expected = 0
    let done = 0
    for (let i = 0; i < 7; i++) {
      const d = today.subtract(i, 'day')
      const dateStr = d.format('YYYY-MM-DD')
      for (const h of habits) {
        const need = dailyExpectedWeight(h.schedule, d.day())
        if (need <= 0) continue
        expected += need
        if (doneKeys.has(`${h.id}|${dateStr}`)) done += need
      }
    }
    const rate = expected > 0 ? done / expected : 0
    // 当前连击：任一习惯的最大 calcStreak（与 useHabitStats 同源推导）
    const byHabit = new Map<string, Set<string>>()
    for (const l of logs) {
      if (!byHabit.has(l.habitId)) byHabit.set(l.habitId, new Set())
      byHabit.get(l.habitId)!.add(l.date)
    }
    let streak = 0
    byHabit.forEach((dates) => {
      streak = Math.max(streak, calcStreak(dates))
    })
    if (rate >= 0.8 && streak >= 7) return { label: '稳态保持中 🔥', tone: 'green' }
    if (streak >= 3) return { label: '习惯巩固中', tone: 'amber' }
    if (rate < 0.3) return { label: '波动期，别放弃', tone: 'red' }
    return { label: '稳步积累中', tone: 'blue' }
  }, [])
  return mood ?? null
}

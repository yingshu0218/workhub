import { useLiveQuery } from 'dexie-react-hooks'
import dayjs from 'dayjs'
import { db, type FocusSession } from '@/db/db'
import { useCollection } from '@/queries/hooks'
import { calcStreak } from '@/shared/streak'
import type { HabitLog, Transaction, Customer, Trophy, TrophyConditionType } from '@/db/types'

/**
 * 奖杯/个人主页领域查询封装 —— 全部统计从源记录实时推导，
 * 不存任何同步快照（开发计划 2.3 纪律）。组件零 Dexie 直连；
 * 引擎（trophyEngine.ts）复用本文件的纯推导函数与采集函数。
 */

export const EXP_PER_LEVEL = 100

/** 奖杯条件评估所需的源统计快照（运行时推导，非持久化） */
export interface TrophyStats {
  focusMinutesTotal: number
  focusOnceMinutes: number
  habitStreak: number
  habitChecksTotal: number
  transactionsTotal: number
  customersTotal: number
}

interface TrophySources {
  focusSessions: FocusSession[]
  habitLogs: HabitLog[]
  transactions: Transaction[]
  customers: Customer[]
}

/** 纯推导：源记录 → 统计快照（引擎与页面共用同一实现） */
export function computeTrophyStats({ focusSessions, habitLogs, transactions, customers }: TrophySources): TrophyStats {
  const byHabit = new Map<string, Set<string>>()
  for (const l of habitLogs) {
    if (!byHabit.has(l.habitId)) byHabit.set(l.habitId, new Set())
    byHabit.get(l.habitId)!.add(l.date)
  }
  let bestStreak = 0
  byHabit.forEach((dates) => {
    bestStreak = Math.max(bestStreak, calcStreak(dates))
  })

  return {
    focusMinutesTotal: focusSessions.reduce((sum, s) => sum + s.minutes, 0),
    focusOnceMinutes: focusSessions.reduce((max, s) => Math.max(max, s.minutes), 0),
    habitStreak: bestStreak,
    habitChecksTotal: habitLogs.length,
    transactionsTotal: transactions.length,
    customersTotal: customers.length,
  }
}

/** 条件类型 → 统计快照字段的映射（conditionType 是 snake_case，TrophyStats 是 camelCase） */
const CONDITION_TO_STAT: Record<TrophyConditionType, keyof TrophyStats> = {
  focus_minutes_total: 'focusMinutesTotal',
  focus_once_minutes: 'focusOnceMinutes',
  habit_streak: 'habitStreak',
  habit_checks_total: 'habitChecksTotal',
  transactions_total: 'transactionsTotal',
  customers_total: 'customersTotal',
}

/** 结构化条件 → 当前值（未登记的条件类型返回 0） */
export function computeConditionValue(type: TrophyConditionType | undefined, stats: TrophyStats): number {
  if (!type) return 0
  return stats[CONDITION_TO_STAT[type]] ?? 0
}

/** EXP 公式：专注分钟×2 + 打卡次数×10 + 已解锁奖杯×50 */
export function deriveExp(stats: TrophyStats, unlockedTrophyCount: number): number {
  return stats.focusMinutesTotal * 2 + stats.habitChecksTotal * 10 + unlockedTrophyCount * 50
}

export interface ProfileSummary {
  exp: number
  level: number
  /** 升下一级进度 0-99 */
  expIntoLevel: number
  unlockedTrophies: number
  totalTrophies: number
  stats: TrophyStats
}

export function deriveProfileSummary(stats: TrophyStats, trophies: Trophy[]): ProfileSummary {
  const unlocked = trophies.filter((t) => t.unlockedAt).length
  const exp = deriveExp(stats, unlocked)
  return {
    exp,
    level: Math.floor(exp / EXP_PER_LEVEL),
    expIntoLevel: exp % EXP_PER_LEVEL,
    unlockedTrophies: unlocked,
    totalTrophies: trophies.length,
    stats,
  }
}

/** 非 Hook 版统计采集（奖杯引擎启动检查/事件回调使用，实时读源表） */
export async function collectTrophyStats(): Promise<TrophyStats> {
  const [focusSessions, habitLogs, transactions, customers] = await Promise.all([
    db.focusSessions.toArray(),
    db.habitLogs.filter((l) => !l.deleted).toArray(),
    db.transactions.filter((t) => !t.deleted).toArray(),
    db.customers.filter((c) => !c.deleted).toArray(),
  ])
  return computeTrophyStats({ focusSessions, habitLogs, transactions, customers })
}

/** 页面用：响应式统计快照（源表任一变更自动重算） */
export function useTrophyStats(): TrophyStats {
  const stats = useLiveQuery(collectTrophyStats, [])
  return stats ?? {
    focusMinutesTotal: 0,
    focusOnceMinutes: 0,
    habitStreak: 0,
    habitChecksTotal: 0,
    transactionsTotal: 0,
    customersTotal: 0,
  }
}

/** 奖杯列表（含未解锁） */
export function useTrophyList(): Trophy[] {
  return useCollection<Trophy>('trophies')
}

/** 个人主页汇总（EXP/Lv/收集统计） */
export function useProfileSummary(): ProfileSummary {
  const stats = useTrophyStats()
  const trophies = useTrophyList()
  return deriveProfileSummary(stats, trophies)
}

/** 最近解锁的奖杯（个人主页列表，按解锁时间倒序） */
export function useRecentUnlockedTrophies(limit = 5): Trophy[] {
  const trophies = useTrophyList()
  return trophies
    .filter((t) => t.unlockedAt)
    .sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0))
    .slice(0, limit)
}

/** 条件类型中文标签（奖杯墙进度条说明用） */
export const CONDITION_LABELS: Record<TrophyConditionType, string> = {
  focus_minutes_total: '累计专注分钟',
  focus_once_minutes: '单次专注分钟',
  habit_streak: '最长连续打卡天数',
  habit_checks_total: '累计打卡次数',
  transactions_total: '累计交易笔数',
  customers_total: '累计客户数',
}

/** 相对时间展示（如「3 天前」） */
export function formatUnlockedAt(ts: number): string {
  return dayjs(ts).format('YYYY-MM-DD')
}

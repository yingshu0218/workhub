/**
 * 连续打卡天数推导（`shared/streak.ts`）—— 习惯热力图与 `habit_streak` 奖杯条件的共同底座。
 *
 * 为什么补这把锁（2026-10-26 审计）：`modules/habits` 与 `modules/trophies` 此前**零专属测试**，
 * 而这两个函数直接决定「连续 N 天」的读数与奖杯解锁判定 —— 算错不会报错，只会让用户看到
 * 一个恒定偏一天的数字。这类「静默算错」正是最难靠人眼发现的一类缺陷。
 *
 * 两个函数的语义**刻意不同**，锁在同一个文件里便于对照：
 * - `calcStreak` = **当前连击**：今天没打卡就从昨天起算（今天还没到睡前，不该归零）
 * - `calcLongestStreak` = **历史最长**：不受今天影响，跨断档取最长段
 */
import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { calcStreak, calcLongestStreak } from '../streak'

/** 固定「今天」，避免用例随真实日期漂移 */
const TODAY = dayjs('2026-10-26')

const daysAgo = (n: number) => TODAY.subtract(n, 'day').format('YYYY-MM-DD')

describe('calcStreak：当前连击', () => {
  it('今天已打卡：从今天往前数连续天数', () => {
    expect(calcStreak(new Set([daysAgo(0), daysAgo(1), daysAgo(2)]), TODAY)).toBe(3)
  })

  it('今天还没打卡：从昨天起算（不归零）', () => {
    expect(calcStreak(new Set([daysAgo(1), daysAgo(2)]), TODAY)).toBe(2)
  })

  it('中间断档：只算最近一段', () => {
    expect(calcStreak(new Set([daysAgo(0), daysAgo(2), daysAgo(3)]), TODAY)).toBe(1)
  })

  it('空集合 / 只有未来日期：均为 0', () => {
    expect(calcStreak(new Set(), TODAY)).toBe(0)
    expect(calcStreak(new Set([daysAgo(-1)]), TODAY)).toBe(0)
  })

  it('跨月连续（9-30 → 10-01）算作 2 天', () => {
    const dates = new Set(['2026-09-29', '2026-09-30', '2026-10-01'])
    expect(calcStreak(dates, dayjs('2026-10-01'))).toBe(3)
  })
})

describe('calcLongestStreak：历史最长', () => {
  it('跨断档取最长连续段（不是总天数）', () => {
    const dates = new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10'])
    expect(calcLongestStreak(dates)).toBe(3)
  })

  it('不受「今天是否打卡」影响', () => {
    // 全部落在很久以前，仍是有效历史纪录
    expect(calcLongestStreak(new Set(['2026-01-01', '2026-01-02']))).toBe(2)
  })

  it('空集合 = 0，单日 = 1', () => {
    expect(calcLongestStreak(new Set())).toBe(0)
    expect(calcLongestStreak(new Set(['2026-10-26']))).toBe(1)
  })

  it('与 calcStreak 的差异：断掉的旧纪录仍计入最长', () => {
    const dates = new Set([daysAgo(10), daysAgo(9), daysAgo(8), daysAgo(0)])
    expect(calcLongestStreak(dates)).toBe(3) // 历史最长
    expect(calcStreak(dates, TODAY)).toBe(1) // 当前连击（今天单独一天）
  })
})

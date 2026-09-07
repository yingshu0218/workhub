import dayjs from 'dayjs'

/** 从打卡日志推导连续打卡天数（今天未打卡则从昨天起算）—— 当前连击语义 */
export function calcStreak(dates: Set<string>, today = dayjs()): number {
  let streak = 0
  let cursor = dates.has(today.format('YYYY-MM-DD')) ? today : today.subtract(1, 'day')
  while (dates.has(cursor.format('YYYY-MM-DD'))) {
    streak++
    cursor = cursor.subtract(1, 'day')
  }
  return streak
}

/**
 * 历史最长连续打卡天数（审计 P2-8）：与当前连击分开计算——
 * 排序后线性扫描，相邻日期差 1 天则连击延续，否则重新起算；
 * 不受「今天是否打卡」影响，反映整个历史的最长纪录。
 */
export function calcLongestStreak(dates: Set<string>): number {
  if (dates.size === 0) return 0
  const sorted = [...dates].sort()
  let longest = 0
  let run = 0
  let prev: dayjs.Dayjs | null = null
  for (const d of sorted) {
    // 'YYYY-MM-DD' 为 ISO 日期，dayjs 本地时区解析（无需 customParseFormat 插件）
    const cur = dayjs(d)
    if (prev && cur.diff(prev, 'day') === 1) {
      run++
    } else {
      run = 1
    }
    longest = Math.max(longest, run)
    prev = cur
  }
  return longest
}

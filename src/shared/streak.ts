import dayjs from 'dayjs'

/** 从打卡日志推导连续打卡天数（今天未打卡则从昨天起算） */
export function calcStreak(dates: Set<string>, today = dayjs()): number {
  let streak = 0
  let cursor = dates.has(today.format('YYYY-MM-DD')) ? today : today.subtract(1, 'day')
  while (dates.has(cursor.format('YYYY-MM-DD'))) {
    streak++
    cursor = cursor.subtract(1, 'day')
  }
  return streak
}

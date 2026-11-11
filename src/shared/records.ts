import { recordPath as pathFor } from '@/commands/personal'
export const recordPath = (table: string, id: unknown) => pathFor(table, String(id || ''))

export function formatFactTime(
  at: unknown,
  precision: unknown = 'minute',
  zone: unknown = 'Asia/Shanghai',
) {
  const number = Number(at)
  if (!Number.isFinite(number) || number <= 0) return '时间未记录'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: String(zone),
      dateStyle: 'medium',
      ...(precision === 'date' ? {} : { timeStyle: 'short' }),
    }).format(number)
  } catch {
    return (
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'medium',
        ...(precision === 'date' ? {} : { timeStyle: 'short' }),
      }).format(number) + '（时区无效，按上海时间显示）'
    )
  }
}
export function moneyLabel(value: unknown, currency: unknown) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: ['CNY', 'USD', 'EUR'].includes(String(currency)) ? String(currency) : 'CNY',
  }).format(Number(value || 0) / 100)
}
export const statusLabel = (value: unknown) =>
  (
    ({
      todo: '未完成',
      done: '已完成',
      voided: '已作废',
      committed: '已提交',
      awaiting_confirmation: '待确认',
      cancelled: '已撤回',
    }) as Record<string, string>
  )[String(value)] || String(value || '无日期')

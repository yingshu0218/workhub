import type { Transaction } from '@/db/types'
import { financeTotals, minorUnits } from '@/commands/core'
export function moneyAmount(row: Pick<Transaction, 'amount' | 'amountMinor'>): number { return (row.amountMinor ?? minorUnits(row.amount)) / 100 }
export function totalsByCurrency(rows: readonly Pick<Transaction, 'id' | 'amount' | 'amountMinor' | 'currency' | 'type'>[]) {
  // 未迁移的本地只读缓存沿用旧 CNY 口径；在线记录已由服务端迁移固定 currency。
  return financeTotals(rows.map(r => ({...r,currency:r.currency || 'CNY'})))
}
export function moneySummary(rows: readonly Pick<Transaction, 'id' | 'amount' | 'amountMinor' | 'currency' | 'type'>[], kind: 'income' | 'expense' | 'turnover'): string {
  const totals=totalsByCurrency(rows)
  return Object.entries(totals).map(([currency,t])=>currency+' '+((kind==='income'?t.incomeMinor:kind==='expense'?t.expenseMinor:t.incomeMinor+t.expenseMinor)/100).toLocaleString('zh-CN')).join(' / ') || 'CNY 0'
}

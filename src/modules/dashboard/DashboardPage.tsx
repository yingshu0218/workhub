import { useCollection, useQuery } from '@/queries/hooks'
import { db } from '@/queries/hooks'
import { Card, PageHeader, Button } from '@/design-system/ui'
import type { Todo, Customer, Transaction } from '@/db/types'
import { FocusCard, HabitLoopCard, QuickNoteCard } from './cards'
import dayjs from 'dayjs'

/** Focus Synchronizer 仪表盘（Phase 1 实装版） */
export default function DashboardPage() {
  const todos = useCollection<Todo>('todos')
  const customers = useCollection<Customer>('customers')
  const transactions = useCollection<Transaction>('transactions')

  const hour = dayjs().hour()
  const greeting = hour < 6 ? '凌晨好' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const doneToday = todos.filter(
    (t) => t.status === 'done' && t.completedAt && dayjs(t.completedAt).isSame(dayjs(), 'day'),
  ).length
  const openToday = todos.filter((t) => t.status !== 'done').length
  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)

  // 今日专注分钟（本地推导）
  const focusMinutes =
    useQuery(async () => {
      const start = dayjs().startOf('day').valueOf()
      const sessions = await db.focusSessions.where('completedAt').aboveOrEqual(start).toArray()
      return sessions.reduce((sum, s) => sum + s.minutes, 0)
    }, []) ?? 0

  // 最佳习惯连击
  const bestStreak =
    useQuery(async () => {
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

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={`${greeting}，陈致远`}
        subtitle={dayjs().format('M月D日 dddd')}
        actions={<Button icon="post_add" variant="ghost">记一笔</Button>}
      />

      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-outline">深度专注</div>
          <div className="mt-1 text-[26px] font-bold text-primary">
            {focusMinutes}
            <span className="text-[13px] text-outline"> 分钟</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-outline">待办达成</div>
          <div className="mt-1 text-[26px] font-bold">
            {doneToday}
            <span className="text-[13px] text-outline"> / {doneToday + openToday}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-outline">习惯连击</div>
          <div className="mt-1 text-[26px] font-bold text-warning">
            {bestStreak}
            <span className="text-[13px] text-outline"> 天</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-outline">累计收款</div>
          <div className="mt-1 text-[26px] font-bold text-success">
            ¥{income >= 10000 ? `${(income / 10000).toFixed(1)}万` : income.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-outline">{customers.length} 位客户在册</div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          <FocusCard />
          <QuickNoteCard />
        </div>
        <HabitLoopCard />
      </div>
    </div>
  )
}

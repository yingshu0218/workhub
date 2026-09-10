import { useCollection, useTodayFocusMinutes, useBestHabitStreak } from '@/queries/hooks'
import { Card, PageHeader, Button } from '@/design-system/ui'
import type { Todo, Customer, Transaction } from '@/db/types'
import { FocusCard, HabitLoopCard, QuickNoteCard, TodayTodosCard } from './cards'
import dayjs from 'dayjs'
import { isDueToday } from '@/modules/todo/domain'
import { useUserName } from '@/modules/identity'

/** Focus Synchronizer 仪表盘（Phase 1 实装版） */
export default function DashboardPage() {
  // 问候语用户名为当前身份（Issue #123，默认「阿蓝」）
  const userName = useUserName()
  const todos = useCollection<Todo>('todos')
  const customers = useCollection<Customer>('customers')
  const transactions = useCollection<Transaction>('transactions')

  const todayStr = dayjs().format('YYYY-MM-DD')
  const hour = dayjs().hour()
  const greeting = hour < 6 ? '凌晨好' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const doneToday = todos.filter(
    (t) => t.status === 'done' && t.completedAt && dayjs(t.completedAt).isSame(dayjs(), 'day'),
  ).length
  // 「今天」口径（Issue #74）：今日到期 ∪ 逾期未完成，与待办中心/今日日程卡一致
  const openToday = todos.filter((t) => isDueToday(t, todayStr)).length
  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)

  // 今日专注分钟（本地推导）
  const focusMinutes = useTodayFocusMinutes()

  // 最佳习惯连击
  const bestStreak = useBestHabitStreak()

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={`${greeting}，${userName}`}
        subtitle={dayjs().format('M月D日 dddd')}
        actions={
          <Button icon="post_add" variant="ghost">
            记一笔
          </Button>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            深度专注
          </div>
          <div className="mt-1 text-[1.8571rem] font-bold text-primary">
            {focusMinutes}
            <span className="text-[0.9286rem] text-outline"> 分钟</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            待办达成
          </div>
          <div className="mt-1 text-[1.8571rem] font-bold">
            {doneToday}
            <span className="text-[0.9286rem] text-outline"> / {doneToday + openToday}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            习惯连击
          </div>
          <div className="mt-1 text-[1.8571rem] font-bold text-warning">
            {bestStreak}
            <span className="text-[0.9286rem] text-outline"> 天</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            累计收款
          </div>
          <div className="mt-1 text-[1.8571rem] font-bold text-success">
            ¥{income >= 10000 ? `${(income / 10000).toFixed(1)}万` : income.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[0.7857rem] text-outline">{customers.length} 位客户在册</div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_360px] items-stretch gap-4">
        <div className="grid grid-rows-[auto_1fr] gap-4">
          <FocusCard />
          <HabitLoopCard />
        </div>
        <div className="grid grid-rows-[auto_1fr] gap-4">
          <TodayTodosCard />
          <QuickNoteCard />
        </div>
      </div>
    </div>
  )
}

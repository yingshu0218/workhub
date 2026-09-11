import { useCollection, useTodayFocusMinutes, useBestHabitStreak } from '@/queries/hooks'
import { Card, PageHeader, Button } from '@/design-system/ui'
import type { Todo, Customer, Transaction } from '@/db/types'
import { FocusCard, HabitLoopCard, QuickNoteCard, TodayTodosCard } from './cards'
import dayjs from 'dayjs'
import { isDueToday, isTodoOverdue } from '@/modules/todo/domain'
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
  // 「还剩几项」口径（Issue #134 三轮）：今日到期 ∪ 逾期未完成 —— 与待办中心/今日日程卡同源。
  // 首页已在数据源头移除了已完成项，「还剩 N 项」正是首页唯一能给出的行动读数：
  // 打勾一条即减一，归零即收工。不再展示「完成率」（完成量已无条目承载，无从对照）。
  const openToday = todos.filter((t) => isDueToday(t, todayStr)).length
  // Issue #134 四轮：指标卡把「还剩 N 项」拆成「今日到期 / 已逾期」两个读数（与今日日程卡分组同源）。
  // 逾期是唯一需要立刻处理的缺口语义，混在总数里会被稀释；两张卡分组 / 指标卡拆数必须一致。
  // 五轮：逾期改为按天口径（截止日早于今天），故传 todayStr 而非默认值。
  const overdueToday = todos.filter((t) => isTodoOverdue(t, todayStr)).length
  const dueTodayOnly = openToday - overdueToday
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
            今日待办
          </div>
          <div className="mt-1 text-[1.8571rem] font-bold">
            {openToday <= 0 ? (
              <span className="text-[1.0714rem] text-success">今日已清空</span>
            ) : (
              <>
                <span className="text-[0.9286rem] font-normal text-outline">还剩 </span>
                {openToday}
                <span className="text-[0.9286rem] text-outline"> 项</span>
              </>
            )}
          </div>
          {/* 拆分读数：逾期用 danger 色单独提示（0 时不显示，避免制造噪声） */}
          {openToday > 0 && (
            <div className="mt-0.5 text-[0.7857rem] text-outline">
              今日到期 {dueTodayOnly}
              {overdueToday > 0 && (
                <span className="ml-1.5 font-medium text-danger">· 逾期 {overdueToday}</span>
              )}
            </div>
          )}
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

      {/*
        主网格（Issue #134 对齐原型 01）：12 列制 = 左 7 列主战场（现在专注 + 今日待办日程）
        + 右 5 列协同列（每日习惯闭环 + 随手速记暂存便签）。
        分区依据是「谁与我此刻直接相关」：推进中的事项（专注/待办）在左，习惯与外置捕获在右；
        速记是**收集箱入口**，需要常驻可见与足够书写面积，故独占右列下方整块。

        行高（Issue #134 二轮）：左右两列各自「上半卡 auto + 下半卡 1fr」，
        靠 `lg:grid-rows-[auto_minmax(0,1fr)]` 让每列的**下半张卡拉满剩余高度**——
        这样速记的大文本框才能真正变高（而不是仅靠 rows=4 定死），
        左列今日待办也多出可见行数；列内 min-h-0 保证内部滚动区正常收敛不撑破卡片。
        小屏（<lg）退化为单列纵向堆叠，行高规则不生效。
      */}
      <div className="mt-5 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12 lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="grid min-h-0 gap-4 lg:col-span-7 lg:row-span-2 lg:grid-rows-[auto_minmax(0,1fr)]">
          <FocusCard />
          <TodayTodosCard />
        </div>
        <div className="grid min-h-0 gap-4 lg:col-span-5 lg:row-span-2 lg:grid-rows-[auto_minmax(0,1fr)]">
          <HabitLoopCard />
          <QuickNoteCard />
        </div>
      </div>
    </div>
  )
}

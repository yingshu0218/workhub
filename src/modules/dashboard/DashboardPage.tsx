import { useCollection, useTodayFocusMinutes, useBestHabitStreak } from '@/queries/hooks'
import { Card, PageHeader, Button } from '@/design-system/ui'
import type { Todo, Customer, Transaction } from '@/db/types'
import { FocusCard, HabitLoopCard, QuickNoteCard, TodayTodosCard } from './cards'
import dayjs from 'dayjs'
import { isDueToday, isTodoOverdue } from '@/modules/todo/domain'
import { useUserName } from '@/modules/identity'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/design-system/Icon'

/**
 * <768px 专属的二级入口（侧栏在此断点下隐藏，见 AppLayout 的 `md:flex`）。
 *
 * 为什么必须有：移动壳只保留 5 个底部 Tab，「待办事项 / 笔记 / 项目」被降为二级页
 * （docs/移动端改造方案.md §4），窄屏上**除了这里没有任何入口**能到达它们。
 * 为什么写成一个常量而不是散落在各卡片里：三个入口的**集合与顺序**必须稳定——
 * 卡片各自提供出口会随卡片显隐（如今日待办为空态时）而缺失或漂移。
 */
const MOBILE_ENTRIES = [
  { to: '/todo', icon: 'check_circle', label: '待办事项' },
  { to: '/notes', icon: 'description', label: '笔记' },
  { to: '/projects', icon: 'hub', label: '项目' },
] as const

/** Focus Synchronizer 仪表盘（Phase 1 实装版） */
export default function DashboardPage() {
  const navigate = useNavigate()
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
            {/* 窄屏只留图标：390px 下问候语 + 日期已占满整行，带字按钮会把这一行撑破。
                文字改为 sr-only 保留无障碍名（Button 不透传 aria-label，只能从内容给名）。 */}
            <span className="hidden md:inline">记一笔</span>
            <span className="sr-only md:hidden">记一笔</span>
          </Button>
        }
      />

      {/* 窄屏专属二级入口行：紧贴问候头、在指标卡之上，位置固定不随卡片显隐变化 */}
      <nav className="mb-4 grid grid-cols-3 gap-3 md:hidden" aria-label="待办、笔记、项目入口">
        {MOBILE_ENTRIES.map((entry) => (
          <button
            key={entry.to}
            className="surface-card flex flex-col items-center gap-1.5 py-3 transition-transform active:scale-95"
            onClick={() => navigate(entry.to)}
          >
            <Icon name={entry.icon} size={20} className="text-primary" />
            <span className="text-[0.8571rem] font-medium text-on-surface-variant">
              {entry.label}
            </span>
          </button>
        ))}
      </nav>

      {/* 指标卡：窄屏 2×2 等分（4 列会把 26px 的数字挤到换行），md 起恢复桌面 4 列 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            深度专注
          </div>
          {/* 读数一律 nowrap：窄屏 2 列时卡宽仅 ~139px，换行会把数字与单位拆开成两行 */}
          <div className="mt-1 text-[1.8571rem] font-bold whitespace-nowrap text-primary">
            {focusMinutes}
            <span className="text-[0.9286rem] text-outline"> 分钟</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            今日待办
          </div>
          <div className="mt-1 text-[1.8571rem] font-bold whitespace-nowrap">
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
          <div className="mt-1 text-[1.8571rem] font-bold whitespace-nowrap text-warning">
            {bestStreak}
            <span className="text-[0.9286rem] text-outline"> 天</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            累计收款
          </div>
          <div className="mt-1 text-[1.8571rem] font-bold whitespace-nowrap text-success">
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
      <div className="mt-4 grid grid-cols-1 items-stretch gap-4 md:mt-5 lg:grid-cols-12 lg:grid-rows-[auto_minmax(0,1fr)]">
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

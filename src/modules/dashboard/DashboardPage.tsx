import { useCollection, useTodayFocusMinutes, useBestHabitStreak } from '@/queries/hooks'
import { Card, PageHeader, Button } from '@/design-system/ui'
import type { Todo, Customer, Transaction } from '@/db/types'
import { FocusCard, HabitLoopCard, TodayTodosCard } from './cards'
import dayjs from 'dayjs'
import { isDueToday, isTodoOverdue } from '@/modules/todo/domain'
import { useUserName } from '@/modules/identity'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '@/design-system/Icon'
import { useEffect, useState } from 'react'
import { usePersonalQuery, type Value } from '@/queries/personal'
import { FeedList } from '@/modules/activities/FeedList'
import CapturePanel from '@/modules/activities/CapturePanel'
import { moneyLabel, statusLabel, formatFactTime } from '@/shared/records'
import { moneySummary } from '@/modules/finance/money'
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
function Records({ queryName, input, title }: { queryName: string; input: Value; title: string }) {
  const query = usePersonalQuery(queryName, { limit: 5, ...input })
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-[1.0714rem] font-semibold">{title}</h2>
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.loading && !query.data ? <p role="status">正在读取…</p> : null}
      {query.data ? (
        <>
          <ul className="divide-y divide-outline-variant/30">
            {query.data.items.map((row) => (
              <li key={String(row.id)} className="py-2.5 text-sm">
                <Link className="text-primary" to={String(row.path || '/timeline')}>
                  {String(row.title || row.summary || statusLabel(row.status))}
                </Link>
                {row.amountMinor !== undefined ? (
                  <p>
                    {moneyLabel(row.amountMinor, row.currency)} · {String(row.currency)}
                  </p>
                ) : null}
                {row.dueAt ? (
                  <p className="text-sm">截止 {formatFactTime(row.dueAt, 'date')}</p>
                ) : null}
                {row.initiator ? (
                  <p className="text-xs text-outline">
                    {String(row.initiator)} · {statusLabel(row.status)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {!query.data.items.length ? <p className="text-sm text-outline">暂无记录</p> : null}
          {query.data.nextCursor ? (
            <button
              className="text-sm text-primary"
              disabled={query.loading}
              onClick={() => void query.more()}
            >
              继续读取
            </button>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}

/** 窄屏保留常用业务直达入口，新视图仍可从底部导航进入。 */
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

  const [todayStr, setTodayStr] = useState(today)
  useEffect(() => {
    const update = () => setTodayStr(today())
    const timer = setInterval(update, 30000)
    window.addEventListener('pageshow', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pageshow', update)
    }
  }, [])
  const events = usePersonalQuery('search_activities', { from: todayStr, to: todayStr, limit: 5 })
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
  const income = moneySummary(transactions, 'income')

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
          <Button icon="post_add" variant="ghost" onClick={() => navigate('/finance?new=1')}>
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
            className="press surface-card flex flex-col items-center gap-1.5 py-3"
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
          {/* key 随读数变化 → 数值更新时整块重挂、anim-enter 淡入一次，
              让「专注分钟在走 / 待办又减一条」这类变化被看见（而非静默改数字）。 */}
          <div
            key={`focus-${focusMinutes}`}
            className="anim-enter mt-1 text-[1.8571rem] font-bold whitespace-nowrap text-primary"
          >
            {focusMinutes}
            <span className="text-[0.9286rem] text-outline"> 分钟</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            今日待办
          </div>
          <div
            key={`todo-${openToday}`}
            className="anim-enter mt-1 text-[1.8571rem] font-bold whitespace-nowrap"
          >
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
          <div
            key={`streak-${bestStreak}`}
            className="anim-enter mt-1 text-[1.8571rem] font-bold whitespace-nowrap text-warning"
          >
            {bestStreak}
            <span className="text-[0.9286rem] text-outline"> 天</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[0.8571rem] font-medium uppercase tracking-wide text-outline">
            累计收款
          </div>
          <div
            key={`income-${income}`}
            className="anim-enter mt-1 break-words text-[1.2857rem] font-bold text-success"
          >
            {income}
          </div>
          <div className="mt-0.5 text-[0.7857rem] text-outline">{customers.length} 位联系人</div>
        </Card>
      </div>

      {/* 延续原首页左 7 / 右 5 布局，记录卡沿用有确认与隔离草稿的新入口。 */}
      <div className="mt-4 grid grid-cols-1 items-stretch gap-4 md:mt-5 lg:grid-cols-12 lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="grid min-h-0 gap-4 lg:col-span-7 lg:row-span-2 lg:grid-rows-[auto_minmax(0,1fr)]">
          <FocusCard />
          <TodayTodosCard />
        </div>
        <div className="grid min-h-0 gap-4 lg:col-span-5 lg:row-span-2 lg:grid-rows-[auto_minmax(0,1fr)]">
          <HabitLoopCard />
          <CapturePanel />
        </div>
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-12">
        <Card className="p-5 lg:col-span-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
              <Icon name="timeline" className="text-primary" />
              今天发生的事
            </h2>
            <Link className="text-sm text-primary" to="/timeline">
              全部时间线 →
            </Link>
          </div>
          {events.error ? (
            <p role="alert" className="text-sm text-danger">
              {events.error}
            </p>
          ) : null}
          {events.loading && !events.data ? <p role="status">正在读取…</p> : null}
          <FeedList items={events.data?.items || []} />
          {events.data && !events.data.items.length ? (
            <p className="py-6 text-center text-sm text-outline">
              今天还没有记录，从随手记录开始。
            </p>
          ) : null}
          {events.data?.nextCursor ? (
            <Button variant="ghost" disabled={events.loading} onClick={() => void events.more()}>
              继续读取
            </Button>
          ) : null}
        </Card>
        <div className="space-y-4 lg:col-span-5">
          <Records queryName="query_finance" input={{ status: '待对账' }} title="待核对收支" />
          <Records
            queryName="list_operations"
            input={{ status: 'awaiting_confirmation' }}
            title="待确认操作"
          />
          <Records
            queryName="list_operations"
            input={{ status: 'committed' }}
            title="最近录入与修改"
          />
        </div>
      </div>
    </div>
  )
}

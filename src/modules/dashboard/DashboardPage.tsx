import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader } from '@/design-system/ui'
import { usePersonalQuery, type Value } from '@/queries/personal'
import { FeedList } from '@/modules/activities/FeedList'
import CapturePanel from '@/modules/activities/CapturePanel'
import { moneyLabel, statusLabel, formatFactTime } from '@/shared/records'
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
function Records({ queryName, input, title }: { queryName: string; input: Value; title: string }) {
  const query = usePersonalQuery(queryName, { limit: 5, ...input })
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.loading && !query.data ? <p role="status">正在读取…</p> : null}
      {query.data ? (
        <>
          <ul className="space-y-3">
            {query.data.items.map((row) => (
              <li key={String(row.id)}>
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
            <button className="text-primary" onClick={() => void query.more()}>
              继续读取
            </button>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}
export default function DashboardPage() {
  const [date, setDate] = useState(today)
  useEffect(() => {
    const update = () => setDate(today())
    const timer = setInterval(update, 30000)
    window.addEventListener('pageshow', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pageshow', update)
    }
  }, [])
  const events = usePersonalQuery('search_activities', { from: date, to: date, limit: 10 })
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader title="今天" subtitle={date} />
      <nav className="flex flex-wrap gap-3" aria-label="日常操作">
        {[
          ['/todo?new=1', '新建待办'],
          ['/finance?new=1', '记一笔收支'],
          ['/notes', '笔记'],
          ['/projects', '事项'],
        ].map(([to, label]) => (
          <Link className="press surface-card px-4 py-3 text-primary" key={to} to={to}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">今天发生的事</h2>
          {events.error ? <p role="alert">{events.error}</p> : null}
          {events.loading ? <p role="status">正在读取…</p> : null}
          <FeedList items={events.data?.items || []} />
          {events.data && !events.data.items.length ? <p>今天还没有正式记录。</p> : null}
          <Link className="inline-block text-primary" to="/timeline">
            打开个人时间线
          </Link>
          <CapturePanel />
        </section>
        <section className="space-y-4">
          <Records queryName="query_tasks" input={{ due: 'today' }} title="今天要兑现的承诺" />
          <Records queryName="query_tasks" input={{ due: 'overdue' }} title="已逾期承诺" />
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
        </section>
      </div>
      <nav className="flex gap-4 text-sm text-primary">
        <Link to="/habits">习惯</Link>
        <Link to="/trophies">成长记录</Link>
        <Link to="/inspiration">灵感</Link>
      </nav>
    </div>
  )
}

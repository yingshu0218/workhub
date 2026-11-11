import { Link } from 'react-router-dom'
import { PageHeader, Card } from '@/design-system/ui'
export default function MorePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="更多" />
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        {[
          ['/todo', '待办'],
          ['/finance', '收支'],
          ['/notes', '笔记'],
          ['/projects', '长期事项'],
          ['/habits', '习惯'],
          ['/trophies', '奖杯'],
          ['/inspiration', '灵感'],
          ['/profile', '个人资料'],
          ['/trash', '回收站'],
          ['/settings', '设置'],
        ].map(([to, label]) => (
          <Link key={to} className="rounded-xl bg-surface-container-low p-4 text-primary" to={to}>
            {label}
          </Link>
        ))}
      </Card>
    </div>
  )
}

import { Link } from 'react-router-dom'
import { PageHeader, Card } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import { MODULE_THEMES, moduleForPath, moduleThemeStyle } from '@/shared/moduleTheme'
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
          ['/inspiration', '灵感'],
          ['/profile', '账号偏好'],
          ['/trash', '回收站'],
          ['/settings', '设置'],
        ].map(([to, label]) => (
          <Link key={to} className="module-theme flex items-center gap-3 rounded-xl bg-primary-fixed p-4 text-primary" style={moduleThemeStyle(moduleForPath(to))} to={to}>
            <Icon name={MODULE_THEMES[moduleForPath(to)].icon} />
            {label}
          </Link>
        ))}
      </Card>
    </div>
  )
}

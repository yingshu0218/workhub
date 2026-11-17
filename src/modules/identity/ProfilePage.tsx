import { NavLink } from 'react-router-dom'
import { Avatar, Card, PageHeader } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import { useIdentity } from './index'

export default function ProfilePage() {
  const identity = useIdentity()

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <PageHeader title="账号偏好" />
      <Card className="flex items-center gap-4 p-5 md:p-6">
        <Avatar name={identity.name} size={64} />
        <div className="min-w-0">
          <div className="break-words text-[1.2857rem] font-bold">{identity.name}</div>
          <div className="text-[0.9286rem] text-on-surface-variant">
            {identity.workspace} · {identity.role}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {[
          { to: '/settings', icon: 'settings', label: '系统设置', hint: '账号、外观、Agent 接入与数据备份' },
          { to: '/module-config', icon: 'tune', label: '功能配置', hint: '各业务模块的规则' },
          { to: '/trash', icon: 'settings_backup_restore', label: '回收站', hint: '核对和恢复最近删除的记录' },
        ].map((item, i) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={`flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover ${
              i > 0 ? 'border-t border-outline-variant/40' : ''
            }`}
          >
            <Icon name={item.icon} size={20} className="text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9643rem] font-medium leading-tight">{item.label}</span>
              <span className="block text-[0.7857rem] text-outline">{item.hint}</span>
            </span>
            <Icon name="chevron_right" size={18} className="text-outline" />
          </NavLink>
        ))}
      </Card>
    </div>
  )
}

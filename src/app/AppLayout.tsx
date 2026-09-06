import { NavLink, useLocation } from 'react-router-dom'
import { Avatar, Chip } from '@/design-system/ui'
import { useSyncStore } from '@/sync/store'

const NAV_ITEMS = [
  { to: '/', icon: 'dashboard', label: '工作台' },
  { to: '/todo', icon: 'check_circle', label: '待办事项' },
  { to: '/crm', icon: 'group', label: '客户管理' },
  { to: '/finance', icon: 'account_balance_wallet', label: '财务中心' },
  { to: '/notes', icon: 'description', label: '团队笔记' },
  { to: '/habits', icon: 'local_fire_department', label: '打卡习惯' },
  { to: '/trophies', icon: 'emoji_events', label: '成就奖杯' },
]

const TITLES: Record<string, string> = {
  '/': 'Focus Synchronizer',
  '/todo': '待办事项',
  '/crm': '客户管理',
  '/finance': '财务中心',
  '/notes': '团队笔记',
  '/habits': '打卡习惯',
  '/trophies': '成就奖杯',
  '/profile': '个人主页',
  '/inspiration': '灵感闪现',
  '/settings': '系统设置',
}

function SyncBadge() {
  const { status, pendingCount } = useSyncStore()
  if (status === 'syncing')
    return (
      <Chip tone="blue" icon="sync">
        同步中
      </Chip>
    )
  if (status === 'offline' || pendingCount > 0)
    return (
      <Chip tone="amber" icon="cloud_off">
        离线待同步{pendingCount > 0 ? ` · ${pendingCount}` : ''}
      </Chip>
    )
  return (
    <Chip tone="green" icon="cloud_done">
      已同步
    </Chip>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const title =
    TITLES[pathname] ?? NAV_ITEMS.find((n) => pathname.startsWith(n.to))?.label ?? '寻鸽工作台'

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-outline-variant/40 bg-surface-container-lowest">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-on-primary">
            <span className="material-symbols-rounded msr-fill">flight_takeoff</span>
          </div>
          <div>
            <div className="text-[15px] font-bold leading-tight">寻鸽工作台</div>
            <div className="text-[11px] text-outline">Nexus Workspace</div>
          </div>
        </div>

        {/* 灵感闪现高亮入口 */}
        <div className="px-3">
          <NavLink
            to="/inspiration"
            className="mb-3 flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-primary to-primary-container px-3.5 py-2.5 text-on-primary transition-transform hover:scale-[1.01]"
          >
            <span className="material-symbols-rounded msr-fill">auto_awesome</span>
            <div className="flex-1">
              <div className="text-[13px] font-semibold leading-tight">灵感闪现</div>
              <div className="text-[11px] opacity-80">下一件最值得推进的事</div>
            </div>
          </NavLink>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                  isActive
                    ? 'bg-primary-fixed font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`
              }
            >
              <span className="material-symbols-rounded">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-outline-variant/40 p-3">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] ${
                isActive
                  ? 'bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`
            }
          >
            <span className="material-symbols-rounded">settings</span>
            系统设置
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-surface-container ${
                isActive ? 'bg-primary-fixed' : ''
              }`
            }
          >
            <Avatar name="陈致远" size={32} />
            <div className="flex-1">
              <div className="text-[13px] font-medium leading-tight">陈致远</div>
              <div className="text-[11px] text-outline">青枫工作室 · Owner</div>
            </div>
            <span className="material-symbols-rounded text-[18px] text-outline">
              expand_more
            </span>
          </NavLink>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant/40 bg-surface-container-lowest px-6">
          <div className="text-[14px] font-semibold text-on-surface-variant">{title}</div>
          <div className="flex items-center gap-3">
            <button
              className="flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/60 px-3 text-[12px] text-outline hover:border-primary hover:text-primary"
              title="全局搜索（开发中，Phase 6 实装）"
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>search</span>
              搜索
              <kbd className="rounded bg-surface-container-high px-1 text-[10px]">⌘K</kbd>
            </button>
            <SyncBadge />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
      </div>
    </div>
  )
}

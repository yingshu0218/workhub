import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Chip } from '@/design-system/ui'
import { useSyncStore } from '@/sync/store'
import { registerShortcut } from '@/shared/shortcuts'
import CommandPalette from './CommandPalette'
import TrophyUnlockToast from './TrophyUnlockToast'
import QuickCapture from '@/modules/notes/QuickCapture'

const NAV_ITEMS = [
  { to: '/', icon: 'dashboard', label: '工作台' },
  { to: '/notes', icon: 'description', label: '笔记' },
  { to: '/todo', icon: 'check_circle', label: '待办事项' },
  { to: '/projects', icon: 'hub', label: '项目' },
  { to: '/crm', icon: 'group', label: '客户管理' },
  { to: '/finance', icon: 'account_balance_wallet', label: '财务中心' },
  { to: '/habits', icon: 'local_fire_department', label: '打卡习惯' },
  { to: '/trophies', icon: 'emoji_events', label: '成就奖杯' },
  { to: '/inspiration', icon: 'auto_awesome', label: '灵感闪现' },
]

const TITLES: Record<string, string> = {
  '/': 'Focus Synchronizer',
  '/todo': '待办事项',
  '/projects': '项目',
  '/crm': '客户管理',
  '/crm/canvas': '客户关系画布',
  '/crm/:id/timeline': '客户时间线',
  '/finance': '财务中心',
  '/notes': '笔记',
  '/habits': '打卡习惯',
  '/trophies': '成就奖杯',
  '/profile': '个人主页',
  '/inspiration': '灵感闪现',
  '/settings': '系统设置',
}

/** 工作区条目（原型 19-dashboard-account）：切换仅改 UI 选中态，数据隔离 Phase 7 后考虑 */
const WORKSPACES = [
  { id: 'ws-main', name: '青枫工作室', role: 'Owner', sub: '团队协作者 · Owner' },
  { id: 'ws-personal', name: '个人空间', role: 'Personal', sub: '个人空间 · Personal' },
]

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
  const navigate = useNavigate()
  // /crm/:id/timeline 为动态段路由，TITLES 精确匹配不到，先按后缀识别
  const title =
    (pathname.match(/^\/crm\/[^/]+\/timeline$/) ? TITLES['/crm/:id/timeline'] : undefined) ??
    TITLES[pathname] ??
    NAV_ITEMS.find((n) => pathname.startsWith(n.to))?.label ??
    '寻鸽工作台'

  // ⌘K 命令面板（走统一快捷键注册表）
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    return registerShortcut({
      combo: 'mod+k',
      description: '唤起全局搜索 / 命令面板',
      scope: 'global',
      handler: () => setPaletteOpen((o) => !o),
    })
  }, [])

  // 工作区切换面板（轻量：仅 UI 选中态）
  const [activeWs, setActiveWs] = useState(WORKSPACES[0].id)
  const [wsOpen, setWsOpen] = useState(false)
  const wsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!wsOpen) return
    const onDown = (e: MouseEvent) => {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [wsOpen])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-outline-variant/40 bg-surface-container-lowest">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-on-primary">
            <Icon name="flight_takeoff" fill />
          </div>
          <div>
            <div className="text-[1.0714rem] font-bold leading-tight">寻鸽工作台</div>
            <div className="text-[0.7857rem] text-outline">Nexus Workspace</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV_ITEMS.map((item) => {
            /* 特设高亮：工作台（置顶）+ 灵感闪现（置底）与中部常规项做视觉区分，
               保持设计 token 驱动，随深浅模式 / 主题包 / 皮肤自动适配 */
            const featured =
              item.to === '/' || item.to === '/inspiration'
                ? item.to === '/'
                  ? 'workbench' // 工作台：品牌「首页」入口
                  : 'inspire' // 灵感闪现：置底特设「闪念」入口
                : undefined
            const isFirst = item.to === '/'
            const isLast = item.to === '/inspiration'
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={isFirst}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] transition-all',
                    featured === 'workbench'
                      ? isActive
                        ? 'bg-primary font-semibold text-on-primary ring-1 ring-primary shadow-[0_2px_8px_rgba(0,0,0,0.18)]'
                        : 'font-medium text-primary hover:bg-primary-fixed/70'
                      : featured === 'inspire'
                        ? isActive
                          ? 'border border-primary bg-gradient-to-r from-primary to-primary-container font-semibold text-on-primary shadow-[0_2px_10px_rgba(0,0,0,0.2)]'
                          : 'border border-primary/30 bg-primary-fixed/40 font-medium text-primary hover:border-primary hover:bg-primary-fixed/70'
                        : isActive
                          ? 'bg-primary-fixed font-semibold text-primary'
                          : 'text-on-surface-variant hover:bg-surface-container',
                    isLast ? 'mt-1.5' : '',
                  ].filter(Boolean).join(' ')
                }
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-outline-variant/40 p-3">
          {/* 侧栏快速便签（Issue #70）：底部区块顶部一行，Enter 存一条正式 Note */}
          <QuickCapture />

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] ${
                isActive
                  ? 'bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`
            }
          >
            <Icon name="settings" />
            系统设置
          </NavLink>

          {/* 账号 / 工作区切换 */}
          <div className="relative" ref={wsRef}>
            <button
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-surface-container ${
                pathname === '/profile' ? 'bg-primary-fixed' : ''
              }`}
              onClick={() => setWsOpen((o) => !o)}
            >
              <Avatar name="陈致远" size={32} />
              <div className="flex-1 text-left">
                <div className="text-[0.9286rem] font-medium leading-tight">陈致远</div>
                <div className="text-[0.7857rem] text-outline">
                  {WORKSPACES.find((w) => w.id === activeWs)?.sub ?? '青枫工作室 · Owner'}
                </div>
              </div>
              <Icon
                name={wsOpen ? 'expand_less' : 'expand_more'}
                className="text-[1.2857rem] text-outline"
              />
            </button>

            {wsOpen && (
              <div className="absolute bottom-full left-0 z-40 mb-2 w-full overflow-hidden surface-card-xl shadow-xl">
                <div className="border-b border-outline-variant/30 px-3.5 py-2 text-[0.7857rem] font-semibold uppercase tracking-wide text-outline">
                  工作空间与身份
                </div>
                {WORKSPACES.map((w) => (
                  <button
                    key={w.id}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-container ${
                      activeWs === w.id ? 'bg-primary-fixed/60' : ''
                    }`}
                    onClick={() => {
                      setActiveWs(w.id) // 仅切换 UI 选中态（多工作区数据隔离 Phase 7 后考虑）
                      setWsOpen(false)
                    }}
                  >
                    <Icon
                      name={w.role === 'Personal' ? 'person' : 'diversity_3'}
                      className="text-[1.2857rem] text-primary"
                    />
                    <span className="flex-1">
                      <span className="block text-[0.8929rem] font-medium leading-tight">
                        {w.name}
                      </span>
                      <span className="block text-[0.75rem] text-outline">{w.sub}</span>
                    </span>
                    {activeWs === w.id && (
                      <Icon name="check_circle" fill className="text-[1.1429rem] text-primary" />
                    )}
                  </button>
                ))}
                {/* 账号偏好设置（对齐原型 19：面板底部入口 → /profile） */}
                <button
                  className="flex w-full items-center gap-2.5 border-t border-outline-variant/30 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-container"
                  onClick={() => {
                    navigate('/profile')
                    setWsOpen(false)
                  }}
                >
                  <Icon name="manage_accounts" className="text-[1.2857rem] text-primary" />
                  <span className="text-[0.8929rem] font-medium">账号偏好设置</span>
                </button>
                <div className="border-t border-outline-variant/30 px-3.5 py-2 text-[0.7857rem] text-outline">
                  添加新账号 / 加入工作区（即将上线）
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant/40 bg-surface-container-lowest px-6">
          <div className="text-[1rem] font-semibold text-on-surface-variant">{title}</div>
          <div className="flex items-center gap-3">
            <button
              className="flex h-8 items-center gap-1.5 nav-item !bg-transparent px-3 text-[0.8571rem] text-outline hover:border-primary hover:text-primary"
              onClick={() => setPaletteOpen(true)}
              title="全局搜索（⌘K）"
            >
              <Icon name="search" size={16} />
              搜索
              <kbd className="rounded bg-surface-container-high px-1 text-[0.7143rem]">⌘K</kbd>
            </button>
            <SyncBadge />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
      </div>

      {/* 全局弹层：⌘K 命令面板 + 奖杯解锁（任何页面解锁都能弹） */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <TrophyUnlockToast />
    </div>
  )
}

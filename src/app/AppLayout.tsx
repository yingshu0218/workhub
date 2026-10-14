import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Chip } from '@/design-system/ui'
import { useSyncStore } from '@/sync/store'
import { deriveSyncBadge } from '@/sync/badge'
import { registerShortcut } from '@/shared/shortcuts'
import CommandPalette from './CommandPalette'
import MobileTabBar from './MobileTabBar'
import TrophyUnlockToast from './TrophyUnlockToast'
import { ToastProvider } from '@/design-system/Toast'
import QuickCapture from '@/modules/notes/QuickCapturePanel'
import { DEFAULT_WORKSPACE_SUB, useIdentity } from '@/modules/identity'

/**
 * 侧栏菜单（顺序即渲染顺序）。
 * `childPrefixed`：该菜单是否含子路由——为 true 时子路径仍算选中（见 isNavItemActive）。
 * 它是菜单自身的属性，新增带子路由的菜单只需在数据上标一个字段，无需再维护一份白名单。
 */
const NAV_ITEMS = [
  { to: '/', icon: 'dashboard', label: '工作台' },
  { to: '/notes', icon: 'description', label: '笔记' },
  { to: '/todo', icon: 'check_circle', label: '待办事项' },
  { to: '/projects', icon: 'hub', label: '项目', childPrefixed: true },
  { to: '/crm', icon: 'group', label: '客户管理', childPrefixed: true },
  { to: '/finance', icon: 'account_balance_wallet', label: '财务中心' },
  { to: '/habits', icon: 'local_fire_department', label: '打卡习惯' },
  { to: '/trophies', icon: 'emoji_events', label: '成就奖杯' },
  { to: '/inspiration', icon: 'auto_awesome', label: '灵感闪现' },
]

/**
 * 侧栏选中判定（Issue #128）——「菜单选中后色块高亮一直存在」的修复。
 *
 * 成因：NavLink 默认 `isActive` 是**前缀匹配**，`/todo` 在进入 `/module-config/...`、
 * `/todo/xxx` 等更长路径时仍被判为 active，色块一直挂着（视觉上像"卡住了"）。
 *
 * 口径：只有**当前页面就属于该菜单**才高亮——
 * - `/`      仅根路径（end 精确）
 * - 下列「有子路由」的菜单：该段自身及其子路径都算（如 `/crm/canvas` 仍属客户管理、
 *   `/module-config/crm/intimacy` 仍属功能配置）
 * - 其余一律精确匹配：跨到别的模块（如 /todo → /module-config）立即失去高亮
 */
const NAV_CHILD_PREFIXED = new Set<string>([
  ...NAV_ITEMS.filter((i) => 'childPrefixed' in i && i.childPrefixed).map((i) => i.to),
  // 功能配置菜单不在 NAV_ITEMS 里（渲染在侧栏底部独立区块），单独登记
  '/module-config',
])
export function isNavItemActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/'
  if (NAV_CHILD_PREFIXED.has(to)) return pathname === to || pathname.startsWith(`${to}/`)
  return pathname === to
}

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
  '/module-config': '功能配置',
}

/** 工作区条目（原型 19-dashboard-account）：切换仅改 UI 选中态，数据隔离 Phase 7 后考虑 */
/** 工作区条目（原型 19-dashboard-account）：只读常量，身份名/工作区名由 useIdentity 提供（Issue #123） */
const WORKSPACES = [
  { id: 'ws-main', role: 'Owner', sub: '团队协作者 · Owner' },
  { id: 'ws-personal', role: 'Personal', sub: '个人空间 · Personal' },
]

/**
 * 顶栏同步徽章。
 *
 * 只负责渲染 —— 状态判定统一收口在 `src/sync/badge.ts`（顶栏与设置页共用同一份派生，
 * 否则出现「徽章说连不上、设置说已同步」这类互相打脸）。
 *
 * 悬浮提示里摊开徽章塞不下的事实：同步中心地址、待推送条数、上次同步、最近错误。
 */
function SyncBadge() {
  const { status, pendingCount, target, reachability, lastSyncAt, lastError, serverUrl } =
    useSyncStore()
  const view = deriveSyncBadge({
    status,
    pendingCount,
    target,
    reachability,
    lastSyncAt,
    lastError,
    serverUrl,
    now: Date.now(),
  })
  return (
    <span title={view.title} className="cursor-default">
      <Chip tone={view.tone} icon={view.icon}>
        {view.label}
      </Chip>
    </span>
  )
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // /crm/:id/timeline 与 /module-config/... 为动态段路由，TITLES 精确匹配不到，先按前缀识别
  const title =
    (pathname.match(/^\/crm\/[^/]+\/timeline$/) ? TITLES['/crm/:id/timeline'] : undefined) ??
    (pathname.startsWith('/module-config') ? TITLES['/module-config'] : undefined) ??
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

  // 当前用户身份（Issue #123）：名字/工作区名唯一事实源，默认「阿蓝」
  const identity = useIdentity()
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
    <div className="app-shell flex overflow-hidden">
      {/* 侧栏：仅在 ≥768px 显示。窄屏改用底部导航（MobileTabBar），
          桌面端视觉与行为完全不变（md:flex 恢复原 flex）。 */}
      <aside className="app-sidebar hidden w-[232px] shrink-0 flex-col border-r border-outline-variant/40 bg-surface-container-lowest md:flex">
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
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={isFirst}
                className={() => {
                  // NavLink 默认前缀匹配会把「待办事项」在 /module-config 等路径下误判为选中
                  // （Issue #128：色块高亮一直存在），统一改用 isNavItemActive 做精确/受控段判定
                  const isActive = isNavItemActive(pathname, item.to)
                  return [
                    'app-nav-link flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] transition-all',
                    isActive ? 'is-active' : '',
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
                  ]
                    .filter(Boolean)
                    .join(' ')
                }}
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="p-3">
          {/* 侧栏快速便签（Issue #70）：设置分隔线上方，Enter 存一条正式 Note */}
          <QuickCapture />
        </div>

        <div className="border-t border-outline-variant/40 p-3">
          <NavLink
            to="/module-config"
            className={() =>
              `app-nav-link mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] ${
                // 功能配置含子路由（/module-config/:moduleId/:itemId），按段判定才正确高亮
                isNavItemActive(pathname, '/module-config')
                  ? 'is-active bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`
            }
            title="各业务模块的规则配置（与系统设置的界面偏好分开）"
          >
            <Icon name="tune" />
            功能配置
          </NavLink>

          <NavLink
            to="/settings"
            className={() =>
              `app-nav-link mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] ${
                isNavItemActive(pathname, '/settings')
                  ? 'is-active bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`
            }
            title="外观、排版、通知、同步、数据导出等应用级偏好"
          >
            <Icon name="settings" />
            系统设置
          </NavLink>

          {/* 账号 / 工作区切换 */}
          <div className="relative" ref={wsRef}>
            <button
              className={`app-nav-link flex w-full items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-surface-container ${
                pathname === '/profile' ? 'is-active bg-primary-fixed' : ''
              }`}
              onClick={() => setWsOpen((o) => !o)}
            >
              <Avatar name={identity.name} size={32} />
              <div className="flex-1 text-left">
                <div className="text-[0.9286rem] font-medium leading-tight">{identity.name}</div>
                <div className="text-[0.7857rem] text-outline">
                  {WORKSPACES.find((w) => w.id === activeWs)?.sub ?? DEFAULT_WORKSPACE_SUB}
                </div>
              </div>
              <Icon
                name={wsOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
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
                        {w.id === 'ws-main' ? identity.workspace : '个人空间'}
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
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <header className="app-header flex h-14 shrink-0 items-center justify-between gap-2 border-b border-outline-variant/40 bg-surface-container-lowest px-4 md:px-6">
          <div className="min-w-0 truncate text-[1rem] font-semibold text-on-surface-variant">
            {title}
          </div>
          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <button
              className="flex h-8 items-center gap-1.5 nav-item !bg-transparent px-2 text-[0.8571rem] text-outline hover:border-primary hover:text-primary md:px-3"
              onClick={() => setPaletteOpen(true)}
              title="全局搜索（⌘K）"
              aria-label="全局搜索"
            >
              <Icon name="search" size={16} />
              {/* 窄屏没有物理键盘，⌘K 无意义 → 收成纯图标 */}
              <span className="hidden md:inline">搜索</span>
              <kbd className="hidden rounded bg-surface-container-high px-1 text-[0.7143rem] md:inline">
                ⌘K
              </kbd>
            </button>
            <SyncBadge />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">{children}</main>
        {/* 底部导航（<768px）。刻意放在**流内**而非 fixed：内容区天然不被遮挡，
            不需要「给底栏留 padding」的补偿，也不与弹层抢 z-index。 */}
        <MobileTabBar />
      </div>

      {/* 全局弹层：⌘K 命令面板 + 奖杯解锁（任何页面解锁都能弹） */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <TrophyUnlockToast />
    </div>
  )
}

/** 布局入口：挂载全局 Toast Provider，供各模块 useToast() 使用（替代原生 alert） */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AppLayoutInner>{children}</AppLayoutInner>
    </ToastProvider>
  )
}

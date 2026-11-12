import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Icon } from '@/design-system/Icon'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Chip } from '@/design-system/ui'
import { useSyncStore } from '@/sync/store'
import { deriveSyncBadge } from '@/sync/badge'
import { isServerFirstWeb } from '@/platform/env'
import { registerShortcut } from '@/shared/shortcuts'
import CommandPalette from './CommandPalette'
import MobileTabBar from './MobileTabBar'
import TrophyUnlockToast from './TrophyUnlockToast'
import { ToastProvider } from '@/design-system/Toast'
import { usePresence } from '@/shared/usePresence'
import QuickCapture from '@/modules/notes/QuickCapturePanel'
import { DEFAULT_WORKSPACE_SUB, useIdentity } from '@/modules/identity'
import {
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
  isSidebarCollapsed,
  onSidebarCollapsedChange,
  toggleSidebarCollapsed,
} from './sidebarPref'

/**
 * 侧栏菜单（顺序即渲染顺序）。
 * `childPrefixed`：该菜单是否含子路由——为 true 时子路径仍算选中（见 isNavItemActive）。
 * 它是菜单自身的属性，新增带子路由的菜单只需在数据上标一个字段，无需再维护一份白名单。
 */
const NAV_ITEMS = [
  { to: '/', icon: 'dashboard', label: '工作台' },
  { to: '/todo', icon: 'check_circle', label: '待办事项' },
  { to: '/finance', icon: 'account_balance_wallet', label: '收支管理' },
  { to: '/crm', icon: 'group', label: '联系人', childPrefixed: true },
  { to: '/notes', icon: 'description', label: '笔记', childPrefixed: true },
  { to: '/projects', icon: 'folder', label: '事项', childPrefixed: true },
  { to: '/timeline', icon: 'timeline', label: '时间线' },
  { to: '/graph', icon: 'hub', label: '关系图谱' },
  { to: '/habits', icon: 'check_circle', label: '打卡习惯' },
  { to: '/trophies', icon: 'emoji_events', label: '成就奖杯' },
  { to: '/inspiration', icon: 'bolt', label: '灵感闪现' },
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
  '/timeline': '时间线',
  '/graph': '图谱',
  '/more': '更多',
  '/todo': '待办',
  '/projects': '项目',
  '/crm': '联系人',
  '/crm/canvas': '客户关系画布',
  '/crm/:id/timeline': '客户时间线',
  '/finance': '收支',
  '/notes': '笔记',
  '/habits': '打卡习惯',
  '/trophies': '成就奖杯',
  '/profile': '个人主页',
  '/inspiration': '灵感闪现',
  '/settings': '系统设置',
  '/trash': '回收站',
  '/module-config': '功能配置',
}

/** 工作区条目（原型 19-dashboard-account）：切换仅改 UI 选中态，数据隔离 Phase 7 后考虑 */
/** 工作区条目（原型 19-dashboard-account）：只读常量，身份名/工作区名由 useIdentity 提供（Issue #123） */
const WORKSPACES = [{ id: 'ws-main', role: 'Personal', sub: '个人空间' }]

/**
 * 是否真的有多个工作空间可切换（2026-11-03：目前只有个人空间）。
 *
 * 为什么据此隐藏切换器：只列一项的「切换」是假的 —— 点开只有它自己，
 * 还顺带许了个「加入工作区（即将上线）」的愿。等真有多工作区再放出来。
 */
const CAN_SWITCH_WORKSPACE = WORKSPACES.length > 1

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
    // Web 生产 = 服务端唯一真源：徽章讲「服务器/断线」，不讲「仅本机/待推送」
    mode: isServerFirstWeb() ? 'server' : 'local',
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
  // 首页刻意不显示页面级标题：仪表盘自己已有问候标题，再挂一个「Focus Synchronizer」
  // 就是一层无信息量的旁白（2026-11-03 用户裁定删掉）
  const title =
    pathname === '/' ? '' :
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

  // 侧栏伸缩（2026-10-19）：持久化偏好在 sidebarPref 单例里，这里只订阅
  const collapsed = useSyncExternalStore(onSidebarCollapsedChange, isSidebarCollapsed)
  useEffect(() => {
    return registerShortcut({
      combo: 'mod+b',
      description: '收起 / 展开左侧菜单',
      scope: 'global',
      handler: () => toggleSidebarCollapsed(),
    })
  }, [])

  // 悬停临时展开（图标轨态专用）：纯 UI 瞬态，不落偏好 —— 鼠标移开即收回。
  // 用 120ms 延迟关闭：图标与抽屉之间有间隙，立刻收会让指针「路过」时闪一下。
  const [hoverOpen, setHoverOpen] = useState(false)
  const hoverTimer = useRef<number | null>(null)
  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  useEffect(() => clearHoverTimer, [])
  const openHover = () => {
    clearHoverTimer()
    setHoverOpen(true)
  }
  const closeHover = () => {
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => setHoverOpen(false), 120)
  }
  // 桌面断点以下侧栏整体隐藏（MobileTabBar 接管），悬停态随之失效
  const railOpen = collapsed && hoverOpen

  // 当前用户身份（Issue #123）：名字/工作区名唯一事实源，默认「阿蓝」
  const identity = useIdentity()
  // 工作区切换面板（轻量：仅 UI 选中态）
  const [activeWs, setActiveWs] = useState(WORKSPACES[0].id)
  const [wsOpen, setWsOpen] = useState(false)
  const wsRef = useRef<HTMLDivElement>(null)
  // 工作区下拉的进出场（原先 {wsOpen && …} 硬切换，关闭瞬间消失）
  const {
    present: wsPresent,
    phase: wsPhase,
    ref: wsPanelRef,
  } = usePresence(wsOpen, 150)
  const wsClosing = wsPhase === 'out'
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
      {/* 侧栏伸缩（2026-10-19 用户需求：「最左侧的菜单没有伸缩按钮」）。
          形态：232px 完整侧栏 ↔ 56px 图标轨；收起后**鼠标悬浮临时浮出**完整侧栏。

          ⚠️ 为什么拆成「占位槽 + 浮层」两层，而不是让 <aside> 自己变宽：
          若 <aside> 参与文档流并在悬停时撑到 232px，每次划过菜单都会把**主内容区整体
          重排一遍**（页面持续左右抖动）。所以宽度锚点交给外层的 slot（它只占 56px 不动），
          <aside> 绝对定位在 slot 内、只向外「叠」出去 —— 与既有弹层同款（absolute + shadow），
          只叠不挤。展开态（未收起）时 slot 与 aside 同宽 232，视觉与改动前完全一致。

          ⚠️ 宽度用**内联 style** 表达，不用 Tailwind 任意值类 `w-[232px]`：那是编译期常量，
          拼不出运行时可变宽度；且皮肤层（skins.css）对 `.app-sidebar` 有接管规则，
          内联宽度与它正交（皮肤只管 border/形态，不管宽度）。 */}
      <div
        className="app-sidebar-slot relative hidden shrink-0 md:block"
        style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
      >
        <aside
          className={`app-sidebar absolute inset-y-0 left-0 flex flex-col bg-surface-container-lowest transition-[width] duration-200 ${
            railOpen ? 'z-30 border-r border-outline-variant/40 shadow-[8px_0_24px_rgba(0,0,0,0.10)]' : 'border-r border-outline-variant/40'
          }`}
          style={{ width: railOpen ? SIDEBAR_WIDTH_EXPANDED : collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
          data-collapsed={collapsed ? 'true' : 'false'}
          data-rail-open={railOpen ? 'true' : 'false'}
          onMouseEnter={collapsed ? openHover : undefined}
          onMouseLeave={collapsed ? closeHover : undefined}
        >
          <div className={`flex items-center gap-2.5 py-5 ${railOpen ? 'px-5' : 'justify-center px-2'}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary">
              <Icon name="flight_takeoff" fill />
            </div>
            {railOpen && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[1.0714rem] font-bold leading-tight">寻鸽工作台</div>
                <div className="truncate text-[0.7857rem] text-outline">Nexus Workspace</div>
              </div>
            )}
            {/* 伸缩按钮。三态语义统一为「按下后往哪边走」：
                - 图标轨未展开 → 面板展开图标（点一下钉住展开）
                - 图标轨悬浮展开 / 完整侧栏 → 面板收起图标 */}
            <button
              type="button"
              className={`shrink-0 rounded-lg p-1.5 text-outline transition-colors hover:bg-surface-hover hover:text-on-surface ${
                railOpen ? 'ml-auto' : ''
              }`}
              onClick={() => {
                closeHover()
                setHoverOpen(false)
                toggleSidebarCollapsed()
              }}
              title={collapsed ? '展开左侧菜单（⌘B）' : '收起左侧菜单（⌘B）'}
              aria-label={collapsed ? '展开左侧菜单' : '收起左侧菜单'}
              aria-expanded={!collapsed}
            >
              <Icon name={collapsed ? 'left_panel_open' : 'left_panel_close'} size={20} />
            </button>
          </div>

          <nav className={`flex-1 space-y-0.5 overflow-y-auto ${railOpen ? 'px-3' : 'px-2'}`}>
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
              const isActive = isNavItemActive(pathname, item.to)
              // 图标轨态（收起且未浮出）：只留图标，名称交给 title 悬浮提示
              const iconOnly = collapsed && !railOpen
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={isFirst}
                  title={iconOnly ? item.label : undefined}
                  className={() => {
                    // NavLink 默认前缀匹配会把「待办事项」在 /module-config 等路径下误判为选中
                    // （Issue #128：色块高亮一直存在），统一改用 isNavItemActive 做精确/受控段判定
                    return [
                      'app-nav-link flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] transition-all',
                      iconOnly ? 'justify-center px-0' : '',
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
                            : 'text-on-surface-variant hover:bg-surface-hover',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  }}
                >
                  <Icon name={item.icon} />
                  {!iconOnly && item.label}
                </NavLink>
              )
            })}
          </nav>

          <div className={railOpen ? 'p-3' : 'px-2 py-3'}>
            {/* 侧栏快速便签（Issue #70）：设置分隔线上方，Enter 存一条正式 Note。
                图标轨态下收成一枚图标钮（挂 title 提示），点它先浮出侧栏再展开输入。 */}
            <QuickCapture collapsed={collapsed && !railOpen} />
          </div>

          <div className={`border-t border-outline-variant/40 ${railOpen ? 'p-3' : 'px-2 py-3'}`}>
            <NavLink
              to="/trash"
              title={collapsed && !railOpen ? '回收站' : '恢复最近删除的客户、流水、待办、笔记等'}
              className={() =>
                `app-nav-link mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] ${
                  collapsed && !railOpen ? 'justify-center px-0' : ''
                } ${
                  isNavItemActive(pathname, '/trash')
                    ? 'is-active bg-primary-fixed font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-hover'
                }`
              }
            >
              <Icon name="settings_backup_restore" />
              {!(collapsed && !railOpen) && '回收站'}
            </NavLink>

            <NavLink
              to="/module-config"
              title={collapsed && !railOpen ? '功能配置' : '各业务模块的规则配置（与系统设置的界面偏好分开）'}
              className={() =>
                `app-nav-link mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] ${
                  collapsed && !railOpen ? 'justify-center px-0' : ''
                } ${
                  // 功能配置含子路由（/module-config/:moduleId/:itemId），按段判定才正确高亮
                  isNavItemActive(pathname, '/module-config')
                    ? 'is-active bg-primary-fixed font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-hover'
                }`
              }
            >
              <Icon name="tune" />
              {!(collapsed && !railOpen) && '功能配置'}
            </NavLink>

            <NavLink
              to="/settings"
              title={collapsed && !railOpen ? '系统设置' : '外观、排版、通知、同步、数据导出等应用级偏好'}
              className={() =>
                `app-nav-link mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-[0.9643rem] ${
                  collapsed && !railOpen ? 'justify-center px-0' : ''
                } ${
                  isNavItemActive(pathname, '/settings')
                    ? 'is-active bg-primary-fixed font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-hover'
                }`
              }
            >
              <Icon name="settings" />
              {!(collapsed && !railOpen) && '系统设置'}
            </NavLink>

            {/* 账号 / 工作区切换 */}
            <div className="relative" ref={wsRef}>
              <button
                className={`app-nav-link flex w-full items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-surface-hover ${
                  collapsed && !railOpen ? 'justify-center px-0' : ''
                } ${pathname === '/profile' ? 'is-active bg-primary-fixed' : ''}`}
                onClick={() => CAN_SWITCH_WORKSPACE && setWsOpen((o) => !o)}
                title={collapsed && !railOpen ? `${identity.name} · 个人空间` : undefined}
              >
                <Avatar name={identity.name} size={32} />
                {!(collapsed && !railOpen) && (
                  <>
                    <div className="flex-1 text-left">
                      <div className="text-[0.9286rem] font-medium leading-tight">{identity.name}</div>
                      <div className="text-[0.7857rem] text-outline">
                        {WORKSPACES.find((w) => w.id === activeWs)?.sub ?? DEFAULT_WORKSPACE_SUB}
                      </div>
                    </div>
                    {CAN_SWITCH_WORKSPACE && (
                      <Icon
                        name={wsOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
                        className="text-[1.2857rem] text-outline"
                      />
                    )}
                  </>
                )}
              </button>

            {CAN_SWITCH_WORKSPACE && wsPresent && (
              <div
                ref={wsPanelRef}
                /* 从底部向上弹（面板贴在按钮上方），缩放轴落在底边 */
                style={{ transformOrigin: 'bottom center' }}
                className={`absolute bottom-full left-0 z-40 mb-2 w-full overflow-hidden surface-card-xl shadow-xl ${
                  wsClosing ? 'anim-panel-out' : 'anim-pop'
                }`}
              >
                <div className="border-b border-outline-variant/30 px-3.5 py-2 text-[0.7857rem] font-semibold uppercase tracking-wide text-outline">
                  工作空间与身份
                </div>
                {WORKSPACES.map((w) => (
                  <button
                    key={w.id}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover ${
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
                  className="flex w-full items-center gap-2.5 border-t border-outline-variant/30 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover"
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
      </div>

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

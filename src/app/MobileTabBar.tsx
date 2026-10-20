import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from '@/design-system/Icon'

/**
 * 移动端底部导航（<768px 显示；桌面端侧栏不变，见 AppLayout 的 `md:flex`）。
 *
 * 为什么是这 5 个：侧栏有 9 项，直接搬到底部会挤成一条线。按移动原型的既定口径压成
 * 5 个一级入口，待办 / 笔记 / 项目降为「工作台」下的二级入口，灵感闪现不占 Tab 位、
 * 走上方悬浮入口（原型的 02 是全屏态）。
 *
 * 刻意**不给**这些项加 `.app-nav-link` 类：皮肤层（skins.css）会把该类改成直角 / 霓虹 /
 * 玻璃等形态，施加到胶囊导航上会把造型打散。
 */
export const MOBILE_TABS = [
  {
    to: '/',
    icon: 'dashboard',
    label: '工作台',
    matches: ['/', '/todo', '/notes', '/projects'],
  },
  { to: '/crm', icon: 'group', label: '客户', matches: ['/crm'] },
  { to: '/finance', icon: 'account_balance_wallet', label: '财务', matches: ['/finance'] },
  { to: '/habits', icon: 'local_fire_department', label: '习惯', matches: ['/habits'] },
  {
    to: '/profile',
    icon: 'person',
    label: '我的',
    matches: ['/profile', '/trophies', '/settings', '/module-config'],
  },
] as const

/**
 * Tab 激活判定。
 *
 * `'/'` 只认精确匹配（否则任何路径都算「工作台」）；其余按**路径段**匹配，含子路由——
 * 例如 `/crm/canvas`、`/crm/:id/timeline` 都仍属「客户」。
 * 口径与桌面侧栏的 isNavItemActive 同构，但那是「一个菜单 vs 一个路径」，
 * 这里是「一个 Tab vs 一组路径前缀」，故单独一份而不是复用。
 */
export function isMobileTabActive(pathname: string, matches: readonly string[]): boolean {
  return matches.some((p) =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`),
  )
}

export default function MobileTabBar() {
  const { pathname } = useLocation()
  // 已经在灵感闪现页时不再显示悬浮入口（避免「点进去还挂着一个入口」）
  const onInspiration = pathname === '/inspiration'

  return (
    <nav className="app-tabbar relative shrink-0 px-[21px] pt-3 md:hidden">
      {/* 悬浮「灵感闪现」：贴在本导航之上（bottom-full 落在导航顶边），无需写死高度。
          注意本导航是**在流内**的（不是 fixed），所以内容区不会被遮挡，也就没有
          「给底栏留出 padding」这类补偿——这也是选择在流内而不是 fixed 的原因。 */}
      {!onInspiration && (
        <NavLink
          to="/inspiration"
          /* anim-pop 入场（依赖 .anim-pop 的 backwards 填充，否则会锁死 transform、
             让 .app-tab-pill:active 的按压失效）；app-tab-pill 提供按压与颜色过渡。
             出场不做：触发它的场景就是跳到 /inspiration（整页切换），
             为它引入 presence 的收益低于成本。 */
          className="app-tab-pill anim-pop absolute bottom-full right-5 mb-3 flex h-11 items-center gap-1.5 rounded-full bg-primary pl-3.5 pr-4 text-on-primary shadow-[0_8px_20px_rgba(0,74,198,0.32)]"
        >
          <Icon name="auto_awesome" size={18} />
          <span className="text-[0.9286rem] font-semibold">灵感闪现</span>
        </NavLink>
      )}

      <div className="flex h-[62px] items-center rounded-full border border-outline-variant/60 bg-surface-container-lowest p-1 shadow-[0_6px_20px_rgba(4,28,48,0.08)]">
        {MOBILE_TABS.map((tab) => {
          const active = isMobileTabActive(pathname, tab.matches)
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              className={`app-tab-pill flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl ${
                active ? 'bg-primary text-on-primary' : 'text-outline'
              }`}
            >
              <Icon name={tab.icon} size={18} />
              <span className="text-[0.7143rem] font-semibold tracking-[0.4px]">{tab.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}

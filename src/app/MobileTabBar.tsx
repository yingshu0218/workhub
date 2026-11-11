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
 {to:'/',icon:'dashboard',label:'今天',matches:['/']},
 {to:'/timeline',icon:'timeline',label:'时间线',matches:['/timeline','/activities','/operations','/interactions']},
 {to:'/crm',icon:'group',label:'联系人',matches:['/crm']},
 {to:'/graph',icon:'hub',label:'图谱',matches:['/graph']},
 {to:'/more',icon:'menu_book',label:'更多',matches:['/more','/todo','/finance','/notes','/projects','/habits','/profile','/trophies','/settings','/module-config','/inspiration','/trash','/record','/records']},
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
  return (
    <nav aria-label="主要导航" className="app-tabbar relative shrink-0 px-[21px] pt-3 md:hidden">
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

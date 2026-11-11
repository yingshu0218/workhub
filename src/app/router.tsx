import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom'
import AppLayout from './AppLayout'
import AuthorizePage from './AuthorizePage'
import ErrorBoundary from './ErrorBoundary'
import DashboardPage from '@/modules/dashboard/DashboardPage'
import NotFoundPage from './NotFoundPage'

/**
 * 路由级代码分割（审计 P1 · 2026-10-21）：
 * 此前 24 个页面全部静态 import → 主包 768KB（gzip 197KB），打开工作台只为了看待办，
 * 却要下载设置页/关系画布/笔记编辑器的全部代码。改为按路由懒加载后，
 * 各页独立分包、首屏只加载首页与外壳。
 *
 * 保留 eager 的只有：DashboardPage（首屏，避免多一次往返与加载闪烁）与 NotFoundPage（catch-all，
 * 体积极小且必须在任何路径下立即可用）。
 */
const TodoPage = lazy(() => import('@/modules/todo/TodoPage'))
const FinancePage = lazy(() => import('@/modules/finance/FinancePage'))
const CrmPage = lazy(() => import('@/modules/crm/CrmPage'))
const CrmCanvasPage = lazy(() => import('@/modules/crm/CrmCanvasPage'))
const CustomerDetailPage = lazy(() => import('@/modules/crm/CustomerDetailPage'))
const CustomerTimelinePage = lazy(() => import('@/modules/crm/CustomerTimelinePage'))
const CustomerGraphPage = lazy(() => import('@/modules/crm/CustomerGraphPage'))
const AllTimelinesPage = lazy(() => import('@/modules/crm/AllTimelinesPage'))
const PersonalRecordPage = lazy(() => import('@/modules/activities/RecordPage'))
const NotesPage = lazy(() => import('@/modules/notes/NotesPage'))
const NoteEditorPage = lazy(() => import('@/modules/notes/NoteEditorPage'))
const HabitsPage = lazy(() => import('@/modules/habits/HabitsPage'))
const TrophiesPage = lazy(() => import('@/modules/trophies/TrophiesPage'))
const ProfilePage = lazy(() => import('@/modules/trophies/ProfilePage'))
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage'))
const TrashPage = lazy(() => import('@/modules/trash/TrashPage'))
const ModuleConfigPage = lazy(() => import('@/modules/moduleConfig/ModuleConfigPage'))
const ProjectsPage = lazy(() => import('@/modules/projects/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('@/modules/projects/ProjectDetailPage'))
const InspirationPage = lazy(() => import('@/modules/inspiration/InspirationPage'))

/**
 * 懒加载页面的占位。
 * · `min-h-full` 与真实的 `anim-page` wrapper 同款 —— 否则页面从 auto 高度切到真实高度时
 *   会把 /inspiration 的 `h-[calc(100%+3rem)]` 基准顶破（见下方 Shell 里的说明）。
 * · 刻意不引入 spinner 动效：分包加载在本地是一两帧的事，加动效反而制造闪烁。
 */
function RouteLoading() {
  return <div className="min-h-full" aria-busy="true" />
}

/** 路由映射见 docs/寻鸽工作台-开发计划.md 第四节 */
function Shell() {
  const { pathname } = useLocation()

  /**
   * 切页时把内容区滚回顶部。
   *
   * 为什么需要显式做：滚动容器是 AppLayout 里的 `<main class="overflow-y-auto">`，
   * 它在下面那个 wrapper **之外**、不随路由 key 重建 → `scrollTop` 会跨路由保留，
   * 于是从长列表页切到别的页会「停在半空中」。
   *
   * ⚠️ 必须用可选链：测试环境（MemoryRouter 直渲页面、不套 AppLayout）没有 `<main>`，
   * `querySelector` 返回 null → 静默 no-op，不能抛错。
   * 刻意不用 `behavior: 'smooth'`：那是滚动动画，属动效范畴，不该在路由切换里偷偷做。
   */
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <AppLayout>
      {/* 页面级错误边界：单模块崩溃只降级当前页，侧栏与全局能力不受影响；key 随路由重置错误态 */}
      <ErrorBoundary key={pathname}>
        {/* 路由切换入场动画。
            · key 与外层 ErrorBoundary 同源 —— 外层已重建整棵子树、动画本就会重播，
              这里显式再钉一次是**防御性冗余**：日后若有人去掉外层的 key，动画不会静默失效。
            · `min-h-full` 是必需的：/inspiration 用 `h-[calc(100%+3rem)]` 依赖父级确定高度，
              包一层普通 div 会把百分比基准变成 auto、整页塌成内容高度。
              也刻意**不加** overflow-hidden（会切断 main 的滚动）。
            · 动效本身走 .anim-page（`backwards` 填充）—— 若用 both，
              画布/全幅页里 `position: fixed` 的弹层会把 wrapper 的 transform 当成包含块，
              遮罩盖不住侧栏与页头。详见 src/styles/index.css 的说明。 */}
        <div key={pathname} className="anim-page min-h-full">
          {/* Suspense 必须在 wrapper **内部**：fallback 与真实页面共享同一个 min-h-full 容器，
              避免懒加载页面切进来时高度基准变化导致的一次跳动。 */}
          <Suspense fallback={<RouteLoading />}>
            <Outlet />
          </Suspense>
        </div>
      </ErrorBoundary>
    </AppLayout>
  )
}

const router = createBrowserRouter([
  /**
   * 设备授权页放在 Shell 之外：它是「从终端弹出来」的单独确认页，
   * 不该出现侧栏、模块导航或页面切换动画。AuthGate 仍然包在外面（必须登录才能授权）。
   */
  { path: '/authorize', element: <AuthorizePage /> },
  {
    element: <Shell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/todo', element: <TodoPage /> },
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/projects/:id', element: <ProjectDetailPage /> },
      { path: '/crm', element: <CrmPage /> },
      { path: '/crm/canvas', element: <CrmCanvasPage /> },
      { path: '/crm/:id/graph', element: <CustomerGraphPage /> },
      { path: '/crm/:id', element: <CustomerDetailPage /> },
      { path: '/crm/:id/timeline', element: <CustomerTimelinePage /> },
      { path: '/crm/timeline-all', element: <AllTimelinesPage /> },
      { path: '/activities/:id', element: <PersonalRecordPage /> },
      { path: '/interactions/:id', element: <PersonalRecordPage /> },
      { path: '/operations/:id', element: <PersonalRecordPage operation /> },
      { path: '/finance', element: <FinancePage /> },
      { path: '/notes', element: <NotesPage /> },
      { path: '/notes/:id', element: <NoteEditorPage /> },
      { path: '/habits', element: <HabitsPage /> },
      { path: '/trophies', element: <TrophiesPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/inspiration', element: <InspirationPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/trash', element: <TrashPage /> },
      { path: '/module-config', element: <ModuleConfigPage /> },
      { path: '/module-config/:moduleId', element: <ModuleConfigPage /> },
      { path: '/module-config/:moduleId/:itemId', element: <ModuleConfigPage /> },
      // ⚠️ catch-all 必须放最后：没有它，任何敲错的地址都会命中 React Router 的默认错误页
      // （英文「Unexpected Application Error! 404 Not Found」+ 连侧栏都没有），而不是应用内的 404
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}

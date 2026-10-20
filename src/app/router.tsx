import { useEffect } from 'react'
import { createBrowserRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom'
import AppLayout from './AppLayout'
import ErrorBoundary from './ErrorBoundary'
import DashboardPage from '@/modules/dashboard/DashboardPage'
import TodoPage from '@/modules/todo/TodoPage'
import FinancePage from '@/modules/finance/FinancePage'
import CrmPage from '@/modules/crm/CrmPage'
import CrmCanvasPage from '@/modules/crm/CrmCanvasPage'
import CustomerDetailPage from '@/modules/crm/CustomerDetailPage'
import CustomerTimelinePage from '@/modules/crm/CustomerTimelinePage'
import CustomerGraphPage from '@/modules/crm/CustomerGraphPage'
import AllTimelinesPage from '@/modules/crm/AllTimelinesPage'
import NotesPage from '@/modules/notes/NotesPage'
import NoteEditorPage from '@/modules/notes/NoteEditorPage'
import HabitsPage from '@/modules/habits/HabitsPage'
import TrophiesPage from '@/modules/trophies/TrophiesPage'
import ProfilePage from '@/modules/trophies/ProfilePage'
import SettingsPage from '@/modules/settings/SettingsPage'
import NotFoundPage from './NotFoundPage'
import ModuleConfigPage from '@/modules/moduleConfig/ModuleConfigPage'
import ProjectsPage from '@/modules/projects/ProjectsPage'
import ProjectDetailPage from '@/modules/projects/ProjectDetailPage'
import InspirationPage from '@/modules/inspiration/InspirationPage'

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
          <Outlet />
        </div>
      </ErrorBoundary>
    </AppLayout>
  )
}

const router = createBrowserRouter([
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
      { path: '/finance', element: <FinancePage /> },
      { path: '/notes', element: <NotesPage /> },
      { path: '/notes/:id', element: <NoteEditorPage /> },
      { path: '/habits', element: <HabitsPage /> },
      { path: '/trophies', element: <TrophiesPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/inspiration', element: <InspirationPage /> },
      { path: '/settings', element: <SettingsPage /> },
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

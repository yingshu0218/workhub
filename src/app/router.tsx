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
  return (
    <AppLayout>
      {/* 页面级错误边界：单模块崩溃只降级当前页，侧栏与全局能力不受影响；key 随路由重置错误态 */}
      <ErrorBoundary key={pathname}>
        <Outlet />
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

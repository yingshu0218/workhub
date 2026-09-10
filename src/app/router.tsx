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
import ModuleConfigPage from '@/modules/featureConfig/ModuleConfigPage'
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
      { path: '/feature-config', element: <ModuleConfigPage /> },
      { path: '/feature-config/:moduleId', element: <ModuleConfigPage /> },
      { path: '/feature-config/:moduleId/:itemId', element: <ModuleConfigPage /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}

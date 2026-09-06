import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom'
import AppLayout from './AppLayout'
import DashboardPage from '@/modules/dashboard/DashboardPage'
import TodoPage from '@/modules/todo/TodoPage'
import FinancePage from '@/modules/finance/FinancePage'
import CrmPage from '@/modules/crm/CrmPage'
import CrmCanvasPage from '@/modules/crm/CrmCanvasPage'
import CustomerDetailPage from '@/modules/crm/CustomerDetailPage'
import NotesPage from '@/modules/notes/NotesPage'
import NoteEditorPage from '@/modules/notes/NoteEditorPage'
import HabitsPage from '@/modules/habits/HabitsPage'
import TrophiesPage from '@/modules/trophies/TrophiesPage'
import ProfilePage from '@/modules/trophies/ProfilePage'
import PlaceholderPage from '@/modules/placeholder/PlaceholderPage'

/** 路由映射见 docs/寻鸽工作台-开发计划.md 第四节 */
function Shell() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  )
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/todo', element: <TodoPage /> },
      { path: '/crm', element: <CrmPage /> },
      { path: '/crm/canvas', element: <CrmCanvasPage /> },
      { path: '/crm/:id', element: <CustomerDetailPage /> },
      { path: '/finance', element: <FinancePage /> },
      { path: '/notes', element: <NotesPage /> },
      { path: '/notes/:id', element: <NoteEditorPage /> },
      { path: '/habits', element: <HabitsPage /> },
      { path: '/trophies', element: <TrophiesPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/inspiration', element: <PlaceholderPage title="灵感闪现" subtitle="规则引擎抽取下一件最值得推进的事" phase="Phase 6" icon="auto_awesome" /> },
      { path: '/settings', element: <PlaceholderPage title="系统设置" subtitle="外观 · 字体 · 快捷键 · 提醒 · 数据安全" phase="Phase 6" icon="settings" /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}

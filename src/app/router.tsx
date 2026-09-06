import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom'
import AppLayout from './AppLayout'
import DashboardPage from '@/modules/dashboard/DashboardPage'
import TodoPage from '@/modules/todo/TodoPage'
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
      { path: '/crm', element: <PlaceholderPage title="客户管理" subtitle="客户档案 · 智能管家 · 关系画布" phase="Phase 3" icon="group" /> },
      { path: '/crm/canvas', element: <PlaceholderPage title="客户关系画布" subtitle="力导向关系图" phase="Phase 3" icon="hub" /> },
      { path: '/finance', element: <PlaceholderPage title="财务中心" subtitle="多账本 · 流水 · 凭证溯源" phase="Phase 2" icon="account_balance_wallet" /> },
      { path: '/finance/new', element: <PlaceholderPage title="记一笔账" subtitle="新建交易" phase="Phase 2" icon="post_add" /> },
      { path: '/notes', element: <PlaceholderPage title="团队笔记" subtitle="Markdown 双栏 · @提及 · 双向链接" phase="Phase 4" icon="description" /> },
      { path: '/habits', element: <PlaceholderPage title="打卡习惯" subtitle="21 天稳态 · 热力图 · 连击" phase="Phase 5" icon="local_fire_department" /> },
      { path: '/trophies', element: <PlaceholderPage title="成就奖杯" subtitle="EXP 等级 · 奖杯墙 · 解锁弹窗" phase="Phase 5" icon="emoji_events" /> },
      { path: '/profile', element: <PlaceholderPage title="个人主页" subtitle="等级 · 成就 · 统计" phase="Phase 5" icon="person" /> },
      { path: '/inspiration', element: <PlaceholderPage title="灵感闪现" subtitle="规则引擎抽取下一件最值得推进的事" phase="Phase 6" icon="auto_awesome" /> },
      { path: '/settings', element: <PlaceholderPage title="系统设置" subtitle="外观 · 字体 · 快捷键 · 提醒 · 数据安全" phase="Phase 6" icon="settings" /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}

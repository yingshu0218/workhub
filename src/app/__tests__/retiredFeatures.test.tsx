// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { createMemoryRouter } from 'react-router-dom'

const state = vi.hoisted(() => ({ router: undefined as ReturnType<typeof createMemoryRouter> | undefined }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    createBrowserRouter: (routes: Parameters<typeof actual.createBrowserRouter>[0]) => {
      state.router = actual.createMemoryRouter(routes)
      return state.router
    },
  }
})
vi.mock('@/modules/dashboard/DashboardPage', () => ({ default: () => <h1>工作台测试页</h1> }))

import AppRouter from '../router'

// jsdom 没有布局滚动 API，路由保留真实应用壳时须提供浏览器能力桩。
beforeAll(() => { Element.prototype.scrollTo = vi.fn() })
afterEach(cleanup)
afterAll(() => state.router?.dispose())

async function navigate(path: string) {
  await act(() => state.router!.navigate(path))
}

describe('退役页面的入口与旧链接', () => {
  it.each(['/habits', '/habits/old?focus=legacy#today', '/trophies', '/trophies/old'])('%s 安全替换为工作台', async (path) => {
    render(<AppRouter />)
    await navigate(path)
    await waitFor(() => expect(state.router!.state.location.pathname).toBe('/'))
    expect(state.router!.state.historyAction).toBe('REPLACE')
    expect(state.router!.state.location.search).toBe('')
    expect(screen.getByRole('heading', { name: '工作台测试页' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: '打卡习惯' })).toBeNull()
    expect(screen.queryByRole('link', { name: '成就奖杯' })).toBeNull()
  })

  it('更多菜单仍可进入账号偏好，页面只保留身份与设置入口', async () => {
    render(<AppRouter />)
    await navigate('/more')
    const profileLink = await screen.findByRole('link', { name: '账号偏好' })
    expect(screen.queryByRole('link', { name: '习惯' })).toBeNull()
    expect(screen.queryByRole('link', { name: '奖杯' })).toBeNull()
    fireEvent.click(profileLink)
    expect(await screen.findByRole('heading', { name: '账号偏好' })).toBeTruthy()
    expect(within(screen.getByRole('main')).getByRole('link', { name: /系统设置/ }).getAttribute('href')).toBe('/settings')
    expect(screen.queryByText(/累计 EXP|奖杯收集|最长连续打卡/)).toBeNull()
  })

  it('单工作区的账号按钮可直达账号偏好', async () => {
    render(<AppRouter />)
    await navigate('/')
    fireEvent.click(screen.getByTitle('账号偏好设置'))
    await waitFor(() => expect(state.router!.state.location.pathname).toBe('/profile'))
    expect(await screen.findByRole('heading', { name: '账号偏好' })).toBeTruthy()
  })
})

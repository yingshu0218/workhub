// @vitest-environment jsdom
/**
 * `/authorize` 设备授权页回归。
 *
 * 这是「一条命令 + 浏览器点授权」的落点：页面只提交 user_code 与站点登录态，
 * 长期 token 不进页面（由 CLI 轮询拿走）。锁两件事：
 *   1. 授权码从 URL 带入并原样提交给 `/relay/device/approve`；
 *   2. 没有站点登录态时明确拒绝，绝不发请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AuthorizePage from '../AuthorizePage'

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/authorize" element={<AuthorizePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AuthorizePage', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('用当前登录账户批准授权码（只提交 user_code）', async () => {
    localStorage.setItem('workhub.auth.token', 'pb-session-1')
    localStorage.setItem('workhub.auth.identity', 'alice')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: 'approved' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderAt('/authorize?user_code=K7M2-QP4X')

    // 当前账户必须显示出来（用户要确认「用哪个账户授权」）
    expect(screen.getByText('alice')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '授权' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/relay\/device\/approve$/)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pb-session-1')
    expect(JSON.parse(String(init?.body))).toEqual({ user_code: 'K7M2-QP4X' })
    await waitFor(() => expect(document.body.textContent).toContain('已授权'))
  })

  it('没有站点登录态时不发请求，明确提示不可用', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderAt('/authorize?user_code=K7M2-QP4X')
    await userEvent.click(screen.getByRole('button', { name: '授权' }))

    await waitFor(() => expect(screen.getByText(/未启用登录/)).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('服务端拒绝时显示服务端原话（不吞错）', async () => {
    localStorage.setItem('workhub.auth.token', 'pb-session-1')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: '授权码不存在或已过期' }),
      }),
    )

    renderAt('/authorize?user_code=ZZZZ-ZZZZ')
    await userEvent.click(screen.getByRole('button', { name: '授权' }))

    await waitFor(() => expect(screen.getByText('授权码不存在或已过期')).toBeTruthy())
  })
})

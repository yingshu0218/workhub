// @vitest-environment jsdom
/**
 * 登录守卫的行为锁（2026-10-28）
 *
 * 锁三条判据（都是「错了会静默出事」的那类）：
 *  1. 服务端说未启用 → **必须放行**。强制登录 = 配错 env 就把唯一管理员锁在门外；
 *  2. 启用且无 token → 必须出现登录页，且**不渲染子节点**（不能先闪一下业务页面）；
 *  3. 启用且 token 有效（auth-refresh 200）→ 直接进业务页面。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate, clearAuth } from '../AuthGate'

function stubFetch(routes: Record<string, { status: number; body: unknown }>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const hit = Object.entries(routes).find(([k]) => url.includes(k))
    const r = hit?.[1] ?? { status: 404, body: {} }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('AuthGate', () => {
  beforeEach(() => {
    clearAuth()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('服务端未启用登录：直接放行（fail-open，不能把人锁在门外）', async () => {
    stubFetch({ '/relay/auth-status': { status: 200, body: { enabled: false } } })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText('业务页面')).toBeTruthy())
  })

  it('启用且无 token：显示登录页，且不渲染业务内容', async () => {
    stubFetch({ '/relay/auth-status': { status: 200, body: { enabled: true } } })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText(/请使用管理员账号登录/)).toBeTruthy())
    expect(screen.queryByText('业务页面')).toBeNull()
  })

  it('启用且有有效 token：auth-refresh 通过即进业务页面', async () => {
    localStorage.setItem('workhub.auth.token', 'valid-token')
    stubFetch({
      '/relay/auth-status': { status: 200, body: { enabled: true } },
      '/api/collections/users/auth-refresh': { status: 200, body: { token: 'renewed' } },
    })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText('业务页面')).toBeTruthy())
    // 续期后的 token 必须写回，否则过期那一刻会突然被踢出去
    expect(localStorage.getItem('workhub.auth.token')).toBe('renewed')
  })

  it('启用但 token 已失效：回到登录页（不信任本地残留 token）', async () => {
    localStorage.setItem('workhub.auth.token', 'stale-token')
    stubFetch({
      '/relay/auth-status': { status: 200, body: { enabled: true } },
      '/api/collections/users/auth-refresh': { status: 401, body: { message: 'expired' } },
    })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText(/请使用管理员账号登录/)).toBeTruthy())
  })
})

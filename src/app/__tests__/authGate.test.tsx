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
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate, clearAuth } from '../AuthGate'

function stubFetch(routes: Record<string, { status: number; body: unknown }>) {
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
      '/relay/auth-status': { status: 200, body: { enabled: true, initialized: true } },
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
      '/relay/auth-status': { status: 200, body: { enabled: true, initialized: true } },
      '/api/collections/users/auth-refresh': { status: 401, body: { message: 'expired' } },
    })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText(/请使用管理员账号登录/)).toBeTruthy())
  })

  it('初始密码还没换掉（initialized:false）：已登录也必须先改密，进不了业务页面', async () => {
    localStorage.setItem('workhub.auth.token', 'valid-token')
    stubFetch({
      '/relay/auth-status': { status: 200, body: { enabled: true, initialized: false } },
      '/api/collections/users/auth-refresh': { status: 200, body: { token: 'valid-token' } },
    })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText('设置你的密码')).toBeTruthy())
    expect(screen.queryByText('业务页面')).toBeNull()
  })

  it('首启（needsSetup:true）：显示初始化引导，不出现登录表单与业务内容', async () => {
    stubFetch({ '/setup/status': { status: 200, body: { needsSetup: true } } })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText('初始化工作台')).toBeTruthy())
    expect(screen.getByText('这是第一次启动，请设置你的账号')).toBeTruthy()
    expect(screen.queryByText(/请使用管理员账号登录/)).toBeNull()
    expect(screen.queryByText('业务页面')).toBeNull()
  })

  it('首启：两次密码不一致就地报错，且不提交创建请求', async () => {
    const fetchFn = stubFetch({ '/setup/status': { status: 200, body: { needsSetup: true } } })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText('初始化工作台')).toBeTruthy())

    await userEvent.type(screen.getByLabelText('用户名'), 'alice')
    await userEvent.type(screen.getByLabelText('密码（至少 8 位）'), 'password1')
    await userEvent.type(screen.getByLabelText('确认密码'), 'password2')
    await userEvent.click(screen.getByRole('button', { name: '创建并进入' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('两次输入的密码不一致'))
    expect(fetchFn.mock.calls.some(([url]) => String(url).includes('/setup/user'))).toBe(false)
    expect(screen.queryByText('业务页面')).toBeNull()
  })

  it('首启：创建成功后用新账号登录并直接进入应用', async () => {
    const fetchFn = stubFetch({
      '/setup/status': { status: 200, body: { needsSetup: true } },
      '/setup/user': { status: 200, body: { ok: true } },
      '/api/collections/users/auth-with-password': { status: 200, body: { token: 'fresh-token', record: { id: 'u1' } } },
    })
    render(
      <AuthGate>
        <div>业务页面</div>
      </AuthGate>,
    )
    await waitFor(() => expect(screen.getByText('初始化工作台')).toBeTruthy())

    await userEvent.type(screen.getByLabelText('用户名'), 'Alice')
    await userEvent.type(screen.getByLabelText('密码（至少 8 位）'), 'password1')
    await userEvent.type(screen.getByLabelText('确认密码'), 'password1')
    await userEvent.click(screen.getByRole('button', { name: '创建并进入' }))

    await waitFor(() => expect(screen.getByText('业务页面')).toBeTruthy())
    expect(localStorage.getItem('workhub.auth.token')).toBe('fresh-token')
    expect(localStorage.getItem('workhub.auth.identity')).toBe('Alice')
    // ⚠️ /setup/user 必须收到**原始用户名**：后端会校验「不能含 @」再自己拼占位邮箱。
    // 这条断言不能省 —— 曾经误传 toIdentity(user) 时，下面的登录断言照样是全绿的。
    const setupCall = fetchFn.mock.calls.find(([url]) => String(url).includes('/setup/user'))
    expect(JSON.parse(String(setupCall?.[1]?.body))).toEqual({ identity: 'Alice', password: 'password1' })
    const loginCall = fetchFn.mock.calls.find(([url]) => String(url).includes('auth-with-password'))
    // 用户名在登录时被映射成 <用户名>@workhub.local：PB 的 auth 标识仍是 email，
    // 用户侧无感（只填 gundam23 这类用户名即可）。占位邮箱统一小写，
    // 否则注册 Alice、登录 alice 会认证失败（PB 0.40 不归一化邮箱大小写）。
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      identity: 'alice@workhub.local',
      password: 'password1',
    })
  })
})

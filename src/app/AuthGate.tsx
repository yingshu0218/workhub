import { useCallback, useEffect, useState, type ReactNode } from 'react'

/**
 * 登录守卫 + 强制首改（2026-10-28 第 1 步）。
 *
 * 为什么需要它：在此之前页面**完全匿名**——任何人打开就能读写这台浏览器里的数据，
 * 而「同步身份」藏在设置里一个没人知道的账号上。于是既谈不上访问控制，也没法让
 * 「换台设备」变成一件正常的事（登录即可）。
 *
 * 四条设计约束（改动前先看）：
 * 1. **fail-open**：`/relay/auth-status` 说未启用（容器没配管理员），就不挡 —— 配错 env
 *    时强制登录会把唯一的管理员锁在门外，而且没有自救入口。
 * 2. **服务端是唯一判据**：本地只缓存 token；每次启动都向 PB 做一次 `auth-refresh`，
 *    过期/被删立刻回登录页，不做「本地有 token 就当已登录」的乐观判断。
 * 3. **强制首改**：初始密码是 compose 里的默认值 `password`（公开可知），所以
 *    `initialized:false` 时必须先改密；改完回调 `/relay/admin-initialized` 落盘标记。
 *    注意这是**体验层**的强制 —— 真正的安全来自「改完之后初始密码就登不进来了」。
 * 4. 不碰业务数据：本组件只做「挡住/放行」，不读也不写任何业务表。
 */

const TOKEN_KEY = 'workhub.auth.token'
const IDENTITY_KEY = 'workhub.auth.identity'
const USERID_KEY = 'workhub.auth.userid'

/** 供后续步骤（同步身份、relay 自动配对）复用 */
export function getAuthToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(IDENTITY_KEY)
    localStorage.removeItem(USERID_KEY)
  } catch {
    /* 隐私模式下 localStorage 不可用时静默 */
  }
}

async function refreshToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('/api/collections/users/auth-refresh', {
      method: 'POST',
      headers: { Authorization: token },
    })
    if (!res.ok) return false
    const body = (await res.json()) as { token?: string }
    // 续期后的 token 写回（PB 每次 refresh 会签发新 token，沿用旧的会在过期后突然失效）
    if (body?.token) localStorage.setItem(TOKEN_KEY, body.token)
    return true
  } catch {
    return false
  }
}

type Phase = 'checking' | 'open' | 'login' | 'change'

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let enabled = false
      let initialized = true
      try {
        const res = await fetch('/relay/auth-status', { cache: 'no-store' })
        const body = (await res.json()) as { enabled?: boolean; initialized?: boolean }
        enabled = Boolean(body?.enabled)
        initialized = body?.initialized !== false
      } catch {
        // 拿不到状态时按「未启用」处理：宁可先不挡，也不能把用户关在门外
        enabled = false
      }
      if (cancelled) return
      if (!enabled) {
        setPhase('open')
        return
      }
      const token = getAuthToken()
      if (token && (await refreshToken(token))) {
        if (cancelled) return
        // 已登录但还没改过初始密码 → 仍然先改密
        setPhase(initialized ? 'open' : 'change')
        return
      }
      if (!cancelled) setPhase('login')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const submitLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (busy) return
      setError('')
      setBusy(true)
      try {
        const res = await fetch('/api/collections/users/auth-with-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ identity: identity.trim(), password }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          token?: string
          record?: { id?: string }
          message?: string
        }
        if (!res.ok || !body.token) {
          throw new Error(body.message || `登录失败（HTTP ${res.status}）`)
        }
        localStorage.setItem(TOKEN_KEY, body.token)
        localStorage.setItem(IDENTITY_KEY, identity.trim())
        if (body.record?.id) localStorage.setItem(USERID_KEY, body.record.id)

        // 初始密码还没被替换掉 → 强制先改密（初始值是 compose 默认值，公开可知）
        const st = (await fetch('/relay/auth-status', { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => ({ initialized: true }))) as { initialized?: boolean }
        setPhase(st?.initialized === false ? 'change' : 'open')
        if (st?.initialized !== false) setPassword('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, identity, password],
  )

  const submitChange = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (busy) return
      setError('')
      if (newPw.length < 8) {
        setError('新密码至少 8 位')
        return
      }
      if (newPw !== confirmPw) {
        setError('两次输入的新密码不一致')
        return
      }
      if (newPw === password) {
        setError('新密码不能与当前密码相同')
        return
      }
      setBusy(true)
      try {
        const token = getAuthToken()
        const userId = localStorage.getItem(USERID_KEY) ?? ''
        if (!token || !userId) throw new Error('登录态已失效，请重新登录')
        const res = await fetch(`/api/collections/users/records/${userId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', Authorization: token },
          body: JSON.stringify({ oldPassword: password, password: newPw, passwordConfirm: newPw }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { message?: string }
          throw new Error(b.message || `修改密码失败（HTTP ${res.status}）`)
        }
        // 密码已经换掉，初始密码自此失效；再落标记让下次不再要求改密
        await fetch('/relay/admin-initialized', {
          method: 'POST',
          headers: { Authorization: token },
        }).catch(() => undefined)
        setPassword('')
        setNewPw('')
        setConfirmPw('')
        setPhase('open')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, confirmPw, newPw, password],
  )

  const box = 'w-full max-w-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-6'
  const label = 'mt-3 block text-[0.8214rem] font-medium text-on-surface-variant'
  const input =
    'mt-1 w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[0.9286rem] text-on-surface'
  const primary =
    'mt-4 w-full rounded-lg bg-primary px-4 py-2 text-[0.9286rem] font-medium text-on-primary disabled:opacity-50'

  if (phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-on-surface-variant">
        <span className="text-[0.9286rem]">正在检查登录状态…</span>
      </div>
    )
  }

  if (phase === 'login') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <form onSubmit={submitLogin} className={box}>
          <h1 className="text-[1.1429rem] font-semibold text-on-surface">寻鸽工作台</h1>
          <p className="mt-1 text-[0.8214rem] text-on-surface-variant">请使用管理员账号登录</p>

          <label className={label}>
            用户名或邮箱
            <input
              className={input}
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className={label}>
            密码
            <input
              type="password"
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && <p className="mt-3 text-[0.8214rem] text-error">{error}</p>}

          <button type="submit" disabled={busy || !identity.trim() || !password} className={primary}>
            {busy ? '登录中…' : '登录'}
          </button>

          <p className="mt-3 text-[0.7857rem] leading-relaxed text-outline">
            账号由容器启动时创建（<code>WORKHUB_ADMIN_USER</code> / <code>WORKHUB_ADMIN_PASSWORD</code>），
            页面不提供自助注册。
          </p>
        </form>
      </div>
    )
  }

  if (phase === 'change') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <form onSubmit={submitChange} className={box}>
          <h1 className="text-[1.1429rem] font-semibold text-on-surface">设置你的密码</h1>
          <p className="mt-1 text-[0.8214rem] text-on-surface-variant">
            初始密码是公开的默认值，必须换掉后才能进入工作台。改完即失效。
          </p>

          <label className={label}>
            当前密码
            <input
              type="password"
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </label>
          <label className={label}>
            新密码（至少 8 位）
            <input
              type="password"
              className={input}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className={label}>
            确认新密码
            <input
              type="password"
              className={input}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          {error && <p className="mt-3 text-[0.8214rem] text-error">{error}</p>}

          <button type="submit" disabled={busy || !password || !newPw || !confirmPw} className={primary}>
            {busy ? '提交中…' : '设置并进入'}
          </button>
        </form>
      </div>
    )
  }

  return <>{children}</>
}

import { useCallback, useEffect, useState, type ReactNode } from 'react'

/**
 * 登录守卫（2026-10-28 第 1 步）。
 *
 * 为什么需要它：在此之前页面**完全匿名**——任何人打开就能读写这台浏览器里的数据，
 * 而「同步身份」藏在设置里一个没人知道的账号上。于是既谈不上访问控制，也没法让
 * 「换台设备」变成一件正常的事（登录即可）。
 *
 * 三条设计约束（改动前先看）：
 * 1. **fail-open**：`/relay/auth-status` 说未启用（容器没配管理员），就不挡 —— 配错 env
 *    时强制登录会把唯一的管理员锁在门外，而且没有自救入口。
 * 2. **服务端是唯一判据**：本地只缓存 token；每次启动都向 PB 做一次 `auth-refresh`，
 *    过期/被删立刻回登录页，不做「本地有 token 就当已登录」的乐观判断。
 * 3. 不碰业务数据：本组件只做「挡住/放行」，不读也不写任何业务表。
 */

const TOKEN_KEY = 'workhub.auth.token'
const IDENTITY_KEY = 'workhub.auth.identity'

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

type Phase = 'checking' | 'open' | 'login'

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let enabled = false
      try {
        const res = await fetch('/relay/auth-status', { cache: 'no-store' })
        enabled = Boolean(((await res.json()) as { enabled?: boolean })?.enabled)
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
        if (!cancelled) setPhase('open')
        return
      }
      if (!cancelled) setPhase('login')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const submit = useCallback(
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
        const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string }
        if (!res.ok || !body.token) {
          throw new Error(body.message || `登录失败（HTTP ${res.status}）`)
        }
        localStorage.setItem(TOKEN_KEY, body.token)
        localStorage.setItem(IDENTITY_KEY, identity.trim())
        setPassword('')
        setPhase('open')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, identity, password],
  )

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
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-6"
        >
          <h1 className="text-[1.1429rem] font-semibold text-on-surface">寻鸽工作台</h1>
          <p className="mt-1 text-[0.8214rem] text-on-surface-variant">请使用管理员账号登录</p>

          <label className="mt-4 block text-[0.8214rem] font-medium text-on-surface-variant">
            用户名或邮箱
            <input
              className="mt-1 w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[0.9286rem] text-on-surface"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="mt-3 block text-[0.8214rem] font-medium text-on-surface-variant">
            密码
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[0.9286rem] text-on-surface"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && <p className="mt-3 text-[0.8214rem] text-error">{error}</p>}

          <button
            type="submit"
            disabled={busy || !identity.trim() || !password}
            className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-[0.9286rem] font-medium text-on-primary disabled:opacity-50"
          >
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

  return <>{children}</>
}

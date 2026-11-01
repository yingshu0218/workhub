import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Card } from '@/design-system/ui'

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
 *
 * 2026-11-01 补「首启引导」：`users` 为空时后端 `/setup/status` 回 `needsSetup:true`，
 * 这里改成初始化表单（用户名 / 密码 / 确认），建号后直接用该账号登录 —— 取代了原先
 * 「账号由容器按 env 写死创建」的唯一入口。判据在服务端（空库），前端只是按结果分支，
 * 所以不存在「页面自己决定要不要初始化」的两份实现。
 */

const TOKEN_KEY = 'workhub.auth.token'
const IDENTITY_KEY = 'workhub.auth.identity'
const USERID_KEY = 'workhub.auth.userid'

/** 供后续步骤（同步身份、relay 自动配对）复用 */
/**
 * 登录标识归一化：用户只填「用户名」（如 gundam23）也能登录。
 * PB 的 auth 集合标识仍是 email（0.40 无法给 text 字段加 UNIQUE，
 * 所以 identityFields 里不能放 username），建号时邮箱就是 <用户名>@workhub.local。
 * 含 @ 的原样返回，兼容直接用邮箱登录。
 */
function toIdentity(raw: string): string {
  const v = raw.trim()
  return v.includes('@') ? v : `${v}@workhub.local`
}

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

type Phase = 'checking' | 'open' | 'login' | 'change' | 'setup'

/** 与服务端 `scripts/setupRoutes.mjs#parseSetupInput` 同口径（客户端先拦，省一次往返） */
const IDENTITY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 初始化引导用独立状态：它与登录表单不是同一件事，共用 state 会让「切到登录页」时残留半截密码
  const [setupIdentity, setSetupIdentity] = useState('')
  const [setupPw, setSetupPw] = useState('')
  const [setupConfirm, setSetupConfirm] = useState('')
  const [setupError, setSetupError] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 首启引导优先于一切：空库时登录页毫无意义（没有任何账号可登）。
      // 走 env 建号的部署在 entrypoint 阶段就先建好了账号，所以这里只在真正空库时命中。
      try {
        const res = await fetch('/setup/status', { cache: 'no-store' })
        const body = (await res.json()) as { needsSetup?: boolean }
        if (body?.needsSetup) {
          if (!cancelled) setPhase('setup')
          return
        }
      } catch {
        // 旧版 serve.mjs 没有这个端点（404）→ 按普通流程继续
      }
      if (cancelled) return

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
          body: JSON.stringify({ identity: toIdentity(identity), password }),
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

  /**
   * 首启初始化：建号 → 直接用新账号登录 → 进应用。
   *
   * 为什么要「建完立刻登录」而不是回登录页让用户再输一遍：这是首次启动，
   * 用户刚把账号密码定下来，再让他抄一遍纯属折腾；而失败路径（409 = 已被初始化）
   * 会切回登录页并说明原因，不会让人卡在一个永远失败的按钮上。
   */
  const submitSetup = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (setupBusy) return
      setSetupError('')
      const user = setupIdentity.trim()
      if (user.length < 3 || user.length > 32) {
        setSetupError('用户名需 3–32 位')
        return
      }
      if (!IDENTITY_PATTERN.test(user)) {
        setSetupError('用户名只能用字母、数字、下划线、点、横线，且不能以点或横线开头')
        return
      }
      if (setupPw.length < 8) {
        setSetupError('密码至少 8 位')
        return
      }
      if (setupPw !== setupConfirm) {
        setSetupError('两次输入的密码不一致')
        return
      }
      setSetupBusy(true)
      try {
        const res = await fetch('/setup/user', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // ⚠️ 这里必须传**原始用户名**：后端 parseSetupInput 会校验「不能含 @」并自行拼
          // `<用户名>@workhub.local` 作为 PB 的 email。传 toIdentity(user) 会被判非法。
          body: JSON.stringify({ identity: user, password: setupPw }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean }
        if (!res.ok) {
          if (res.status === 409) {
            // 别人先初始化了：让位给登录页，别让用户对着一个必然失败的按钮反复点
            setIdentity(user)
            setError(body.error || '已完成初始化，请直接登录')
            setPhase('login')
            return
          }
          throw new Error(body.error || `创建账号失败（HTTP ${res.status}）`)
        }

        const login = await fetch('/api/collections/users/auth-with-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ identity: toIdentity(user), password: setupPw }),
        })
        const auth = (await login.json().catch(() => ({}))) as {
          token?: string
          record?: { id?: string }
          message?: string
        }
        if (!login.ok || !auth.token) {
          throw new Error(auth.message || `账号已创建，但自动登录失败（HTTP ${login.status}），请到登录页手动登录`)
        }
        localStorage.setItem(TOKEN_KEY, auth.token)
        localStorage.setItem(IDENTITY_KEY, user)
        if (auth.record?.id) localStorage.setItem(USERID_KEY, auth.record.id)
        setSetupPw('')
        setSetupConfirm('')
        setPhase('open')
      } catch (err) {
        setSetupError(err instanceof Error ? err.message : String(err))
      } finally {
        setSetupBusy(false)
      }
    },
    [setupBusy, setupConfirm, setupIdentity, setupPw],
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

  if (phase === 'setup') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <Card className="w-full max-w-sm p-6">
          <form onSubmit={submitSetup}>
            <h1 className="text-[1.1429rem] font-semibold text-on-surface">初始化工作台</h1>
            <p className="mt-1 text-[0.8214rem] text-on-surface-variant">这是第一次启动，请设置你的账号</p>

            <label className={label}>
              用户名
              <input
                className={input}
                value={setupIdentity}
                onChange={(e) => setSetupIdentity(e.target.value)}
                autoComplete="username"
                autoFocus
                placeholder="3–32 位，字母/数字/下划线/点/横线"
              />
            </label>
            <label className={label}>
              密码（至少 8 位）
              <input
                type="password"
                className={input}
                value={setupPw}
                onChange={(e) => setSetupPw(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className={label}>
              确认密码
              <input
                type="password"
                className={input}
                value={setupConfirm}
                onChange={(e) => setSetupConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </label>

            {setupError && (
              <p role="alert" className="mt-3 text-[0.8214rem] text-error">
                {setupError}
              </p>
            )}

            {/* 与登录 / 改密表单保持同一写法：原生 <button type="submit">。
                设计系统的 Button 不透传 type —— HTML 缺省虽然是 submit，但提交意图只能靠默认值；
                这里显式声明，避免日后给 Button 补默认 type="button" 时静默失效。 */}
            <button type="submit" className={primary} disabled={setupBusy || !setupIdentity.trim() || !setupPw || !setupConfirm}>
              {setupBusy ? '创建中…' : '创建并进入'}
            </button>
          </form>
        </Card>
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

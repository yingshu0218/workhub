import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Card, inputCls } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import { clearAuthSession, getAuthIdentity, getAuthToken } from '@/shared/authToken'
import { resolveBridgeBase } from '@/agent/bridge'

/**
 * 设备授权确认页（`/authorize?user_code=XXXX-XXXX`）。
 *
 * 这是「一条命令 + 浏览器点授权」的第二种接入方式：
 * CLI 跑 `npm run agent:setup -- --url … --login` 后打开本页，用户确认后 CLI 才拿得到 token。
 *
 * 三条边界：
 * 1. **必须已登录**：页面本身在 AuthGate 之内；提交时再带 PocketBase users token，
 *    服务端（`authorizeMint`）会二次校验 —— 不能只靠前端「看起来已登录」。
 * 2. **只传用户码**：device_code 只在 CLI 手里，网页永远看不到它，泄露面更小。
 * 3. **token 不经过本页**：批准只改服务端状态，token 由 CLI 轮询拿走并写进
 *    `~/.workhub/relay.json`；页面不会显示、也不会保存长期 token。
 */

function relayHttpBase(): string {
  // 与设置页同口径：默认同源 `/relay`；ws(s) → http(s) 才能发普通请求
  return resolveBridgeBase('').replace(/^ws(s?):/, 'http$1:')
}

export default function AuthorizePage() {
  const [params] = useSearchParams()
  const [code, setCode] = useState(params.get('user_code') ?? params.get('code') ?? '')
  const [state, setState] = useState<{ busy: boolean; ok: string; error: string }>({
    busy: false,
    ok: '',
    error: '',
  })
  const identity = getAuthIdentity()
  const token = getAuthToken()

  const approve = async () => {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) {
      setState({ busy: false, ok: '', error: '请先填入授权码' })
      return
    }
    if (!token) {
      setState({ busy: false, ok: '', error: '当前部署未启用登录，页面授权不可用' })
      return
    }
    setState({ busy: true, ok: '', error: '' })
    try {
      const res = await fetch(`${relayHttpBase()}/device/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_code: trimmed }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `授权失败（HTTP ${res.status}）`)
      setState({ busy: false, ok: '已授权。请回到终端继续，页面可以关闭了。', error: '' })
    } catch (e) {
      setState({ busy: false, ok: '', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const switchAccount = () => {
    // 清掉本地登录态后整页重载：AuthGate 会回到登录页，URL 上的 user_code 保留
    clearAuthSession()
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-container p-4">
      <Card className="w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="verified_user" size={20} />
          </div>
          <div>
            <h1 className="text-[1.1429rem] font-semibold">授权设备接入</h1>
            <p className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
              某台设备正在请求访问「寻鸽工作台」的 MCP 工具
            </p>
          </div>
        </div>

        <label className="block">
          <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">授权码</div>
          <input
            className={`${inputCls} font-mono uppercase tracking-wider`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void approve()
            }}
            placeholder="XXXX-XXXX"
          />
        </label>

        <div className="mt-3 rounded-lg bg-surface-container-low px-3 py-2 text-[0.8214rem] text-on-surface-variant">
          当前账户：
          <span className="ml-1 font-medium text-on-surface">{identity || '未登录'}</span>
        </div>

        {state.error && <p className="mt-3 text-[0.8214rem] text-error">{state.error}</p>}
        {state.ok && <p className="mt-3 text-[0.8214rem] text-success">{state.ok}</p>}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button className="text-[0.8214rem] text-on-surface-variant underline" onClick={switchAccount}>
            换个账户
          </button>
          <Button onClick={() => void approve()} disabled={state.busy || Boolean(state.ok)}>
            {state.busy ? '授权中…' : state.ok ? '已授权' : '授权'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

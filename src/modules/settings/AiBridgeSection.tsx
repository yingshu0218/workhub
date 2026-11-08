import { useState, useEffect } from 'react'
import { Card, Button } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import type { Settings, AiDomain } from '@/db/types'
import { agentBridge, resolveBridgeBase, type BridgeStatus } from '@/agent/bridge'
import { getAuthToken } from '@/shared/authToken'

/**
 * AI Agent 桥配置区（能力白名单 + 接入凭据） —— 方案 §四.2 / §四.3（P1 第 4 步配套）
 *
 * 为什么必须在这里：外部 Agent 形态下，「能力白名单」与「接入 token」是硬边界而非可选项——
 * 没有它们，relay 与桥无法安全启用（无 token 谁都能连、无白名单等于全量暴露 18 张表）。
 *
 * 边界：本区只读写 settings `ai` 段（本地 singleton，**不进同步队列**）；
 * 不 import 任何 repositories 写函数，不直接操作数据。
 */

const DOMAIN_LABELS: Record<AiDomain, { label: string; desc: string }> = {
  fin: { label: '财务', desc: '记账、建账本' },
  crm: { label: 'CRM', desc: '建客户、沟通日志、客户关系' },
  todo: { label: '待办', desc: '建 / 改 / 删待办、完成待办' },
  project: { label: '项目', desc: '建项目、改项目（含归档 / 搁置）' },
  habit: { label: '习惯', desc: '打卡 / 取消打卡' },
  note: { label: '笔记', desc: '建 / 改笔记、建文件夹' },
  link: { label: '关联', desc: '原子间建联 / 解联（客户关系、流水关联等）' },
  read: { label: '读取', desc: '实体消解、搜索、列表查询' },
}

const DOMAIN_ORDER: AiDomain[] = ['fin', 'crm', 'todo', 'project', 'habit', 'note', 'read']

/**
 * ws(s)://host/relay → http(s)://host/relay。
 *
 * 配对码兑换走普通 HTTP（`POST /relay/pair`）而不是 WS：页面此刻还没有 token，连不上 WS。
 *
 * ⚠️ 这里原本有一个本地 `genToken()`，已删除（2026-10-28 线上事故根因）：
 * 页面自己随机生成的 token，relay 不认（它只认启动时环境变量/数据卷里那份），
 * 两边永远对不上 → 桥永久停在「连接中…」，Agent 侧只看到「未连接 relay」。
 * **token 只能由 relay 经配对码下发，页面不得自造。**
 */
function relayHttpBase(wsBase: string): string {
  return wsBase.replace(/^ws(s?):/, 'http$1:')
}

export function AiBridgeSection({
  settings,
  save,
}: {
  settings: Settings
  save: (patch: Partial<Omit<Settings, 'key'>>) => void
}) {
  const ai = settings.ai
  const domains: Partial<Record<AiDomain, boolean>> = ai.domains ?? {}
  const [status, setStatus] = useState<BridgeStatus>(() => agentBridge.getStatus())
  const [copied, setCopied] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [copiedConfig, setCopiedConfig] = useState(false)
  /** 配对码兑换状态 —— 页面拿到 relay token 的唯一入口 */
  const [pairCode, setPairCode] = useState('')
  const [pairState, setPairState] = useState<{ busy: boolean; error: string; ok: string }>({
    busy: false,
    error: '',
    ok: '',
  })
  /** 本页签发给 Agent / 第二台设备的一次性配对码（5 分钟有效） */
  const [issued, setIssued] = useState<{ code: string; minutes: number } | null>(null)
  const [issueBusy, setIssueBusy] = useState(false)
  /** 桥实际连出的 relay 基址（留空 = 当前站点同源 /relay，与实际连接口径同源，不另算一份） */
  const bridgeBase = resolveBridgeBase(ai.bridgeUrl)

  useEffect(() => agentBridge.onStatus(setStatus), [])

  /**
   * 给外部 Agent 的「一条命令」接入（Issue #154）。
   *
   * 2026-11-08 起主路径是 `--login`（设备授权）：命令只带站点地址，跑起来会打印并打开
   * `/authorize` 页面，用户用站点账号点「授权」后，CLI 自己在后台轮询拿到 token 并写入
   * `~/.workhub/relay.json` —— 终端与可复制的文本里都不出现长期 token。
   */
  const agentSetupCmd = `npm run agent:setup -- --url ${bridgeBase} --login`
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        workhub: {
          command: 'node',
          args: [
            '<项目路径>/relay/mcp-stdio-shim.mjs',
            '--url',
            bridgeBase,
            '--token',
            ai.bridgeToken ?? '',
          ],
        },
      },
    },
    null,
    2,
  )

  const setDomain = (d: AiDomain, on: boolean) => save({ ai: { ...ai, domains: { ...domains, [d]: on } } })

  const toggleBridge = (on: boolean) => {
    // 只切开关：**不再顺带造 token**。没有 token 时桥必然连不上，由上面的配对区引导去配对
    // （历史教训：这里原来是 `ai.bridgeToken || genToken()`，正是 token 对不上那类故障的源头）。
    save({ ai: { ...ai, bridgeEnabled: on } })
    if (on && ai.bridgeToken) {
      agentBridge.connect({ url: ai.bridgeUrl ?? '', token: ai.bridgeToken })
    } else {
      agentBridge.disconnect()
    }
  }

  /**
   * 用配对码换 relay 的接入 token。
   *
   * 校验全在服务端（一次性、5 分钟、按 IP 限流），兑换回来的就是 **relay 正在用的那串** token，
   * 所以页面与外部 Agent 天然一致 —— 这是删掉本地随机生成后要守住的不变式。
   */
  const redeemPair = async () => {
    const code = pairCode.trim().toUpperCase()
    if (!code) {
      setPairState({ busy: false, error: '请先填入配对码', ok: '' })
      return
    }
    setPairState({ busy: true, error: '', ok: '' })
    try {
      const res = await fetch(`${relayHttpBase(bridgeBase)}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
      if (!res.ok || !data.token) throw new Error(data.error || `配对失败（HTTP ${res.status}）`)
      save({ ai: { ...ai, bridgeEnabled: true, bridgeToken: data.token } })
      agentBridge.connect({ url: ai.bridgeUrl ?? '', token: data.token })
      setPairCode('')
      setPairState({ busy: false, error: '', ok: '配对成功，正在连接 relay…' })
    } catch (e) {
      setPairState({ busy: false, error: e instanceof Error ? e.message : String(e), ok: '' })
    }
  }

  /** 解绑：清掉本地 token（换设备/换环境时用），之后必须重新配对才连得上 */
  const clearToken = () => {
    save({ ai: { ...ai, bridgeEnabled: false, bridgeToken: undefined } })
    agentBridge.disconnect()
    setPairState({ busy: false, error: '', ok: '已清除本地 token，请用新的配对码重新配对' })
  }

  /**
   * 生成接入凭据（本页首次配对前也能用）。
   *
   * 两条路径刻意分开：
   * - **本页已有 relay token**：签一枚 5 分钟一次性码，给 Agent / 第二台设备兑换
   *   （长期 token 不出现在可复制的聊天文本里）。
   * - **本页还没有 token**：用**站点登录态**（PocketBase users token）签码，并立刻兑换成
   *   长期 token 填回本页 —— 这就是「在后台页面生成 token，再填进 MCP 客户端」的入口。
   *   ⚠️ token 仍由 relay 下发，页面**不自造**（2026-10-28 事故的硬约束，别改回去）。
   */
  const issueCode = async () => {
    const authToken = ai.bridgeToken || getAuthToken()
    if (!authToken) {
      setPairState({
        busy: false,
        error: '未登录或当前部署未启用登录，无法在页面生成；请用启动日志里的引导码首次配对',
        ok: '',
      })
      return
    }
    const firstTime = !ai.bridgeToken
    setIssueBusy(true)
    setPairState({ busy: false, error: '', ok: '' })
    try {
      const res = await fetch(`${relayHttpBase(bridgeBase)}/pair/new`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${authToken}` },
      })
      const data = (await res.json().catch(() => ({}))) as { code?: string; ttlSeconds?: number; error?: string }
      if (!res.ok || !data.code) throw new Error(data.error || `签发失败（HTTP ${res.status}）`)

      if (!firstTime) {
        setIssued({ code: data.code, minutes: Math.round((data.ttlSeconds ?? 300) / 60) })
        return
      }

      // 页面尚未配对：把刚签出的码立刻兑换成 relay 的长期 token，填回本页供复制到 MCP 客户端。
      // 码是一次性的，所以兑换后不会再显示（避免用户误以为还能给 Agent 用）。
      const redeemRes = await fetch(`${relayHttpBase(bridgeBase)}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: data.code }),
      })
      const redeemed = (await redeemRes.json().catch(() => ({}))) as { token?: string; error?: string }
      if (!redeemRes.ok || !redeemed.token) {
        throw new Error(redeemed.error || `兑换失败（HTTP ${redeemRes.status}）`)
      }
      save({ ai: { ...ai, bridgeEnabled: true, bridgeToken: redeemed.token } })
      agentBridge.connect({ url: ai.bridgeUrl ?? '', token: redeemed.token })
      setIssued(null)
      setPairState({
        busy: false,
        error: '',
        ok: '已生成接入 token，复制到 MCP 客户端的 Authorization: Bearer 即可',
      })
    } catch (e) {
      setPairState({ busy: false, error: e instanceof Error ? e.message : String(e), ok: '' })
    } finally {
      setIssueBusy(false)
    }
  }

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(ai.bridgeToken ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  const stateText: Record<BridgeStatus['state'], string> = {
    disabled: '未启用',
    connecting: '连接中…',
    connected: '已连接 relay',
    error: '连接失败',
  }
  const stateColor: Record<BridgeStatus['state'], string> = {
    disabled: 'text-outline',
    connecting: 'text-warning',
    connected: 'text-success',
    error: 'text-error',
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="smart_toy" size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-[1.0357rem] font-semibold">AI Agent 桥</h3>
            <p className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
              让外部 Agent（Claude Desktop / Cursor / CLI 等）经 relay 用标准 MCP 调用本应用的记账、CRM 等能力。
              relay 已内嵌在本项目（与站点同源），无需单独启动。
            </p>
          </div>
          <span className={`text-[0.8571rem] font-medium ${stateColor[status.state]}`}>{stateText[status.state]}</span>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/60 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[0.9286rem] font-medium">启用 AI 桥</div>
            <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
              关闭时桥不启动，Agent 无法连接；开启后本页会主动连出 relay（不开放入站端口）
            </div>
          </div>
          <button
            role="switch"
            aria-checked={ai.bridgeEnabled}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${ai.bridgeEnabled ? 'bg-primary' : 'bg-outline-variant'}`}
            onClick={() => toggleBridge(!ai.bridgeEnabled)}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${ai.bridgeEnabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        {ai.bridgeEnabled && (
          <div className="mt-3 space-y-3">
            <div>
              <div className="mb-1 text-[0.8214rem] font-medium text-on-surface-variant">relay 地址（留空即可）</div>
              <input
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.8571rem]"
                value={ai.bridgeUrl ?? ''}
                onChange={(e) => save({ ai: { ...ai, bridgeUrl: e.target.value } })}
                placeholder="留空 = 使用当前站点（同源 /relay）"
              />
              <p className="mt-1 text-[0.7857rem] text-outline">
                留空即用当前站点的 <code>/relay</code>（dev/生产都已内嵌，无需单独启动 relay）；
                仅当你把 relay 跑在别处时才需要填，如 <code>ws://127.0.0.1:8787</code>。
              </p>
            </div>
            <div>
              <div className="mb-1 text-[0.8214rem] font-medium text-on-surface-variant">
                配对 / 配对码
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.8571rem] uppercase tracking-wider"
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void redeemPair()
                  }}
                  placeholder="6 位一次性码"
                />
                <Button size="sm" variant="ghost" onClick={() => void redeemPair()}>
                  {pairState.busy ? '配对中…' : '配对'}
                </Button>
              </div>
              {pairState.error && <p className="mt-1 text-[0.7857rem] text-error">{pairState.error}</p>}
              {!pairState.error && pairState.ok && (
                <p className="mt-1 text-[0.7857rem] text-success">{pairState.ok}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => void issueCode()}>
                  {issueBusy ? '生成中…' : ai.bridgeToken ? '生成配对码' : '生成接入 token'}
                </Button>
                {issued && (
                  <span className="font-mono text-[0.9286rem] tracking-wider text-primary">
                    {issued.code}
                    <span className="ml-2 font-sans text-[0.7857rem] text-outline">
                      {issued.minutes} 分钟内有效
                    </span>
                  </span>
                )}
              </div>
              <p className="mt-1 text-[0.7857rem] text-outline">
                本页已登录时可直接「生成接入 token」——用登录态向 relay 换长期 token，<b>无需先配对</b>；
                再复制到 MCP 客户端的 <code>Authorization: Bearer</code>。已接入后同一按钮改为签发
                5 分钟一次性码，给 Agent 或第二台设备兑换。启动日志里的引导码仅作兜底。
              </p>
            </div>
            <div>
              <div className="mb-1 text-[0.8214rem] font-medium text-on-surface-variant">
                接入 token（仅存本地，不进同步）
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.8571rem]"
                  value={ai.bridgeToken ?? ''}
                  placeholder="配对成功后自动填入"
                />
                <Button size="sm" variant="ghost" icon="content_copy" onClick={copyToken}>
                  {copied ? '已复制' : '复制'}
                </Button>
                <Button size="sm" variant="ghost" icon="autorenew" onClick={clearToken}>
                  解绑
                </Button>
              </div>
              <p className="mt-1 text-[0.7857rem] text-outline">
                这串就是 relay 的接入 token：填进 MCP 客户端的 <code>Authorization: Bearer</code> 即可
                （也可以把配对码交给 Agent，让它自己换）。它由 relay 启动时从{' '}
                <code>WORKHUB_RELAY_TOKEN</code> 或数据卷读取，重建镜像不会变。
              </p>
            </div>
            {status.error && <p className="text-[0.8214rem] text-error">{status.error}</p>}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-[0.8214rem] font-medium text-on-surface-variant">
                  Agent 侧接入（复制即用）
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="content_copy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(agentSetupCmd)
                      setCopiedCmd(true)
                      setTimeout(() => setCopiedCmd(false), 1500)
                    } catch {
                      /* 剪贴板不可用时静默 */
                    }
                  }}
                >
                  {copiedCmd ? '已复制' : '复制命令'}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.7857rem] leading-relaxed">
                {agentSetupCmd}
              </pre>
              <p className="mt-1 text-[0.7857rem] text-outline">
                推荐用这条命令（在仓库根目录执行）：运行后会打印并打开<b>授权页</b>，
                用你当前的站点账号点「授权」即可；
                随后自动写入各 Agent 工具（Codex / Hermes / opencode / Claude Code / Cursor …）的配置，
                并把凭据集中存到 <code>~/.workhub/relay.json</code> ——
                token 因此不落进任何可入库的配置文件。跑完<b>重启 Agent 工具</b>即可。详见{' '}
                <code>docs/一键接入-Agent说明.md</code>。
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-[0.7857rem] text-on-surface-variant">
                  手动配置（不想跑脚本时）·{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={async (e) => {
                      e.preventDefault()
                      try {
                        await navigator.clipboard.writeText(mcpConfig)
                        setCopiedConfig(true)
                        setTimeout(() => setCopiedConfig(false), 1500)
                      } catch {
                        /* 剪贴板不可用时静默 */
                      }
                    }}
                  >
                    {copiedConfig ? '已复制' : '复制 JSON'}
                  </button>
                </summary>
                <pre className="mt-1 overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.7857rem] leading-relaxed">
                  {mcpConfig}
                </pre>
                <p className="mt-1 text-[0.7857rem] text-outline">
                  标准 MCP 只有 stdio / Streamable HTTP 两种传输，<b>没有「连裸 ws://」这条</b>，
                  所以 Agent 侧要用本项目的 stdio 桥（
                  <code>relay/mcp-stdio-shim.mjs</code>）把 JSON-RPC 帧搬到 relay：把{' '}
                  <code>&lt;项目路径&gt;</code> 换成实际路径后粘进 Agent 的 MCP 配置。
                  该配置含明文 token，<b>不要提交到仓库</b>。
                </p>
              </details>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="verified_user" size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-[1.0357rem] font-semibold">能力白名单</h3>
            <p className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
              关闭的域，Agent 的工具清单里直接不出现（不是调用时才拒绝）——任何 Agent 一视同仁
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {DOMAIN_ORDER.map((d) => {
            const on = domains[d] ?? true
            const meta = DOMAIN_LABELS[d]
            return (
              <label
                key={d}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-outline-variant/60 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-[0.9286rem] font-medium">{meta.label}</div>
                  <div className="mt-0.5 truncate text-[0.7857rem] text-on-surface-variant">{meta.desc}</div>
                </div>
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={on} onChange={(e) => setDomain(d, e.target.checked)} />
              </label>
            )
          })}
        </div>
        <p className="mt-3 text-[0.7857rem] text-outline">
          说明：中风险操作（记账、建客户、沟通日志等）即便在白名单内，Agent 也须先向你转述参数并取得确认，才能携带一次性 confirmToken 执行。
        </p>
      </Card>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { clientRequest } from '@/platform/request'
import { endpointBase, endpointFetch } from '@/platform/endpoint'
import { Button, Card, inputCls } from '@/design-system/ui'

type CredentialStatus = 'pending' | 'active' | 'expired' | 'stale' | 'revoked'
interface AgentCredential {
  id: string
  name: string
  capabilities: string[]
  createdAt: number
  revokedAt: number
  expiresAt: number
  pairExpiresAt: number
  pairedAt: number
  status: CredentialStatus
}
interface PairIssue {
  id: string
  code: string
  expiresAt: number
  name: string
}
interface AgentListResponse {
  items: AgentCredential[]
  truncated: boolean
  nextOffset: number | null
}

const DOMAIN_ROWS = [
  ['activity', '事件'],
  ['crm', '联系人'],
  ['project', '事项'],
  ['todo', '待办'],
  ['fin', '收支'],
  ['note', '笔记'],
  ['attachment', '附件'],
  ['link', '关联'],
  ['operation', '操作记录'],
  ['source', '来源原话'],
] as const
const DEFAULT_CAPABILITIES = [
  'activity:read', 'activity:write',
  'crm:read', 'crm:write',
  'project:read', 'project:write',
  'todo:read', 'todo:write',
  'fin:read', 'fin:write',
  'note:read', 'note:write',
  'attachment:read',
  'link:read', 'link:write',
  'operation:read', 'source:read',
]
const STATUS_LABEL: Record<CredentialStatus, string> = {
  pending: '待配对',
  active: '已兑换 · 授权有效',
  expired: '已过期',
  stale: '恢复世代已变更',
  revoked: '已撤销',
}

function relayAddress() {
  const base = endpointBase() || (typeof location === 'undefined' ? '' : location.origin)
  if (!base) return { ws: '', mcp: '' }
  const origin = new URL(base)
  const wsProtocol = origin.protocol === 'https:' ? 'wss:' : 'ws:'
  return {
    ws: `${wsProtocol}//${origin.host}/relay`,
    mcp: `${origin.origin}/relay/mcp`,
  }
}

export default function AgentAccessPanel() {
  const [items, setItems] = useState<AgentCredential[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [caps, setCaps] = useState<string[]>(DEFAULT_CAPABILITIES)
  const [issue, setIssue] = useState<PairIssue | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pairNotice, setPairNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [pairSupported, setPairSupported] = useState<boolean | null>(null)

  async function load(reset = true) {
    setLoading(true)
    setError('')
    try {
      const offset = reset ? 0 : nextOffset
      if (offset === null) return
      const result = (await clientRequest('/api/workhub/agents', {
        action: 'list',
        limit: 100,
        offset,
      })) as unknown as AgentListResponse
      if (issue) {
        const latest = result.items.find((item) => item.id === issue.id)
        if (latest && latest.status !== 'pending') {
          setIssue(null)
          setCopied(false)
          setPairNotice(
            latest.pairedAt
              ? '服务器已记录短码兑换；这不表示客户端已保存凭据或当前在线。'
              : '该配对码已过期、撤销或恢复世代已变更，请重新生成。',
          )
        }
      }
      setItems((old) => {
        if (reset) return result.items
        const seen = new Set(old.map((item) => item.id))
        return [...old, ...result.items.filter((item) => !seen.has(item.id))]
      })
      setNextOffset(result.truncated && result.nextOffset !== null ? result.nextOffset : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    let current = true
    void endpointFetch('/relay/agent/pair/status', { cache: 'no-store' })
      .then(async (response) => {
        const status = response.ok ? await response.json() as { pairingSupported?: boolean } : null
        if (current) setPairSupported(status?.pairingSupported === true)
      })
      .catch(() => {
        if (current) setPairSupported(false)
      })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!issue) return
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((issue.expiresAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [issue])

  async function createPair() {
    if (busy || pairSupported !== true || !name.trim() || caps.length === 0) return
    setBusy(true)
    setError('')
    setIssue(null)
    setPairNotice('')
    setCopied(false)
    try {
      const result = (await clientRequest('/api/workhub/agents', {
        action: 'preparePair',
        name: name.trim(),
        capabilities: caps,
      })) as { id: string; code: string; expiresAt: number }
      setIssue({ id: result.id, code: result.code, expiresAt: result.expiresAt, name: name.trim() })
      setName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(item: AgentCredential) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await clientRequest('/api/workhub/agents', { action: 'revoke', id: item.id })
      if (issue?.id === item.id) setIssue(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copyInstructions() {
    if (!issue || secondsLeft <= 0) return
    const { ws, mcp } = relayAddress()
    const pairEndpoint = mcp.endsWith('/mcp') ? `${mcp.slice(0, -4)}/agent/pair/redeem` : `${mcp}/agent/pair/redeem`
    const instructions = [
      `寻鸽 Agent 接入：${issue.name}`,
      `配对码（10 分钟内一次性使用）：${issue.code}`,
      '',
      '通用客户端（无需仓库）：',
      `向 ${pairEndpoint} 发送 POST，Content-Type: application/json，请求体 {"code":"<上方配对码>"}。`,
      '读取响应中的 token、credentialId 和 url；把 token 立即保存在目标设备的系统安全凭据库中，然后用 url 作为 MCP 地址并设置 Authorization: Bearer <token>。不要打印 token、写入聊天/项目配置或转述给我。',
      '',
      '若目标设备已检出本仓库副本并希望自动配置本机 Agent，可选用安装器：',
      `npm run agent:setup -- --url ${ws} --pair`,
      '终端隐藏读取短码，将每次配对的 token 存进独立 0600 凭据文件；追加 --only codex 等参数可只改一个本机客户端。',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(instructions)
      setCopied(true)
    } catch {
      setError('无法写入剪贴板，请手动复制下方配对码和指令。')
    }
  }

  const { ws, mcp } = relayAddress()
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="space-y-1">
          <h2 className="font-semibold">Agent 接入</h2>
          <p className="text-sm text-outline">
            每个设备或 Agent 使用独立凭据。配对码仅显示一次、10 分钟有效；兑换后可在下方单独撤销。
          </p>
        </div>
        <div className="rounded-lg bg-surface-container-low p-3 text-sm">
          <p>标准 MCP 地址</p>
          <p className="break-all font-mono">{mcp || '请先配置站点地址'}</p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">接入名称</span>
          <input
            className={inputCls}
            maxLength={80}
            placeholder="例如：工作电脑上的 Codex"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="text-sm text-outline">默认授予个人助手常用读写能力；服务端部署白名单仍会进一步限制写入。</p>
        <details className="rounded-lg border border-outline-variant p-3">
          <summary className="cursor-pointer font-medium">自定义能力范围</summary>
          <fieldset className="mt-3 grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Agent 能力范围</legend>
            {DOMAIN_ROWS.map(([domain, label]) => (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1" key={domain}>
                <span className="min-w-20 text-sm">{label}</span>
                {['read', 'write']
                  .filter((mode) => domain !== 'source' && domain !== 'operation' ? true : mode === 'read')
                  .map((mode) => {
                    const capability = `${domain}:${mode}`
                    return (
                      <label key={capability} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={caps.includes(capability)}
                          onChange={(event) =>
                            setCaps((current) =>
                              event.target.checked
                                ? [...current, capability]
                                : current.filter((item) => item !== capability),
                            )
                          }
                        />
                        {mode === 'read' ? '读' : '写'}
                      </label>
                    )
                  })}
              </div>
            ))}
          </fieldset>
        </details>
        {pairSupported === false ? (
          <p role="status" className="rounded-lg bg-surface-container-low p-3 text-sm text-on-surface-variant">
            当前 Relay 未启用独立凭据执行器，暂不能安全配对。请在支持该能力的服务端使用此入口。
          </p>
        ) : null}
        <Button disabled={busy || pairSupported !== true || !name.trim() || !caps.length || !ws} onClick={() => void createPair()}>
          {busy ? '正在生成…' : '生成一次性配对码'}
        </Button>
        {issue ? (
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary-container/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{issue.name} · {secondsLeft ? `剩余 ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : '已过期'}</p>
              <Button variant="ghost" disabled={!secondsLeft} onClick={() => void copyInstructions()}>
                {copied ? '已复制接入指令' : '复制接入指令'}
              </Button>
            </div>
            <label className="block space-y-1">
              <span className="text-sm">一次性配对码</span>
              <textarea readOnly aria-label="一次性配对码" className={inputCls} value={issue.code} />
            </label>
            <div className="space-y-1 text-sm text-outline">
              <p>通用客户端无需仓库：向此端点 POST JSON <code>{'{"code":"<配对码>"}'}</code>：</p>
              <code className="block break-all rounded bg-surface-container p-2">{mcp.endsWith('/mcp') ? `${mcp.slice(0, -4)}/agent/pair/redeem` : `${mcp}/agent/pair/redeem`}</code>
              <p>把响应中的 <code>token</code> 安全保存到目标设备的系统凭据库，再用响应的 <code>url</code> 作为 MCP 地址并设置 <code>Authorization: Bearer</code>。不要打印或转述 token。</p>
              <p>若目标设备已检出本仓库副本并希望自动配置已检测到的本机 Agent，可选用安装器：</p>
              <code className="block break-all rounded bg-surface-container p-2">npm run agent:setup -- --url {ws} --pair</code>
              <p>安装器隐藏读取短码并保存独立凭据；追加 <code>--only codex</code> 可只更新一个客户端。</p>
            </div>
          </div>
        ) : null}
        {pairNotice ? <p role="status" className="text-sm text-on-surface-variant">{pairNotice}</p> : null}
        {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">接入记录</h2>
            <p className="text-sm text-outline">“已兑换”仅表示服务端签发了凭据，不表示设备已保存或当前在线。</p>
          </div>
          <Button variant="ghost" disabled={loading} onClick={() => void load()}>
            {loading ? '刷新中…' : '刷新列表'}
          </Button>
        </div>
        {items.length === 0 && !loading ? <p className="text-sm text-outline">暂无接入记录。</p> : null}
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="space-y-2 border-b border-outline-variant pb-3 last:border-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="break-words font-medium">{item.name} · {STATUS_LABEL[item.status]}</p>
                  {item.pairedAt ? <p className="text-xs text-outline">服务端兑换于 {new Date(item.pairedAt).toLocaleString()}</p> : null}
                  {item.status === 'pending' && item.pairExpiresAt ? <p className="text-xs text-outline">配对码剩余 {Math.max(0, Math.ceil((item.pairExpiresAt - Date.now()) / 1000))} 秒</p> : null}
                  <p className="break-words text-sm text-outline">{item.capabilities.join('、')}</p>
                </div>
                {item.status !== 'revoked' ? (
                  <Button variant="ghost" disabled={busy} onClick={() => void revoke(item)}>
                    {item.status === 'pending' ? '取消配对' : '撤销此接入'}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {nextOffset !== null ? (
          <Button variant="ghost" disabled={loading} onClick={() => void load(false)}>
            {loading ? '加载中…' : '加载更早的接入记录'}
          </Button>
        ) : null}
      </Card>
    </div>
  )
}

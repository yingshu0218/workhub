import { useEffect, useState } from 'react'
import { clientRequest } from '@/platform/request'
import { endpointBase } from '@/platform/endpoint'
import { Button, Card, inputCls } from '@/design-system/ui'
import type { Value } from '@/queries/personal'
const DOMAINS = [
  ['activity', '事件'],
  ['crm', '联系人'],
  ['project', '事项'],
  ['todo', '待办'],
  ['fin', '收支'],
  ['note', '笔记'],
  ['attachment', '附件'],
  ['link', '关联'],
  ['habit', '习惯'],
  ['operation', '操作记录'],
  ['source', '来源原话'],
]
export default function AgentAccessPanel() {
  const [items, setItems] = useState<Value[]>([]),
    [name, setName] = useState(''),
    [caps, setCaps] = useState<string[]>([
      'activity:read',
      'crm:read',
      'todo:read',
      'operation:read',
    ]),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function load() {
    try {
      const r = await clientRequest('/api/workhub/agents', { action: 'list' })
      setItems(r.items as Value[])
    } catch (e) {
      setError(String(e))
    }
  }
  useEffect(() => {
    void load()
  }, [])
  async function issue() {
    if (busy) return
    setBusy(true)
    setError('')
    setToken('')
    try {
      const r = await clientRequest('/api/workhub/agents', {
        action: 'issue',
        name,
        capabilities: caps,
      })
      setToken(String(r.token))
      setName('')
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  async function revoke(id: unknown) {
    if (busy) return
    setBusy(true)
    try {
      await clientRequest('/api/workhub/agents', { action: 'revoke', id })
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">独立 Agent 凭据</h2>
        <p>每个客户端单独授权、单独撤销。中风险写入仍需要绑定参数的确认预览。</p>
        <p className="break-all">MCP 地址：{endpointBase()}/relay/mcp</p>
        <label>
          客户端名称
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend>能力范围</legend>
          {DOMAINS.map(([domain, label]) => (
            <div className="flex flex-wrap gap-3" key={domain}>
              <span>{label}</span>
              {['read', 'write']
                .filter((mode) => domain !== 'source' || mode === 'read')
                .map((mode) => {
                  const cap = domain + ':' + mode
                  return (
                    <label key={cap}>
                      <input
                        type="checkbox"
                        checked={caps.includes(cap)}
                        onChange={(e) =>
                          setCaps((old) =>
                            e.target.checked ? [...old, cap] : old.filter((c) => c !== cap),
                          )
                        }
                      />{' '}
                      {mode === 'read' ? '读' : '写'}
                    </label>
                  )
                })}
            </div>
          ))}
        </fieldset>
        <Button disabled={busy || !name.trim() || !caps.length} onClick={() => void issue()}>
          签发一次性显示的凭据
        </Button>
        {token ? (
          <div className="space-y-2">
            <p>仅此次显示，请保存到客户端的 Authorization: Bearer 配置。关闭本页后不再显示。</p>
            <textarea readOnly aria-label="新凭据" className={inputCls} value={token} />
            <Button variant="ghost" onClick={() => setToken('')}>
              隐藏凭据
            </Button>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </Card>
      <Card className="space-y-4 p-5">
        <h2>已授权客户端</h2>
        {items.map((item) => (
          <div key={String(item.id)} className="space-y-2 border-b border-outline-variant pb-3">
            <p>
              {String(item.name)} · {item.revokedAt ? '已撤销' : '有效'}
            </p>
            <p className="break-words text-sm text-outline">
              {(item.capabilities as string[]).join('、')}
            </p>
            {!item.revokedAt ? (
              <Button variant="ghost" disabled={busy} onClick={() => void revoke(item.id)}>
                撤销 {String(item.name)}
              </Button>
            ) : null}
          </div>
        ))}
      </Card>
    </div>
  )
}

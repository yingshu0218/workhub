import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, PageHeader, inputCls } from '@/design-system/ui'
import { endpointBase, setEndpoint } from '@/platform/endpoint'
import { isTauri } from '@/platform/env'
import { clearAuthSession, getAuthIdentity } from '@/shared/authToken'
import { suspendClientSession, clientSession } from '@/storage/clientSession'
import { pullClientChanges } from '@/sync/clientSync'
import { useSyncStore } from '@/sync/store'
import { downloadText } from '@/shared/download'
import { db, NexusDB } from '@/db/db'
import { SYNC_TABLES } from '@/sync/remoteNormalize'
import { oldDraftGroups, reviewDraftCopy } from '@/storage/clientDrafts'
import { exportBusinessCopy } from '@/storage/clientExport'
import { queryPersonal } from '@/domain/personal'
import AgentAccessPanel from './AgentAccessPanel'
import PreferencesPanel from './PreferencesPanel'
import { AboutTab } from './AboutTab'
import { Icon } from '@/design-system/Icon'
const TABS = [
  ['account', '账号与服务器', 'manage_accounts'],
  ['agent', 'Agent 接入', 'smart_toy'],
  ['data', '数据与备份', 'settings_backup_restore'],
  ['appearance', '外观与偏好', 'palette'],
  ['about', '关于', 'info'],
]
function Account() {
  const [server, setServer] = useState(endpointBase()),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    sync = useSyncStore()
  return (
    <Card className="space-y-5 p-6">
      <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
        <Icon name="manage_accounts" className="text-primary" />
        账号与连接
      </h2>
      <div className="rounded-lg bg-surface-container-low p-4 text-sm">
        当前账号：<strong>{getAuthIdentity() || '已登录'}</strong>
      </div>
      <label className="block space-y-1.5 text-sm text-on-surface-variant">
        服务器地址
        <input
          className={inputCls}
          value={server}
          readOnly={!isTauri()}
          onChange={(e) => setServer(e.target.value)}
        />
      </label>
      {isTauri() ? (
        <Button
          onClick={() => {
            try {
              setEndpoint(server)
            } catch (e) {
              setError(String(e))
            }
          }}
        >
          切换服务器并重新验证身份
        </Button>
      ) : null}
      <p>
        同步：
        {sync.status === 'synced'
          ? '已同步'
          : sync.status === 'syncing'
            ? '正在读取变更'
            : '离线或等待重试'}
        {sync.lastSyncAt ? ' · ' + new Date(sync.lastSyncAt).toLocaleString('zh-CN') : ''}
      </p>
      <p>离线仅可查看本会话已缓存内容、保存未提交草稿；正式写入等待服务器回执。</p>
      {sync.lastError ? <p role="alert">{sync.lastError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <Button
        disabled={busy}
        variant="ghost"
        onClick={() => {
          setBusy(true)
          void pullClientChanges(true)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false))
        }}
      >
        重新建立缓存
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          clearAuthSession()
          suspendClientSession()
          window.dispatchEvent(new CustomEvent('workhub:auth-fault', { detail: { status: 401 } }))
        }}
      >
        退出登录，保留本账号草稿
      </Button>
    </Card>
  )
}
function Data() {
  const session = clientSession(),
    groups = session ? oldDraftGroups(session) : []
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function exportCache(legacy = false) {
    setBusy(true)
    try {
      const source = legacy ? new NexusDB('nexus-workspace') : db
      const tables: Record<string, unknown> = {}
      for (const table of [...SYNC_TABLES, ...(legacy ? ['syncQueue'] : [])])
        tables[table] = await source.table(table).toArray()
      const drafts: Record<string, unknown> = {}
      const session = clientSession()
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!
        if (
          (key.startsWith('workhub.draft.') ||
            key.startsWith('workhub.pending.') ||
            key.startsWith('workhub.action.')) &&
          (legacy ? !key.includes(':%5B') : session && key.endsWith(':' + session.key))
        )
          drafts[key] = localStorage.getItem(key)
      }
      downloadText(
        JSON.stringify(
          {
            format: 'nexus-client-review-copy',
            kind: legacy ? 'legacy-review' : 'cache-copy',
            completeServerBackup: false,
            session: legacy ? undefined : session,
            tables,
            drafts,
          },
          null,
          2,
        ),
        (legacy ? '旧客户端待核对' : '当前缓存副本') + '.json',
        'application/json',
      )
      if (legacy) source.close()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
          <Icon name="settings_backup_restore" className="text-primary" />
          副本与恢复范围
        </h2>
        <p>
          客户端缓存导出用于人工核对，不是完整业务副本，也不包含全部附件、操作历史或服务器恢复资料。
        </p>
        <Button disabled={busy} onClick={() => void exportCache()}>
          导出当前缓存与未提交草稿
        </Button>
        <p>
          完整可恢复备份必须在服务器执行冷备份，包含数据库、文件、删除登记和校验清单。恢复后更换世代，旧请求先核对再录入。
        </p>
        <Button
          disabled={busy}
          variant="ghost"
          onClick={() => {
            setBusy(true)
            void exportBusinessCopy()
              .then((copy) =>
                downloadText(
                  JSON.stringify(copy, null, 2),
                  '业务数据副本.json',
                  'application/json',
                ),
              )
              .catch((e) => setError(String(e)))
              .finally(() => setBusy(false))
          }}
        >
          导出服务器业务 JSON 副本（含可读附件）
        </Button>
        <p>
          业务 JSON 副本只用于业务迁移，不能代替完整恢复备份；请使用部署指南中的受控导出与恢复流程。
        </p>
        <Link className="text-primary" to="/trash">
          查看回收站
        </Link>
      </Card>
      <Card className="space-y-3 p-5">
        <h2>旧客户端待核对数据</h2>
        <p>
          旧离线库和队列保留在原空间，不自动推送、不自动清空。导出后核对来源、世代与服务器已有结果，再决定是否重新录入。
        </p>
        <Button disabled={busy} variant="ghost" onClick={() => void exportCache(true)}>
          导出旧库和旧队列供核对
        </Button>
      </Card>
      {groups.map((group) => (
        <Card key={group.generation + ':' + group.schema} className="space-y-3 p-5">
          <h2>本账号旧世代待核对</h2>
          <p>
            原世代 {group.generation.slice(0, 12)}… · 协议版本 {group.schema} · {group.keys.length}{' '}
            项草稿或未知请求
          </p>
          <p>保留原请求和原世代，不会自动重录。</p>
          <Button
            variant="ghost"
            onClick={() =>
              downloadText(
                JSON.stringify(reviewDraftCopy(group), null, 2),
                '旧世代待核对.json',
                'application/json',
              )
            }
          >
            导出原上下文与输入
          </Button>
          {group.keys.map((key) => {
            let pending: { requestId?: string }
            try {
              pending = JSON.parse(localStorage.getItem(key) || '{}')
            } catch {
              return null
            }
            return pending.requestId ? (
              <Button
                key={key}
                variant="ghost"
                onClick={() => {
                  void queryPersonal('get_operation', {
                    requestId: pending.requestId,
                    generation: group.generation,
                  })
                    .then(() => setError('查到原操作，请按原上下文人工核对'))
                    .catch((e) => setError(String(e)))
                }}
              >
                核对原请求 {pending.requestId.slice(0, 12)}…
              </Button>
            ) : null
          })}
        </Card>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}
export default function SettingsPage() {
  const [tab, setTab] = useState('account')
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader title="系统设置" />
      <nav className="surface-card-xl flex flex-wrap gap-1.5 p-1.5" aria-label="设置分组">
        {TABS.map(([id, label, icon]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[0.9286rem] transition-colors ${tab === id ? 'bg-primary font-semibold text-on-primary' : 'text-on-surface-variant hover:bg-surface-hover'}`}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={16} />
            {label}
          </button>
        ))}
      </nav>
      {tab === 'account' ? (
        <Account />
      ) : tab === 'agent' ? (
        <AgentAccessPanel />
      ) : tab === 'data' ? (
        <Data />
      ) : tab === 'appearance' ? (
        <PreferencesPanel />
      ) : (
        <AboutTab />
      )}
    </div>
  )
}

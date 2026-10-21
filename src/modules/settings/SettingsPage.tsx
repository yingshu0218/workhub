import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { PageHeader, Button, ConfirmDialog, inputCls } from '@/design-system/ui'
import { AiBridgeSection } from './AiBridgeSection'
import { DEFAULT_SETTINGS } from '@/db/types'
import type { Settings, SettingsSync } from '@/db/types'
import { settingsRepo } from '@/repositories/localAdmin'
import { useNavigate } from 'react-router-dom'
import { THEME_STYLES, SKIN_STYLES } from '@/shared/theme'
import { pbPing, isSyncConfigured, enqueueAllForPush } from '@/sync/pocketbaseAdapter'
import { syncEngine } from '@/sync/engine'
import { useSyncStore } from '@/sync/store'
import { deriveSyncBadge, SYNC_TONE_TEXT_CLASS } from '@/sync/badge'
// 共享基础件已抽到 ./settingsUi（审计 C-7/C-10）：Section/Toggle/Segmented/SkinThumb + toCsv/blobToDataUrl
import { Section, SkinThumb } from './settingsUi'
import { NotificationsTab } from './NotificationsTab'
import { DensityTab, TypographyTab } from './AppearanceTabs'
import { ShortcutsTab } from './ShortcutsTab'
import { SecurityTab } from './SecurityTab'

/**
 * 系统设置（对齐原型 13~15/17/18/20 · 7 标签）
 * 所有改动经 settingsRepo.save 即时落库并广播 settings:changed，各消费端实时应用（无「保存更改」按钮）
 * 边界（Issue #86）：本页只管「应用长什么样 / 怎么跑」的本地偏好（settings singleton，不进同步）；
 * 业务模块的规则配置（健康分权重等，写 moduleConfigs 同步表）已迁至 /module-config，本页仅留指路牌。
 */

const TABS = [
  { id: 'appearance', label: '外观与主题', icon: 'palette' },
  { id: 'density', label: '色彩与密度', icon: 'format_color_fill' },
  { id: 'typography', label: '字体与排版', icon: 'text_fields' },
  { id: 'shortcuts', label: '通用与快捷键', icon: 'keyboard' },
  { id: 'notifications', label: '提醒与协同', icon: 'notifications_active' },
  { id: 'sync', label: '云端同步', icon: 'cloud_sync' },
  { id: 'security', label: '数据与安全', icon: 'security' },
  { id: 'ai', label: 'AI Agent 桥', icon: 'smart_toy' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function SettingsPage() {
  const navigate = useNavigate()
  // 当前用户身份（Issue #123）：显示名默认「阿蓝」，改动实时联动全局
  const [tab, setTab] = useState<TabId>('appearance')
  const [settings, setSettings] = useState<Settings | null>(null)
  // 本地存储持久化状态：主组件 useEffect 探测，SecurityTab 负责展示（故留在此处并透传）
  const [persisted, setPersisted] = useState<boolean | null>(null)
  // 设置读取失败提示（不静默：失败时回落默认值并显式告知，见 useEffect 注释）
  const [loadError, setLoadError] = useState<string | null>(null)
  // 云端同步：表单本地草稿（保存后才生效）、连接测试与全量推送状态
  const [syncForm, setSyncForm] = useState<SettingsSync | null>(null)
  const [syncSaving, setSyncSaving] = useState(false)
  const [pinging, setPinging] = useState(false)
  const [pingMsg, setPingMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pushingAll, setPushingAll] = useState(false)
  const syncStatus = useSyncStore()
  // 同步状态的图标 / 文案 / 色调与顶栏徽章**共用同一份派生**（src/sync/badge.ts），
  // 避免两处各写一套 status 判断而互相打脸（例：徽章说连不上、这里说已同步）。
  // 注意读的是**已保存的实际状态**，不是输入框里的草稿 —— 改完要点「保存」才会变。
  const syncView = deriveSyncBadge({
    status: syncStatus.status,
    pendingCount: syncStatus.pendingCount,
    target: syncStatus.target,
    reachability: syncStatus.reachability,
    lastSyncAt: syncStatus.lastSyncAt,
    lastError: syncStatus.lastError,
    serverUrl: syncStatus.serverUrl,
    now: Date.now(),
  })
  // 应用风格确认弹窗（替代 window.confirm）：pendingConfirm 持有待执行动作
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string
    message: string
    danger?: boolean
    confirmText?: string
    run: () => void
  } | null>(null)
  /** 统一确认入口：弹出应用风格弹窗，确认后执行 run */
  const askConfirm = (opts: {
    title: string
    message: string
    danger?: boolean
    confirmText?: string
    run: () => void
  }) => setPendingConfirm(opts)
  // 笔记默认目录数据源（侧栏快速便签落点；设置「笔记偏好」用）

  useEffect(() => {
    /**
     * ⚠️ 必须有 `.catch`（本轮修复 · 2026-10-21）：
     * 此前只有 `.then` —— 一旦 `settingsRepo.get()` 读失败（IndexedDB 被浏览器阻断、
     * 隐私模式、配额耗尽、库文件损坏），Promise 永远不 resolve，
     * 页面就**永久停在「设置载入中…」且没有任何错误提示**（本仓最忌讳的静默失败）。
     *
     * 此缺陷在 headless 冷启动（IndexedDB 首次打开慢）时被真机验证暴露：
     * 对照实验显示 `/settings` 卡在载入态，而 `/todo` `/crm` `/finance` 均正常 ——
     * 差别就在于那些页面走 `useCollection`（有同步默认值，先渲染空态），
     * 而本页把整页渲染**挂在首个异步结果上**。
     *
     * 修法：失败时回落到 `DEFAULT_SETTINGS` 并给出可见提示（**不静默**），
     * 让用户至少能看到界面、知道出了什么问题，而不是对着一句「载入中…」无限等。
     */
    void settingsRepo
      .get()
      .then((s) => {
        setSettings(s)
        setSyncForm(s.sync)
      })
      .catch((err) => {
        console.error('[settings] 读取设置失败，回落到默认值', err)
        setSettings(DEFAULT_SETTINGS)
        setSyncForm(DEFAULT_SETTINGS.sync)
        setLoadError(err instanceof Error ? err.message : '未知错误')
      })
    if (navigator.storage?.persisted) {
      void navigator.storage
        .persisted()
        .then(setPersisted)
        .catch(() => setPersisted(null))
    }
  }, [])

  if (!settings) {
    // 骨架微光叠在文案上（只加视觉层，文案保持不变 —— 它有既有断言按文本查询）
    return (
      <div className="anim-skeleton py-20 text-center text-[0.9286rem] text-outline">
        设置载入中…
      </div>
    )
  }

  const save = (patch: Partial<Omit<Settings, 'key'>>) => {
    void settingsRepo.save(patch).then(setSettings)
  }


  // ── 云端同步：保存配置 → 连接测试 → 立即同步一次 ──
  const saveSyncAndTest = async () => {
    if (!syncForm) return
    const url = syncForm.serverUrl.trim().replace(/\/+$/, '')
    setSyncSaving(true)
    setPingMsg(null)
    try {
      const saved = await settingsRepo.save({ sync: { ...syncForm, serverUrl: url } })
      setSyncForm(saved.sync)
      // 地址/凭据刚变，立刻重探一次连通性 —— 否则顶栏徽章要等满一个 30s 心跳才更新，
      // 用户会以为「保存了但没生效」。
      void syncEngine.refreshConnectivity()
      setPinging(true)
      const result = await pbPing()
      setPingMsg({ ok: result.ok, text: result.message })
      if (result.ok) void syncEngine.syncNow('manual')
    } catch (err) {
      setPingMsg({ ok: false, text: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setSyncSaving(false)
      setPinging(false)
    }
  }

  const testSync = async () => {
    setPinging(true)
    setPingMsg(null)
    try {
      const result = await pbPing()
      setPingMsg({ ok: result.ok, text: result.message })
    } finally {
      setPinging(false)
    }
  }

  // ── 云端同步：全量推送（首次接入服务器 / 更换服务器时使用） ──
  const pushAllToServer = () => {
    askConfirm({
      title: '全量推送至服务器',
      message:
        '将把本地全部业务记录（含软删除墓碑）写入同步队列并推送至服务器，随后拉取远端增量做 LWW 合并。首次接入服务器请执行此操作，确定继续？',
      confirmText: '开始推送',
      run: () => {
        setPushingAll(true)
        void enqueueAllForPush()
          .then((count) => {
            syncEngine.requestSync()
            setPingMsg({ ok: true, text: `已将 ${count} 条记录加入同步队列，正在推送…` })
          })
          .catch((err) => {
            console.error('[settings] 全量推送入队失败', err)
            setPingMsg({ ok: false, text: '全量推送入队失败，请稍后重试' })
          })
          .finally(() => setPushingAll(false))
      },
    })
  }

  // 每次切标签重算：注册表随挂载页面动态变化，实时读取当前已注册快捷键

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="系统设置"
      />

      {/* 设置读取失败提示（不静默）：失败时已回落默认值，此处显式告知，避免用户以为改动生效了 */}
      {loadError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
          <Icon name="warning" className="mt-0.5 text-[1.2857rem] text-danger" />
          <div className="flex-1">
            <div className="text-[0.9286rem] font-semibold text-danger">设置读取失败，已使用默认值</div>
            <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
              本页显示的是默认配置，你在此处所做的修改可能无法保存。原因：{loadError}
            </div>
          </div>
        </div>
      )}

      {/* 功能配置入口（Issue #86）：业务规则配置已独立成页，这里只留指路牌，避免两类配置混用 */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-fixed/30 px-4 py-3">
        <Icon name="tune" className="text-[1.4286rem] text-primary" />
        <div className="flex-1">
          <div className="text-[0.9286rem] font-semibold">业务模块的规则配置已移到「功能配置」</div>
          <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
            健康分权重、黑名单屏蔽等影响数据算出来结果的配置请到功能页设置；本页只管应用自身的界面与运行偏好
          </div>
        </div>
        <Button size="sm" variant="ghost" icon="tune" onClick={() => navigate('/module-config')}>
          前往功能配置
        </Button>
      </div>

      {/* 标签栏 */}
      <div className="mb-5 flex flex-wrap gap-1.5 surface-card-xl p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[0.9286rem] transition-colors ${
              tab === t.id
                ? 'bg-primary font-semibold text-on-primary'
                : 'text-on-surface-variant hover:bg-surface-hover'
            }`}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 外观与主题 ── */}
      {tab === 'appearance' && (
        <div className="anim-enter space-y-4">
          <Section
            icon="texture"
            title="界面风格"
            desc="第一层选择：造型语言（卡片形状 / 描边 / 投影 / 标题字体 / 纹理装饰），与配色独立、可任意叠加"
            badge="实时生效"
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {SKIN_STYLES.map((sk) => {
                const active = (settings.appearance.style ?? 'none') === sk.id
                return (
                  <button
                    key={sk.id}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? 'border-primary bg-primary-fixed/40'
                        : 'border-outline-variant/50 hover:border-primary/50'
                    }`}
                    onClick={() => {
                      const radius =
                        ('radius' in sk ? sk.radius : undefined) ?? settings.appearance.radius
                      save({ appearance: { ...settings.appearance, style: sk.id, radius } })
                    }}
                  >
                    {/* 风格缩略预览：用形态而非色带表达风格差异 */}
                    <div className="mb-3 flex h-16 items-center justify-center overflow-hidden surface-card !bg-transparent">
                      <SkinThumb id={sk.id} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[0.9286rem] font-semibold">{sk.label}</span>
                      {active && (
                        <Icon name="check_circle" fill className="text-[1.2857rem] text-primary" />
                      )}
                    </div>
                    <p className="mt-1 text-[0.7857rem] leading-snug text-on-surface-variant">
                      {sk.desc}
                    </p>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section
            icon="auto_awesome"
            title="配色主题"
            desc="第二层选择：底色基调、容器色阶与情绪色（含明暗推荐），与上方界面风格自由组合"
            badge="实时生效"
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {THEME_STYLES.map((t) => {
                const active = (settings.appearance.theme ?? 'classic') === t.id
                return (
                  <button
                    key={t.id}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? 'border-primary bg-primary-fixed/40'
                        : 'border-outline-variant/50 hover:border-primary/50'
                    }`}
                    onClick={() => {
                      const mode = t.mode === 'dark' ? 'dark' : 'light'
                      save({ appearance: { ...settings.appearance, theme: t.id, mode } })
                    }}
                  >
                    <div className="mb-3 flex h-16 overflow-hidden surface-card !bg-transparent">
                      {t.swatch.map((c, i) => (
                        <div key={i} className="flex-1" style={{ background: c }} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[0.9286rem] font-semibold">{t.label}</span>
                      {active && (
                        <Icon name="check_circle" fill className="text-[1.2857rem] text-primary" />
                      )}
                    </div>
                    <p className="mt-1 text-[0.7857rem] leading-snug text-on-surface-variant">
                      {t.desc}
                    </p>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section
            icon="palette"
            title="外观显示模式"
            desc="选择工作台的基础底色方案，切换实时生效"
            badge="实时生效"
          >
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  {
                    id: 'light',
                    label: '浅色模式 (Light)',
                    desc: '经典亮色画布，长时间可视的最佳性与低瞳感',
                  },
                  {
                    id: 'dark',
                    label: '深色模式 (Dark)',
                    desc: '沉浸式暗调素材，大幅降低夜间光线刺激与屏幕能耗',
                  },
                  {
                    id: 'system',
                    label: '跟随系统 (System Sync)',
                    desc: '与 macOS / Windows 系统的深浅日自动同步',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    settings.appearance.mode === opt.id
                      ? 'border-primary bg-primary-fixed/40'
                      : 'border-outline-variant/50 hover:border-primary/50'
                  }`}
                  onClick={() => save({ appearance: { ...settings.appearance, mode: opt.id } })}
                >
                  <div className="mb-3 flex h-16 overflow-hidden surface-card !bg-transparent">
                    {(opt.id === 'light'
                      ? ['#ffffff', '#dbe1ff', '#004ac6']
                      : opt.id === 'dark'
                        ? ['#0b1220', '#1a2438', '#60a5fa']
                        : ['#ffffff', '#0b1220', '#004ac6']
                    ).map((c, i) => (
                      <div key={i} className="flex-1" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[0.9286rem] font-semibold">{opt.label}</span>
                    {settings.appearance.mode === opt.id && (
                      <Icon name="check_circle" fill className="text-[1.2857rem] text-primary" />
                    )}
                  </div>
                  <p className="mt-1 text-[0.7857rem] leading-snug text-on-surface-variant">
                    {opt.desc}
                  </p>
                </button>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* ── 色彩与密度 ── */}
      {tab === 'density' && <DensityTab settings={settings} save={save} />}

      {/* ── 字体与排版 ── */}
      {tab === 'typography' && <TypographyTab settings={settings} save={save} />}

      {/* ── 通用与快捷键 ── */}
      {tab === 'shortcuts' && <ShortcutsTab settings={settings} save={save} />}

      {/* ── 提醒与协同 ── */}
      {tab === 'notifications' && <NotificationsTab settings={settings} save={save} />}

      {/* ── 云端同步 ── */}
      {tab === 'sync' && syncForm && (
        <div className="anim-enter space-y-4">
          <Section
            icon="cloud_sync"
            title="自托管同步服务（PocketBase）"
            desc="数据真源在您自己的云服务器；未配置时为本地模式，全部功能照常可用"
            badge={isSyncConfigured(syncForm) ? '已配置' : '本地模式'}
          >
            <div className="mb-4 flex items-center justify-between surface-card-low rounded-xl/60 px-4 py-3">
              <div className="flex items-center gap-3">
                <Icon
                  name={syncView.icon}
                  className={`text-[1.4286rem] ${SYNC_TONE_TEXT_CLASS[syncView.tone]}`}
                />
                <div>
                  <div className="text-[0.9286rem] font-semibold">{syncView.summary}</div>
                  <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                    {syncStatus.lastSyncAt
                      ? `上次同步：${new Date(syncStatus.lastSyncAt).toLocaleString('zh-CN')}`
                      : '尚未同步过'}
                  </div>
                </div>
              </div>
              <span
                className={`rounded px-2.5 py-1 text-[0.8214rem] font-semibold ${
                  syncStatus.target === 'none'
                    ? 'bg-surface-container text-outline'
                    : 'bg-primary-fixed text-primary'
                }`}
              >
                {syncStatus.target === 'none' ? '○ 未配置' : '● 已配置'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <label className="col-span-2 block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  服务器地址（如 https://sync.example.com）
                </div>
                <input
                  className={inputCls}
                  value={syncForm.serverUrl}
                  placeholder="https://sync.example.com"
                  onChange={(e) => setSyncForm({ ...syncForm, serverUrl: e.target.value })}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  账号（PocketBase users）
                </div>
                <input
                  className={inputCls}
                  value={syncForm.username}
                  placeholder="you@example.com"
                  onChange={(e) => setSyncForm({ ...syncForm, username: e.target.value })}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  密码（仅存本地，不上传同步载荷）
                </div>
                <input
                  className={inputCls}
                  type="password"
                  value={syncForm.password}
                  placeholder="••••••••"
                  onChange={(e) => setSyncForm({ ...syncForm, password: e.target.value })}
                />
              </label>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                size="sm"
                variant="primary"
                onClick={() => void saveSyncAndTest()}
                disabled={syncSaving || pinging}
              >
                {syncSaving || pinging ? '连接中…' : '保存并连接'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void testSync()} disabled={pinging}>
                测试连接
              </Button>
            </div>
            {pingMsg && (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-[0.8571rem] ${
                  pingMsg.ok
                    ? 'bg-success-container/40 text-success'
                    : 'bg-danger-container/40 text-danger'
                }`}
              >
                {pingMsg.ok ? '✓ ' : '✕ '}
                {pingMsg.text}
              </div>
            )}
          </Section>

          <Section
            icon="cloud_upload"
            title="首次接入 / 更换服务器"
            desc="把本地全部业务记录推送到服务器（含墓碑），随后自动拉取远端增量做 LWW 合并"
          >
            <div className="flex items-center gap-4 surface-card-low rounded-xl/60 px-5 py-4">
              <div className="flex-1">
                <div className="text-[0.9643rem] font-semibold">全量推送本地数据到服务器</div>
                <div className="mt-0.5 text-[0.8214rem] leading-relaxed text-on-surface-variant">
                  仅在「保存并连接」成功后可用。历史数据默认不自动上传（只同步增量），首次接入服务器请执行一次。
                  详细部署步骤见 docs/部署指南.md。
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={pushAllToServer}
                disabled={pushingAll || !isSyncConfigured(syncForm)}
              >
                {pushingAll ? '入队中…' : '全量推送'}
              </Button>
            </div>
          </Section>
        </div>
      )}

      {/* ── 数据与安全 ── */}
      {tab === 'security' && (
        <SecurityTab
          settings={settings}
          save={save}
          askConfirm={askConfirm}
          persisted={persisted}
          onPersistedChange={setPersisted}
        />
      )}

      {/* ── AI Agent 桥（能力白名单 + 接入凭据） ── */}
      {tab === 'ai' && <AiBridgeSection settings={settings} save={save} />}

      {/* 应用风格确认弹窗（替代 window.confirm） */}
      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message}
        danger={pendingConfirm?.danger}
        confirmText={pendingConfirm?.confirmText}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const run = pendingConfirm?.run
          setPendingConfirm(null)
          run?.()
        }}
      />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { Card, PageHeader, Button, inputCls } from '@/design-system/ui'
import type { Settings, SettingsSync } from '@/db/types'
import { settingsRepo, resetAndSeedLocalData, restoreFromJson } from '@/repositories'
import {
  workspaceRepo, customerRepo, interactionRepo, ledgerRepo, transactionRepo,
  todoRepo, noteRepo, quickNoteRepo, habitRepo, habitLogRepo, trophyRepo,
} from '@/repositories'
import { listShortcuts } from '@/shared/shortcuts'
import { ACCENT_PRESETS, RADIUS_PRESETS, FONT_SIZE_STEPS, LINE_HEIGHT_STEPS } from '@/shared/theme'
import { pbPing, isSyncConfigured, enqueueAllForPush } from '@/sync/pocketbaseAdapter'
import { syncEngine } from '@/sync/engine'
import { useSyncStore } from '@/sync/store'

/**
 * 系统设置（对齐原型 13~15/17/18/20 · 6 标签）
 * 所有改动经 settingsRepo.save 即时落库并广播 settings:changed，各消费端实时应用（无「保存更改」按钮）
 */

const TABS = [
  { id: 'appearance', label: '外观与主题', icon: 'palette' },
  { id: 'density', label: '色彩与密度', icon: 'format_color_fill' },
  { id: 'typography', label: '字体与排版', icon: 'text_fields' },
  { id: 'shortcuts', label: '通用与快捷键', icon: 'keyboard' },
  { id: 'notifications', label: '提醒与协同', icon: 'notifications_active' },
  { id: 'sync', label: '云端同步', icon: 'cloud_sync' },
  { id: 'security', label: '数据与安全', icon: 'security' },
] as const

type TabId = (typeof TABS)[number]['id']

/** 下载文本文件（导出共用）：CSV 载荷自带 BOM，浏览器端生成无需依赖 */
function downloadText(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** CSV 序列化：含逗号/引号/换行的字段引号包裹转义，\uFEFF BOM 兼容 Excel 直开 */
function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
}

function Section({ icon, title, desc, badge, children }: {
  icon: string
  title: string
  desc?: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
          <Icon name={icon} size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14.5px] font-semibold">{title}</h3>
            {badge && <span className="rounded bg-success-container/60 px-1.5 py-0.5 text-[10px] font-medium text-success">{badge}</span>}
          </div>
          {desc && <p className="mt-0.5 text-[11.5px] text-on-surface-variant">{desc}</p>}
        </div>
      </div>
      {children}
    </Card>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-primary' : 'bg-outline-variant'
      }`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function Segmented<T extends string | number>({ options, value, onChange, format }: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  format: (v: T) => string
}) {
  return (
    <div className="inline-flex rounded-lg border border-outline-variant/60 p-0.5">
      {options.map((opt) => (
        <button
          key={String(opt)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
            opt === value ? 'bg-primary font-medium text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
          }`}
          onClick={() => onChange(opt)}
        >
          {format(opt)}
        </button>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('appearance')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [exporting, setExporting] = useState(false)
  const [resetting, setResetting] = useState(false)
  // 导入迁移：选文件 → 解析 → confirm → 逐表 bulkPut（restoreFromJson）
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  // 云端同步：表单本地草稿（保存后才生效）、连接测试与全量推送状态
  const [syncForm, setSyncForm] = useState<SettingsSync | null>(null)
  const [syncSaving, setSyncSaving] = useState(false)
  const [pinging, setPinging] = useState(false)
  const [pingMsg, setPingMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pushingAll, setPushingAll] = useState(false)
  const syncStatus = useSyncStore()

  useEffect(() => {
    void settingsRepo.get().then((s) => {
      setSettings(s)
      setSyncForm(s.sync)
    })
    if (navigator.storage?.persisted) {
      void navigator.storage.persisted().then(setPersisted).catch(() => setPersisted(null))
    }
  }, [])

  if (!settings) {
    return <div className="py-20 text-center text-[13px] text-outline">设置载入中…</div>
  }

  const save = (patch: Partial<Omit<Settings, 'key'>>) => {
    void settingsRepo.save(patch).then(setSettings)
  }

  // ── 数据导出：全部业务表走 repository.list 汇总 ──
  const exportJson = async () => {
    setExporting(true)
    try {
      const [
        workspaces, customers, interactions, ledgers, transactions,
        todos, notes, quickNotes, habits, habitLogs, trophies,
      ] = await Promise.all([
        workspaceRepo.list(), customerRepo.list(), interactionRepo.list(), ledgerRepo.list(),
        transactionRepo.list(), todoRepo.list(), noteRepo.list(), quickNoteRepo.list(),
        habitRepo.list(), habitLogRepo.list(), trophyRepo.list(),
      ])
      const payload = {
        app: 'nexus-workspace',
        schemaVersion: 3,
        exportedAt: new Date().toISOString(),
        data: { workspaces, customers, interactions, ledgers, transactions, todos, notes, quickNotes, habits, habitLogs, trophies },
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nexus-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  // ── 数据导出：CSV 表格包 —— 交易平表 + 客户档案两张表，各自带 BOM 下载 ──
  const exportCsv = async () => {
    setExporting(true)
    try {
      const [txns, ledgers, customers] = await Promise.all([
        transactionRepo.list(), ledgerRepo.list(), customerRepo.list(),
      ])
      const currencyOf = new Map(ledgers.map((l) => [l.id, l.currency]))
      const date = (ts: number) => new Date(ts).toLocaleDateString('zh-CN')
      const stamp = new Date().toISOString().slice(0, 10)
      const txnCsv = toCsv(
        ['日期', '类型', '金额', '币种', '渠道', '摘要', '状态', '发票号', '标签'],
        txns.map((t) => [
          date(t.occurredAt),
          t.type === 'income' ? '收入' : '支出',
          t.amount,
          currencyOf.get(t.ledgerId) ?? '',
          t.channel,
          t.summary,
          t.status,
          t.invoiceNo ?? '',
          t.tags.join(';'),
        ]),
      )
      downloadText(txnCsv, 'text/csv;charset=utf-8', `nexus-transactions-${stamp}.csv`)
      const custCsv = toCsv(
        ['姓名', '公司', '行业', '分层', '阶段', '电话', '微信', '邮箱', '健康指数'],
        customers.map((c) => [
          c.name, c.company, c.industry, c.tier, c.stage,
          c.phone, c.wechat, c.email, c.healthScore,
        ]),
      )
      downloadText(custCsv, 'text/csv;charset=utf-8', `nexus-customers-${stamp}.csv`)
    } finally {
      setExporting(false)
    }
  }

  // ── 数据导出：全部未删笔记合并为单个 .md（# 标题 + 正文 + 标签行，--- 分隔） ──
  const exportNotesMd = async () => {
    setExporting(true)
    try {
      const notes = await noteRepo.list()
      const md = notes
        .map((n) => {
          const tagsLine = n.tags.length ? `\n\n标签：${n.tags.join('、')}` : ''
          return `# ${n.title}\n\n${n.markdown}${tagsLine}`
        })
        .join('\n\n---\n\n')
      downloadText(
        md,
        'text/markdown;charset=utf-8',
        `nexus-notes-${new Date().toISOString().slice(0, 10)}.md`,
      )
    } finally {
      setExporting(false)
    }
  }

  // ── 导入迁移：JSON 存档恢复（解析 → confirm 覆盖提示 → 逐表 bulkPut） ──
  const importJson = async (file: File) => {
    setImporting(true)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!window.confirm('存档解析成功。将逐表写回本地数据库，与现有记录同 id 的会被存档内容覆盖，确定恢复？')) return
      const count = await restoreFromJson(parsed)
      window.alert(`已恢复 ${count} 条记录，界面即将刷新`)
      window.location.reload()
    } catch (err) {
      console.error('[settings] JSON 恢复失败', err)
      window.alert(`恢复失败：${err instanceof Error ? err.message : '文件解析错误'}`)
    } finally {
      setImporting(false)
    }
  }

  // ── 危险区：清空本地数据并重新种子 ──
  const resetAll = () => {
    if (!window.confirm('将清空本地全部数据（IndexedDB）并重新写入演示种子，云端副本不受影响。该操作不可撤销，确定继续？')) return
    setResetting(true)
    void resetAndSeedLocalData()
      .then(() => window.location.reload())
      .catch((err) => {
        console.error('[settings] 清空失败', err)
        setResetting(false)
      })
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
    if (!window.confirm('将把本地全部业务记录（含软删除墓碑）写入同步队列并推送至服务器，随后拉取远端增量做 LWW 合并。首次接入服务器请执行此操作，确定继续？')) return
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
  }

  // 每次切标签重算：注册表随挂载页面动态变化，实时读取当前已注册快捷键
  const shortcuts = listShortcuts()

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="系统设置"
        subtitle="定制您的专属工作台界面风格、工作流偏好与数据安全策略 · 配置即时生效并本地持久化"
      />

      {/* 标签栏 */}
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] transition-colors ${
              tab === t.id ? 'bg-primary font-semibold text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
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
        <Section icon="palette" title="外观显示模式" desc="选择工作台的基础底色方案，切换实时生效" badge="实时生效">
          <div className="grid grid-cols-3 gap-3">
            {([
              { id: 'light', label: '浅色模式 (Light)', desc: '经典亮色画布，长时间可视的最佳性与低瞳感' },
              { id: 'dark', label: '深色模式 (Dark)', desc: '沉浸式暗调素材，大幅降低夜间光线刺激与屏幕能耗' },
              { id: 'system', label: '跟随系统 (System Sync)', desc: '与 macOS / Windows 系统的深浅日自动同步' },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  settings.appearance.mode === opt.id
                    ? 'border-primary bg-primary-fixed/40'
                    : 'border-outline-variant/50 hover:border-primary/50'
                }`}
                onClick={() => save({ appearance: { ...settings.appearance, mode: opt.id } })}
              >
                <div className="mb-3 flex h-16 overflow-hidden rounded-lg border border-outline-variant/40">
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
                  <span className="text-[13px] font-semibold">{opt.label}</span>
                  {settings.appearance.mode === opt.id && (
                    <Icon name="check_circle" fill className="text-[18px] text-primary" />
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-on-surface-variant">{opt.desc}</p>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ── 色彩与密度 ── */}
      {tab === 'density' && (
        <div className="space-y-4">
          <Section icon="format_color_fill" title="强调色" desc="覆盖主按钮、选中态与链接色的品牌强调色" badge="实时生效">
            <div className="flex flex-wrap gap-3">
              {ACCENT_PRESETS.map((a) => (
                <button
                  key={a.id}
                  className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 transition-colors ${
                    settings.appearance.accent === a.id ? 'border-primary bg-primary-fixed/40' : 'border-outline-variant/50 hover:border-primary/50'
                  }`}
                  onClick={() => save({ appearance: { ...settings.appearance, accent: a.id } })}
                >
                  <span className="h-5 w-5 rounded-full" style={{ background: a.container }} />
                  <span className="text-[12.5px] font-medium">{a.label}</span>
                  {settings.appearance.accent === a.id && (
                    <Icon name="check" fill className="text-[16px] text-primary" />
                  )}
                </button>
              ))}
            </div>
          </Section>

          <Section icon="rounded_corner" title="圆角与信息密度" desc="调整卡片圆角档位与全局间距基数，营造工作台氛围">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[13px] font-medium">卡片圆角</span>
              <Segmented
                options={RADIUS_PRESETS.map((r) => r.id)}
                value={settings.appearance.radius}
                format={(v) => RADIUS_PRESETS.find((r) => r.id === v)!.label}
                onChange={(v) => save({ appearance: { ...settings.appearance, radius: v } })}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">信息密度</span>
              <Segmented
                options={['comfortable', 'compact'] as const}
                value={settings.appearance.density}
                format={(v) => (v === 'comfortable' ? '舒适（4px 基线）' : '紧凑（3.5px 基线）')}
                onChange={(v) => save({ appearance: { ...settings.appearance, density: v } })}
              />
            </div>
          </Section>
        </div>
      )}

      {/* ── 字体与排版 ── */}
      {tab === 'typography' && (
        <div className="grid grid-cols-[1fr_380px] items-start gap-4">
          <Section icon="text_fields" title="基准字号与阅读间距" desc="调整全局文本物理渲染阶梯与行距倍数" badge="实时生效">
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium">基准字体大小 (Base Font Size)</span>
                <span className="text-[12px] font-semibold text-primary">{settings.typography.fontSize} px</span>
              </div>
              <Segmented
                options={FONT_SIZE_STEPS}
                value={settings.typography.fontSize}
                format={(v) => `${v}px${v === 14 ? ' · 默认' : ''}`}
                onChange={(v) => save({ typography: { ...settings.typography, fontSize: v } })}
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium">行高与纵向韵律 (Line Height Ratio)</span>
                <span className="text-[12px] font-semibold text-primary">{settings.typography.lineHeight}x</span>
              </div>
              <Segmented
                options={LINE_HEIGHT_STEPS}
                value={settings.typography.lineHeight}
                format={(v) => `${v}x${v === 1.6 ? ' · 推荐' : ''}`}
                onChange={(v) => save({ typography: { ...settings.typography, lineHeight: v } })}
              />
            </div>
          </Section>

          <Section icon="visibility" title="实时排版预览" desc="下方预览块即当前全局生效值" badge="Live Rendering">
            <div
              className="rounded-xl border border-outline-variant/40 bg-surface-container-low/60 p-5"
              style={{ fontSize: settings.typography.fontSize, lineHeight: settings.typography.lineHeight }}
            >
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-primary">
                # 核心里程碑 · Q3 Milestone
              </div>
              <div className="text-[1.35em] font-bold">多维穿透工作流与团队协作网格</div>
              <p className="mt-2 text-on-surface-variant">
                在团队协作中，沉浸式记录与待办任务可无缝联动。寻鸽工作台深度集成 Inter 字体内核与表格间距韵律，使每次会议纪要、OKR 对齐与财务中心之间实现零损耗上下文传递。当前预览即所保存后的全局正文渲染效果。
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-outline">
              <span>阅读舒适度评级 <b className="text-success">99.4%</b></span>
              <span>字符高宽比 <b>0.72 : 1</b></span>
            </div>
          </Section>
        </div>
      )}

      {/* ── 通用与快捷键 ── */}
      {tab === 'shortcuts' && (
        <div className="space-y-4">
          <Section icon="tune" title="通用偏好设定" desc="General Preferences & Regional Formatting">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <label className="block">
                <div className="mb-1.5 text-[12px] font-medium text-on-surface-variant">系统语言 (Language)</div>
                <input className={inputCls} value="简体中文 (Simplified Chinese)" readOnly />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[12px] font-medium text-on-surface-variant">每周起始日</div>
                <input className={inputCls} value="星期一 (Monday) · 工作日标配" readOnly />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[12px] font-medium text-on-surface-variant">时区与时间制</div>
                <div className="flex items-center gap-2">
                  <input className={inputCls} value="(GMT+08:00) 北京 · 上海 · 香港" readOnly />
                  <span className="shrink-0 rounded bg-success-container/60 px-2 py-1.5 text-[11px] font-medium text-success">● 自动对齐网络授时</span>
                </div>
              </label>
              <label className="block">
                <div className="mb-1.5 text-[12px] font-medium text-on-surface-variant">启动时默认进入的模块</div>
                <input className={inputCls} value="工作台专注主页 (Nexus Workbench)" readOnly />
              </label>
            </div>
          </Section>

          <Section icon="keyboard_command_key" title="全局高频热键映射" desc="Global Hotkeys Map · 快捷键走统一注册表（listShortcuts 实时读取，Phase 6 只读展示）">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-outline-variant/40 text-left text-[11.5px] uppercase tracking-wide text-outline">
                  <th className="pb-2 pr-4 font-semibold">动作名称</th>
                  <th className="pb-2 pr-4 font-semibold">功能描述</th>
                  <th className="pb-2 text-right font-semibold">快捷键绑定</th>
                </tr>
              </thead>
              <tbody>
                {shortcuts.map((s) => (
                  <tr key={s.combo} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{s.description}</td>
                    <td className="py-2.5 pr-4 text-on-surface-variant">{s.scope === 'global' ? '任何页面生效' : '激活页面内生效'}</td>
                    <td className="py-2.5 text-right">
                      <kbd className="rounded-md bg-surface-container-high px-2.5 py-1 text-[12px] font-semibold text-primary">
                        {s.combo === 'mod+k' ? '⌘ K' : s.combo === 'space' ? 'Space' : s.combo === 'enter' ? 'Enter' : s.combo === 'esc' ? 'Esc' : s.combo}
                      </kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      )}

      {/* ── 提醒与协同 ── */}
      {tab === 'notifications' && (
        <Section icon="notifications_active" title="通知推送与业务联动提醒" desc="开关即时持久化 · 本期仅存本地偏好，真实推送通道 Phase 7 接入">
          <div className="space-y-1">
            {([
              { key: 'desktopNotice', title: '系统桌面弹窗通知', desc: '当工作台切后台最小化时，通过系统 Notification API 发送横幅提示卡片' },
              { key: 'soundAlerts', title: '声音提示 (Sound Alerts)', desc: '解锁奖杯、到期临门等重磅节点短促清晰提示' },
              { key: 'webhook', title: '企业微信 / 钉钉 Webhook 协同同步', desc: '团队钉群机器人自动广播优先级看板更新与提醒完成消息' },
              { key: 'dailyBrief', title: '每日待办预告', desc: '每天 09:00 依据事项清单草拟待办今日完成率简报' },
              { key: 'todoDueWarning', title: '任务逾期预警', desc: '在待办事项临近截止前推送预警，避免项目节点延误' },
              { key: 'habitReminder', title: '打卡习惯晚间提醒', desc: '入睡前温和提示今日自律习惯（阅读、代码复盘、健身）待打卡' },
              { key: 'monthEndReconcile', title: '月末流水对账与核算提醒', desc: '每月最后 18:00 自动提醒核对当月流水与速算税额' },
              { key: 'customerStaleAlert', title: '客户久未跟进关键提醒', desc: '当重要 VIP 客户超过 14 天无跟进记录，在工作台顶栏提示' },
            ] as const).map((item) => (
              <div key={item.key} className="flex items-center gap-4 border-b border-outline-variant/20 py-3.5 last:border-0">
                <div className="flex-1">
                  <div className="text-[13.5px] font-medium">{item.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-on-surface-variant">{item.desc}</div>
                </div>
                <Toggle
                  checked={settings.notifications[item.key]}
                  onChange={(v) => save({ notifications: { ...settings.notifications, [item.key]: v } })}
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── 云端同步 ── */}
      {tab === 'sync' && syncForm && (
        <div className="space-y-4">
          <Section
            icon="cloud_sync"
            title="自托管同步服务（PocketBase）"
            desc="数据真源在您自己的云服务器；未配置时为本地模式，全部功能照常可用"
            badge={isSyncConfigured(syncForm) ? '已配置' : '本地模式'}
          >
            <div className="mb-4 flex items-center justify-between rounded-xl border border-outline-variant/40 bg-surface-container-low/60 px-4 py-3">
              <div className="flex items-center gap-3">
                <Icon
                  name={
                    isSyncConfigured(syncForm)
                      ? syncStatus.status === 'synced' ? 'cloud_done' : syncStatus.status === 'syncing' ? 'cloud_sync' : 'cloud_off'
                      : 'cloud_off'
                  }
                  fill
                  className={`text-[20px] ${
                    isSyncConfigured(syncForm)
                      ? syncStatus.status === 'synced' ? 'text-success' : syncStatus.status === 'syncing' ? 'text-primary' : 'text-warning'
                      : 'text-outline'
                  }`}
                />
                <div>
                  <div className="text-[13px] font-semibold">
                    {isSyncConfigured(syncForm)
                      ? syncStatus.status === 'synced' ? '已连接 · 已同步' : syncStatus.status === 'syncing' ? '同步中…' : `离线待同步（${syncStatus.pendingCount} 条待传）`
                      : '本地模式（数据仅存本机）'}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-on-surface-variant">
                    {syncStatus.lastSyncAt
                      ? `上次同步：${new Date(syncStatus.lastSyncAt).toLocaleString('zh-CN')}`
                      : '尚未同步过'}
                  </div>
                </div>
              </div>
              <span className={`rounded px-2.5 py-1 text-[11.5px] font-semibold ${
                isSyncConfigured(syncForm)
                  ? syncStatus.status === 'synced' ? 'bg-success-container/60 text-success' : 'bg-primary-fixed text-primary'
                  : 'bg-surface-container text-outline'
              }`}>
                {isSyncConfigured(syncForm) ? '● 已配置' : '○ 本地模式'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <label className="col-span-2 block">
                <div className="mb-1.5 text-[12px] font-medium text-on-surface-variant">服务器地址（如 https://sync.example.com）</div>
                <input
                  className={inputCls}
                  value={syncForm.serverUrl}
                  placeholder="https://sync.example.com"
                  onChange={(e) => setSyncForm({ ...syncForm, serverUrl: e.target.value })}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[12px] font-medium text-on-surface-variant">账号（PocketBase users）</div>
                <input
                  className={inputCls}
                  value={syncForm.username}
                  placeholder="you@example.com"
                  onChange={(e) => setSyncForm({ ...syncForm, username: e.target.value })}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[12px] font-medium text-on-surface-variant">密码（仅存本地，不上传同步载荷）</div>
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
              <Button size="sm" variant="primary" onClick={() => void saveSyncAndTest()} disabled={syncSaving || pinging}>
                {syncSaving || pinging ? '连接中…' : '保存并连接'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void testSync()} disabled={pinging}>
                测试连接
              </Button>
            </div>
            {pingMsg && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${
                pingMsg.ok ? 'bg-success-container/40 text-success' : 'bg-danger-container/40 text-danger'
              }`}>
                {pingMsg.ok ? '✓ ' : '✕ '}
                {pingMsg.text}
              </div>
            )}
          </Section>

          <Section icon="cloud_upload" title="首次接入 / 更换服务器" desc="把本地全部业务记录推送到服务器（含墓碑），随后自动拉取远端增量做 LWW 合并">
            <div className="flex items-center gap-4 rounded-xl border border-outline-variant/40 bg-surface-container-low/60 px-5 py-4">
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold">全量推送本地数据到服务器</div>
                <div className="mt-0.5 text-[11.5px] leading-relaxed text-on-surface-variant">
                  仅在「保存并连接」成功后可用。历史数据默认不自动上传（只同步增量），首次接入服务器请执行一次。
                  详细部署步骤见 docs/部署指南.md。
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={pushAllToServer} disabled={pushingAll || !isSyncConfigured(syncForm)}>
                {pushingAll ? '入队中…' : '全量推送'}
              </Button>
            </div>
          </Section>
        </div>
      )}

      {/* ── 数据与安全 ── */}
      {tab === 'security' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-container/30 px-5 py-4">
            <Icon name="verified_user" fill className="text-[20px] text-success" />
            <div>
              <div className="text-[13.5px] font-semibold">数据主权保障已激活 (Sovereignty Protocol v2.4)</div>
              <div className="mt-0.5 text-[11.5px] leading-relaxed text-on-surface-variant">
                本地优先 (Local-First) 原则：全部文案与档案数据优先存放于您受控的本地资源池中，云端请求不迁移、厂商脱敏托管。
              </div>
            </div>
          </div>

          <Section icon="archive" title="数据导出与多格式打包" desc="您的所有数据归您所有，可随时打包导出成无锁定迁移其他工具生态">
            <div className="grid grid-cols-3 gap-3">
              {([
                { icon: 'data_object', tag: 'SNAPSHOT', title: 'JSON 全量结构化存档', desc: '完整流水表结构：CRM · 客户档案 · 财务流水 · 笔记关联关系', action: exportJson, label: exporting ? '导出中…' : '导出 JSON 存档', variant: 'primary' as const },
                { icon: 'table_view', tag: 'SPREADSHEET', title: 'CSV 电子表格格式包', desc: '交易平表与客户档案两张表，带 BOM 兼容 Excel / Numbers / 飞书表格', action: exportCsv, label: '导出 CSV 表格包', variant: 'ghost' as const },
                { icon: 'article', tag: 'MARKDOWN', title: 'Markdown 树文本笔记', desc: '全部笔记 Markdown 源文件可导出 .zip 归档（当前为合并 .md）', action: exportNotesMd, label: '导出笔记文档包', variant: 'ghost' as const },
              ]).map((c) => (
                <div key={c.title} className="rounded-xl border border-outline-variant/50 p-4">
                  <div className="flex items-center justify-between">
                    <Icon name={c.icon} className="text-[20px] text-primary" />
                    <span className="text-[9.5px] font-bold uppercase tracking-widest text-outline">{c.tag}</span>
                  </div>
                  <div className="mt-2 text-[13px] font-semibold">{c.title}</div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-on-surface-variant">{c.desc}</p>
                  <div className="mt-3">
                    <Button size="sm" variant={c.variant} onClick={() => void c.action()} disabled={exporting}>
                      {c.label}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* 导入迁移：JSON 存档恢复 */}
            <div className="mt-3 flex items-center gap-4 rounded-xl border border-outline-variant/40 bg-surface-container-low/60 px-5 py-4">
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold">从 JSON 存档恢复（导入迁移）</div>
                <div className="mt-0.5 text-[11.5px] text-on-surface-variant">
                  选择此前导出的 JSON 存档，逐表写回本地数据库；与现有记录同 id 的将被覆盖，恢复后自动刷新界面。
                </div>
              </div>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importJson(f)
                  e.target.value = ''
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? '恢复中…' : '选择存档文件'}
              </Button>
            </div>
          </Section>

          <Section icon="settings_backup_restore" title="本地数据持久化状态" desc="启动时已自动申请 Persistent Storage，防浏览器回收 IndexedDB">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="text-[13.5px] font-medium">高性能本地持久化 (IndexedDB)</div>
                <div className="mt-0.5 text-[11.5px] text-on-surface-variant">
                  {persisted === null
                    ? '正在读取浏览器存储持久化状态…'
                    : persisted
                      ? '已持久化：浏览器承诺不自动回收本地数据库（离线写入与附件均安全保留）'
                      : '未持久化：存储空间紧张时浏览器可能回收本地数据，建议将本站添加到主屏幕'}
                </div>
              </div>
              <span className={`rounded px-2.5 py-1 text-[11.5px] font-semibold ${
                persisted ? 'bg-success-container/60 text-success' : persisted === false ? 'bg-warning-container text-warning' : 'bg-surface-container text-outline'
              }`}>
                {persisted === null ? '读取中' : persisted ? '● Already Active' : '○ 未授予'}
              </span>
            </div>
          </Section>

          <Section icon="warning" title="危险区 (Danger Zone)" desc="以下操作不可逆，云端同步核心数据不受影响">
            <div className="flex items-center gap-4 rounded-xl border border-danger/30 bg-danger-container/30 px-5 py-4">
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold text-danger">清空本地缓存 (Clear Local Cache)</div>
                <div className="mt-0.5 text-[11.5px] text-on-surface-variant">
                  彻底重置本地 IndexedDB 数据库并重新写入演示种子，用于恢复出厂演示状态。
                </div>
              </div>
              <Button variant="danger" size="sm" onClick={resetAll} disabled={resetting}>
                {resetting ? '清空中…' : '清空所有数据'}
              </Button>
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

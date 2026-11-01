import { useRef, useState } from 'react'
import { Section, Toggle, Segmented, toCsv, blobToDataUrl } from './settingsUi'
import { Button } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import { useToast } from '@/design-system/Toast'
import { resetLocalData, restoreFromJson, focusSessionRepo } from '@/repositories/localAdmin'
import {
  workspaceRepo,
  customerRepo,
  interactionRepo,
  ledgerRepo,
  transactionRepo,
  todoRepo,
  noteRepo,
  quickNoteRepo,
  habitRepo,
  habitLogRepo,
  trophyRepo,
  attachmentRepo,
  todoListRepo,
  noteFolderRepo,
  projectRepo,
  projectMilestoneRepo,
  linkRepo,
} from '@/repositories'
import { downloadBlob, downloadText } from '@/shared/download'
import { moduleConfigRepo } from '@/repositories'
import { migrateLegacyTodoPriority } from '@/modules/todo/backfill'
import type { Settings } from '@/db/types'
import type { Attachment } from '@/db/db'

/**
 * 「数据与安全」tab（**自 SettingsPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 这是设置页最大的一块（约 240 行 JSX + 6 个 handler + 5 个 state）。
 * 拆分要点：**把这 5 个 state 与 6 个 handler 一并搬过来** ——
 * 它们只服务本 tab（`exporting/importing/migratingPriority/resetting/persisted`
 * 在主组件里没有任何其它消费者），搬走后主组件不再持有这些无关状态。
 *
 * 跨组件的两点依赖由 props 注入：
 * - `save` / `settings`：设置读写（主组件持有，多处共用）；
 * - `askConfirm`：确认弹窗（主组件统一管理 pendingConfirm，见其实现）。
 *
 * 语义与拆分前逐行一致（仅移动代码 + 补齐 import + 把 handler 改为组件内定义）。
 */
export function SecurityTab({
  settings,
  save,
  askConfirm,
  persisted,
  onPersistedChange,
}: {
  settings: Settings
  save: (patch: Partial<Omit<Settings, 'key'>>) => void
  /** 本地存储持久化状态：**共享自父组件**（父组件 useEffect 也在探测它，本组件在申请授权时更新它） */
  persisted: boolean | null
  onPersistedChange: (v: boolean | null) => void
  askConfirm: (opts: {
    title: string
    message: string
    confirmText?: string
    danger?: boolean
    run: () => void
  }) => void
}) {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [migratingPriority, setMigratingPriority] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  // ── 数据导出：全部业务表走 repository.list 汇总；附件 Blob 转 base64 dataUrl、专注会话随档 ──
  const exportJson = async () => {
    setExporting(true)
    try {
      const [
        workspaces,
        customers,
        interactions,
        ledgers,
        transactions,
        todos,
        notes,
        quickNotes,
        habits,
        habitLogs,
        trophies,
        attachments,
        focusSessions,
        todoLists,
        noteFolders,
        projects,
        projectMilestones,
        moduleConfigs,
        links,
      ] = await Promise.all([
        workspaceRepo.list(),
        customerRepo.list(),
        interactionRepo.list(),
        ledgerRepo.list(),
        transactionRepo.list(),
        todoRepo.list(),
        noteRepo.list(),
        quickNoteRepo.list(),
        habitRepo.list(),
        habitLogRepo.list(),
        trophyRepo.list(),
        attachmentRepo.list(),
        focusSessionRepo.list(),
        todoListRepo.list(),
        noteFolderRepo.list(),
        projectRepo.list(),
        projectMilestoneRepo.list(),
        moduleConfigRepo.list(),
        linkRepo.list(),
      ])
      const attachmentRows = await Promise.all(
        attachments.map(async ({ blob, ...meta }: Attachment) => ({
          ...meta,
          dataUrl: await blobToDataUrl(blob),
        })),
      )
      const payload = {
        app: 'nexus-workspace',
        schemaVersion: 4,
        exportedAt: new Date().toISOString(),
        data: {
          workspaces,
          customers,
          interactions,
          ledgers,
          transactions,
          todos,
          notes,
          quickNotes,
          habits,
          habitLogs,
          trophies,
          attachments: attachmentRows,
          focusSessions,
          todoLists,
          noteFolders,
          projects,
          projectMilestones,
          moduleConfigs,
          links,
        },
      }
      downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        `nexus-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`,
      )
    } finally {
      setExporting(false)
    }
  }

  // ── 数据导出：CSV 表格包 —— 交易平表 + 客户档案两张表，各自带 BOM 下载 ──
  const exportCsv = async () => {
    setExporting(true)
    try {
      const [txns, ledgers, customers] = await Promise.all([
        transactionRepo.list(),
        ledgerRepo.list(),
        customerRepo.list(),
      ])
      const currencyOf = new Map(ledgers.map((l) => [l.id, l.currency]))
      const date = (ts: number) => new Date(ts).toLocaleDateString('zh-CN')
      const stamp = new Date().toISOString().slice(0, 10)
      const txnCsv = toCsv(
        ['日期', '类型', '金额', '币种', '渠道', '摘要', '状态', '标签'],
        txns.map((t) => [
          date(t.occurredAt),
          t.type === 'income' ? '收入' : '支出',
          t.amount,
          currencyOf.get(t.ledgerId) ?? '',
          t.channel,
          t.summary,
          t.status,
          t.tags.join(';'),
        ]),
      )
      downloadText(txnCsv, 'text/csv;charset=utf-8', `nexus-transactions-${stamp}.csv`)
      const custCsv = toCsv(
        ['姓名', '公司', '电话', '微信', '邮箱', '健康分'],
        customers.map((c) => [
          c.name,
          c.company,
          c.phone,
          c.wechat,
          c.email,
          c.intimacy?.level ?? '',
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
      askConfirm({
        title: '恢复 JSON 存档',
        message:
          '存档解析成功。将逐表写回本地数据库，与现有记录同 id 的会被存档内容覆盖，确定恢复？',
        confirmText: '确定恢复',
        run: () => {
          void (async () => {
            try {
              const count = await restoreFromJson(parsed)
              toast.success(`已恢复 ${count} 条记录，界面即将刷新`)
              window.setTimeout(() => window.location.reload(), 600)
            } catch (err) {
              console.error('[settings] JSON 恢复失败', err)
              toast.error(`恢复失败：${err instanceof Error ? err.message : '文件解析错误'}`)
            } finally {
              setImporting(false)
            }
          })()
        },
      })
    } catch (err) {
      console.error('[settings] JSON 恢复失败', err)
      toast.error(`恢复失败：${err instanceof Error ? err.message : '文件解析错误'}`)
      setImporting(false)
    }
  }

  /**
   * 待办优先级档位迁移（Issue #148 后续 · 上轮审计建议 4）。
   *
   * 老数据 `P1/P2/P3` 读侧已被 `normalizeTodoPriority` 兜住，功能上不缺；
   * 这里做的是**把口径漂移清掉**（库里不再同时存在两套档位写法）。刻意做成显式动作
   * 而非启动自动迁移：自动改写会推进老记录 `rev`，破坏跨设备同步的 LWW 判据。
   */
  const migrateTodoPriority = () => {
    askConfirm({
      title: '迁移待办优先级档位',
      message:
        '把存量待办里的旧档位 P1/P2/P3 归一化为高/中/低，并写入同步队列。已是新档位的记录不会被改动，可重复执行。确定继续？',
      confirmText: '开始迁移',
      run: () => {
        setMigratingPriority(true)
        void migrateLegacyTodoPriority()
          .then((n) => {
            toast.success(n > 0 ? `已迁移 ${n} 条待办的优先级档位` : '没有需要迁移的待办')
            setMigratingPriority(false)
          })
          .catch((err) => {
            console.error('[settings] 优先级迁移失败', err)
            toast.error(`迁移失败：${err instanceof Error ? err.message : '未知错误'}`)
            setMigratingPriority(false)
          })
      },
    })
  }

  // ── 危险区：清空本地数据（不写演示种子，清完就是空库） ──
  const resetAll = () => {
    askConfirm({
      title: '清空本地数据',
      message:
        '将清空本地全部数据（IndexedDB），云端副本不受影响。清空后是空库，不会再自动写入演示数据。该操作不可撤销，确定继续？',
      danger: true,
      confirmText: '清空',
      run: () => {
        setResetting(true)
        void resetLocalData()
          .then(() => window.location.reload())
          .catch((err) => {
            console.error('[settings] 清空失败', err)
            setResetting(false)
          })
      },
    })
  }
  const [restoring, setRestoring] = useState(false)

  // ── 危险区：以服务端为准（本地清空 → 从同步中心全量拉回）──
  // 为什么需要它：本项目是 Local-First，本地库是渲染的数据源，服务端只是多端汇聚点。
  // 于是「服务端已经清空 / 另一端删过东西」时，本地旧数据不会自己消失 —— 用户需要一次
  // 显式对齐，否则会一直看到早已不存在于云端的记录，并误以为清理没生效。
  // 安全性：resetLocalData() 自带守卫（有未推送变更先尝试推送，推不成功就抛错中止），
  // 所以不会在离线时把唯一副本抹掉。
  const restoreFromServer = () => {
    askConfirm({
      title: '以服务端为准',
      message:
        '本地数据将被清空，随后从同步中心重新拉取全量数据。用于「本地与云端不一致」或「换设备」。未推送的变更会先尝试上传，失败则中止（不会丢数据）。确定继续？',
      danger: true,
      confirmText: '覆盖本地',
      run: () => {
        setRestoring(true)
        void (async () => {
          const { isSyncConfigured } = await import('@/sync/pocketbaseAdapter')
          if (!(await Promise.resolve(isSyncConfigured()))) throw new Error('尚未配置同步中心')
          if (!navigator.onLine) throw new Error('当前离线，无法从服务端拉取')
          await resetLocalData()
          const { syncEngine } = await import('@/sync/engine')
          await syncEngine.syncNow('server-override')
          window.location.reload()
        })().catch((err: unknown) => {
          console.error('[settings] 以服务端为准失败', err)
          setRestoring(false)
        })
      },
    })
  }
  return (
        <div className="anim-enter space-y-4">
          <Section
            icon="archive"
            title="数据导出与多格式打包"
          >
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  icon: 'data_object',
                  tag: 'SNAPSHOT',
                  title: 'JSON 全量结构化存档',
                  desc: '完整流水表结构：CRM · 客户档案 · 财务流水 · 笔记关联关系',
                  action: exportJson,
                  label: exporting ? '导出中…' : '导出 JSON 存档',
                  variant: 'primary' as const,
                },
                {
                  icon: 'table_view',
                  tag: 'SPREADSHEET',
                  title: 'CSV 电子表格格式包',
                  desc: '交易平表与客户档案两张表，带 BOM 兼容 Excel / Numbers / 飞书表格',
                  action: exportCsv,
                  label: '导出 CSV 表格包',
                  variant: 'ghost' as const,
                },
                {
                  icon: 'article',
                  tag: 'MARKDOWN',
                  title: 'Markdown 树文本笔记',
                  desc: '全部笔记 Markdown 源文件可导出 .zip 归档（当前为合并 .md）',
                  action: exportNotesMd,
                  label: '导出笔记文档包',
                  variant: 'ghost' as const,
                },
              ].map((c) => (
                <div
                  key={c.title}
                  className="surface-card-xl !bg-transparent border-outline-variant/50 p-4"
                >
                  <div className="flex items-center justify-between">
                    <Icon name={c.icon} className="text-[1.4286rem] text-primary" />
                    <span className="text-[0.6786rem] font-bold uppercase tracking-widest text-outline">
                      {c.tag}
                    </span>
                  </div>
                  <div className="mt-2 text-[0.9286rem] font-semibold">{c.title}</div>
                  <p className="mt-1 line-clamp-2 text-[0.7857rem] leading-snug text-on-surface-variant">
                    {c.desc}
                  </p>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant={c.variant}
                      onClick={() => void c.action()}
                      disabled={exporting}
                    >
                      {c.label}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* 导入迁移：JSON 存档恢复 */}
            <div className="mt-3 flex items-center gap-4 surface-card-low rounded-xl/60 px-5 py-4">
              <div className="flex-1">
                <div className="text-[0.9643rem] font-semibold">从 JSON 存档恢复（导入迁移）</div>
                <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                  选择此前导出的 JSON 存档，逐表写回本地数据库；与现有记录同 id
                  的将被覆盖，恢复后自动刷新界面。
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

          <Section
            icon="settings_backup_restore"
            title="本地数据持久化状态"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="text-[0.9643rem] font-medium">高性能本地持久化 (IndexedDB)</div>
                <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                  {persisted === null
                    ? '正在读取浏览器存储持久化状态…'
                    : persisted
                      ? '已持久化：浏览器承诺不自动回收本地数据库（离线写入与附件均安全保留）'
                      : '未持久化：存储空间紧张时浏览器可能回收本地数据，建议将本站添加到主屏幕'}
                </div>
              </div>
              <span
                className={`mr-4 rounded px-2.5 py-1 text-[0.8214rem] font-semibold ${
                  persisted
                    ? 'bg-success-container/60 text-success'
                    : persisted === false
                      ? 'bg-warning-container text-warning'
                      : 'bg-surface-container text-outline'
                }`}
              >
                {persisted === null ? '读取中' : persisted ? '● Already Active' : '○ 未授予'}
              </span>
              <Toggle
                checked={settings.security.persistCache}
                onChange={(v) => {
                  if (v && navigator.storage?.persist) {
                    // 先向浏览器申请持久化授权，按实际授予结果落库
                    void navigator.storage
                      .persist()
                      .then((granted) => {
                        onPersistedChange(granted)
                        save({ security: { ...settings.security, persistCache: true } })
                      })
                      .catch(() => save({ security: { ...settings.security, persistCache: true } }))
                  } else {
                    // 浏览器无主动撤销 persist 的 API：仅记录偏好，重置需清空站点数据
                    save({ security: { ...settings.security, persistCache: false } })
                  }
                }}
              />
            </div>
          </Section>

          <Section
            icon="security"
            title="端侧加密与同步策略"
            desc="偏好即刻持久化保存；端侧加密与同步频率的真实生效通道随同步引擎迭代接入"
            badge="即将生效"
          >
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <div className="flex-1">
                <div className="text-[0.9643rem] font-medium">端侧数据加密 (AES-256-GCM)</div>
                <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                  开启后本地数据库敏感字段将加密落盘，密钥驻留本机不上传
                </div>
              </div>
              <span className="mr-4 rounded bg-warning-container px-2 py-0.5 text-[0.75rem] font-medium text-warning">
                即将生效
              </span>
              <Toggle
                checked={settings.security.encryption}
                onChange={(v) => save({ security: { ...settings.security, encryption: v } })}
              />
            </div>
            <div className="flex items-center justify-between pt-4">
              <div className="flex-1">
                <div className="text-[0.9643rem] font-medium">同步频率</div>
                <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                  云端同步的自动触发节奏（当前引擎为写入防抖 + 30s 心跳）
                </div>
              </div>
              <span className="mr-4 rounded bg-warning-container px-2 py-0.5 text-[0.75rem] font-medium text-warning">
                即将生效
              </span>
              <Segmented
                options={['realtime', '5min', 'manual'] as const}
                value={settings.security.syncFrequency}
                format={(v) => (v === 'realtime' ? '实时' : v === '5min' ? '每 5 分钟' : '手动')}
                onChange={(v) => save({ security: { ...settings.security, syncFrequency: v } })}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[0.9286rem] font-medium">回收站保留期</div>
                <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                  到期自动彻底删除，含「冲突删除」分组。改小保留期会立刻作用于已有条目。
                </div>
              </div>
              <Segmented
                options={['7', '15', '30'] as const}
                value={String(settings.security.trashRetentionDays ?? 30) as '7' | '15' | '30'}
                format={(v) => `${v} 天`}
                onChange={(v) =>
                  save({ security: { ...settings.security, trashRetentionDays: Number(v) as 7 | 15 | 30 } })
                }
              />
            </div>
          </Section>

          <Section
            icon="healing"
            title="口径迁移与数据自愈"
            desc="把历史数据的旧写法归一化到当前口径；均为幂等动作，可重复执行"
          >
            <div className="flex items-center gap-4 rounded-xl border border-outline-variant/50 px-5 py-4">
              <div className="flex-1">
                <div className="text-[0.9643rem] font-medium">待办优先级档位迁移</div>
                <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                  把 P1/P2/P3 旧档位写成高/中/低四档。读侧已兼容旧值，迁移只是清掉库内两套写法；
                  已是新档位的记录不动、不入同步队列。
                </div>
              </div>
              <Button
                size="sm"
                variant="tonal"
                onClick={migrateTodoPriority}
                disabled={migratingPriority}
              >
                {migratingPriority ? '迁移中…' : '开始迁移'}
              </Button>
            </div>
          </Section>

          <Section
            icon="warning"
            title="危险区 (Danger Zone)"
            desc="以下操作不可逆，云端同步核心数据不受影响"
          >
            <div className="flex items-center gap-4 rounded-xl border border-danger/30 bg-danger-container/30 px-5 py-4">
              <div className="flex-1">
                <div className="text-[0.9643rem] font-semibold text-danger">
                  清空本地缓存 (Clear Local Cache)
                </div>
                <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                  清空本地 IndexedDB 数据库（不写入任何演示数据），清完就是一个空库。此操作不可撤销。
                </div>
              </div>
              <Button variant="danger" size="sm" onClick={resetAll} disabled={resetting}>
                {resetting ? '清空中…' : '清空所有数据'}
              </Button>
            </div>

            <div className="mt-3 flex items-center gap-4 rounded-xl border border-outline-variant/60 px-5 py-4">
              <div className="flex-1">
                <div className="text-[0.9643rem] font-semibold">以服务端为准 (Restore From Server)</div>
                <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
                  清空本地库后从同步中心重新拉取全量数据。用于本地与云端不一致、或换设备。
                  未推送的变更会先尝试上传，失败即中止。
                </div>
              </div>
              <Button variant="tonal" size="sm" onClick={restoreFromServer} disabled={restoring}>
                {restoring ? '对齐中…' : '覆盖本地'}
              </Button>
            </div>
          </Section>
        </div>
  )
}

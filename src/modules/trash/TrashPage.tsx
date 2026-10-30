import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import dayjs from 'dayjs'
import { db } from '@/db/db'
import { Icon } from '@/design-system/Icon'
import { Button, Card, Chip, ConfirmDialog, EmptyState, PageHeader, inputCls } from '@/design-system/ui'
import { useToast } from '@/design-system/Toast'
import {
  TRASH_TABLE_LABEL,
  listTrash,
  purgeAllTrash,
  purgeTrashRecord,
  restoreTrashRecord,
  type TrashItem,
} from '@/repositories/trash'

type FilterKey =
  | 'all'
  | 'customers'
  | 'transactions'
  | 'todos'
  | 'notes'
  | 'projects'
  | 'habits'
  | 'other'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'customers', label: '客户' },
  { key: 'transactions', label: '财务' },
  { key: 'todos', label: '待办' },
  { key: 'notes', label: '笔记' },
  { key: 'projects', label: '项目' },
  { key: 'habits', label: '习惯' },
  { key: 'other', label: '其他' },
]

function categoryOf(item: TrashItem): FilterKey {
  switch (item.table) {
    case 'customers':
    case 'interactions':
    case 'customerGroups':
      return 'customers'
    case 'transactions':
    case 'ledgers':
    case 'attachments':
      return 'transactions'
    case 'todos':
    case 'todoLists':
      return 'todos'
    case 'notes':
    case 'noteFolders':
      return 'notes'
    case 'projects':
    case 'projectMilestones':
      return 'projects'
    case 'habits':
    case 'habitLogs':
      return 'habits'
    default:
      return 'other'
  }
}

function iconOf(item: TrashItem): string {
  switch (item.table) {
    case 'customers':
    case 'interactions':
    case 'customerGroups':
      return 'group'
    case 'transactions':
    case 'ledgers':
    case 'attachments':
      return 'account_balance_wallet'
    case 'todos':
    case 'todoLists':
      return 'check_circle'
    case 'notes':
    case 'noteFolders':
      return 'description'
    case 'projects':
    case 'projectMilestones':
      return 'hub'
    case 'habits':
    case 'habitLogs':
      return 'local_fire_department'
    default:
      return 'settings_backup_restore'
  }
}

const DAY = 24 * 60 * 60 * 1000
/**
 * 保留期兜底值。**实际值读设置** `security.trashRetentionDays`（7/15/30，默认 30）。
 * 2026-10-30 之前这里是写死的常量，只用于展示、且没有任何执行者 —— 展示与行为必须是同一来源，
 * 否则「设置里改成 7 天」和「界面显示剩余 30 天」会当面打架。
 */
const FALLBACK_RETENTION_DAYS = 30
const EMPTY: TrashItem[] = []

function remainingDays(item: TrashItem, retentionDays: number): number {
  return Math.max(0, Math.ceil((retentionDays * DAY - (Date.now() - item.deletedAt)) / DAY))
}

function keyOf(item: TrashItem): string {
  return `${item.table}:${item.id}`
}

export default function TrashPage() {
  const toast = useToast()
  const queried = useLiveQuery(() => listTrash(), [])
  const items = queried ?? EMPTY
  /** 保留期与「冲突删除」批次都来自本地库：前者是设置项，后者是对账写的本地表 */
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const retentionDays = settings?.security?.trashRetentionDays ?? FALLBACK_RETENTION_DAYS
  const batches = useLiveQuery(() => db.trashBatches.orderBy('createdAt').reverse().toArray(), [], [])
  const [activeBatch, setActiveBatch] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [keyword, setKeyword] = useState('')
  const [confirmItem, setConfirmItem] = useState<TrashItem | null>(null)
  /** 待确认永久删除的条目（与「恢复确认」分开：两者不可逆性完全不同，不能共用弹窗） */
  const [purgeItem, setPurgeItem] = useState<TrashItem | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    // 选中某个「冲突删除」批次时，只看那一批（members 里存的是 table:id）
    const batch = activeBatch ? batches.find((b) => b.id === activeBatch) : undefined
    const inBatch = batch ? new Set(batch.members.map((m) => `${m.table}:${m.id}`)) : null
    return items.filter((i) => {
      if (inBatch && !inBatch.has(keyOf(i))) return false
      if (filter !== 'all' && categoryOf(i) !== filter) return false
      if (!kw) return true
      return [i.title, i.subtitle, i.parentTitle].filter(Boolean).join(' ').toLowerCase().includes(kw)
    })
  }, [items, filter, keyword, activeBatch, batches])

  const roots = useMemo(() => {
    const visibleKeys = new Set(visible.map(keyOf))
    return visible.filter((i) => {
      if (!i.parentTable || !i.parentId) return true
      // 父项已活/已清理/被筛选掉：子项没有可折叠的父行，单独显示
      // （父项已删且父项不在可见集时，canRestore 会给出禁用原因）
      return i.parentAlive === true || !visibleKeys.has(`${i.parentTable}:${i.parentId}`)
    })
  }, [visible])
  const childrenOf = (root: TrashItem) =>
    visible.filter((i) => i.parentTable === root.table && i.parentId === root.id)

  const doRestore = async (item: TrashItem) => {
    setBusy(keyOf(item))
    try {
      const result = await restoreTrashRecord(item.table, item.id)
      const parts = [`已恢复 ${result.restored} 条记录`]
      if (result.rebuiltLinks) parts.push(`重建 ${result.rebuiltLinks} 条关联`)
      if (result.skippedLinks) parts.push(`${result.skippedLinks} 条关联未恢复`)
      // 关联层（links 表记录）随实体复活的计数；Phase 1 无写入方，常态为 0
      if (result.revivedCascadeLinks) parts.push(`恢复 ${result.revivedCascadeLinks} 条跨模块关联`)
      toast.success(parts.join('，'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setBusy(null)
      setConfirmItem(null)
    }
  }

  const onRestore = (item: TrashItem) => {
    if (!item.canRestore) return
    if (item.childCount > 0 || item.linkCount > 0) {
      setConfirmItem(item)
      return
    }
    void doRestore(item)
  }

  /**
   * 永久删除：物理删除，不可恢复。
   *
   * 失败一定是**有原因且可操作**的（最常见是「删除还没同步到服务器」—— 此时本地一条都没删，
   * 用户联网后重试即可）。所以原样把错误文案透出，不吞成「删除失败」。
   */
  const doPurge = async (item: TrashItem) => {
    setBusy(keyOf(item))
    try {
      const result = await purgeTrashRecord(item.table, item.id)
      toast.success(
        result.purged > 1 ? `已永久删除 ${result.purged} 条记录` : '已永久删除，不可恢复',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '永久删除失败')
    } finally {
      setBusy(null)
      setPurgeItem(null)
    }
  }

  const doPurgeAll = async () => {
    setClearing(true)
    try {
      const result = await purgeAllTrash()
      toast.success(`已永久删除 ${result.purged} 条记录`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空回收站失败')
    } finally {
      setClearing(false)
      setConfirmEmpty(false)
    }
  }

  const renderRow = (item: TrashItem, nested = false) => {
    const busyThis = busy === keyOf(item)
    return (
      <div
        key={keyOf(item)}
        className={`flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover-low ${
          nested ? 'ml-7 border-l border-outline-variant/50 pl-4' : ''
        }`}
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container-low text-outline">
          <Icon name={iconOf(item)} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[0.9643rem] font-medium">{item.title}</span>
            <Chip tone="gray">{TRASH_TABLE_LABEL[item.table]}</Chip>
            {item.childCount > 0 && <Chip tone="blue">含 {item.childCount} 条子记录</Chip>}
            {item.linkCount > 0 && <Chip tone="amber">{item.linkCount} 条关联</Chip>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8214rem] text-on-surface-variant">
            <span>删除于 {dayjs(item.deletedAt).format('YYYY-MM-DD HH:mm')}</span>
            {item.parentTitle && <span>· 所属 {item.parentTitle}</span>}
            {item.canRestore && <span>· 剩余 {remainingDays(item, retentionDays)} 天</span>}
          </div>
          {!item.canRestore && item.blockedReason && (
            <div className="mt-1 text-[0.7857rem] text-warning">{item.blockedReason}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant={nested ? 'ghost' : 'tonal'}
            icon="settings_backup_restore"
            disabled={!item.canRestore || busyThis}
            onClick={() => onRestore(item)}
          >
            {busyThis ? '处理中…' : '恢复'}
          </Button>
          {/* 永久删除不看 canRestore：父项已被永久删掉的子记录永远无法恢复，必须能清出去 */}
          <Button
            size="sm"
            variant="ghost"
            icon="delete"
            disabled={busyThis || clearing}
            onClick={() => setPurgeItem(item)}
          >
            永久删除
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="回收站"
        actions={
          <>
            <Chip tone="gray" icon="schedule">
              保留期 {retentionDays} 天
            </Chip>
            <Button
              size="sm"
              variant="danger"
              icon="delete"
              disabled={items.length === 0 || clearing}
              onClick={() => setConfirmEmpty(true)}
            >
              {clearing ? '清空中…' : '清空回收站'}
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`rounded-full border px-3 py-1.5 text-[0.8571rem] transition-colors ${
                filter === f.key
                  ? 'border-primary bg-primary-fixed font-medium text-primary'
                  : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/50 hover:text-primary'
              }`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <input
            className={`${inputCls} ml-auto min-w-[180px] max-w-xs`}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题或所属记录"
            aria-label="搜索回收站"
          />
        </div>
      </Card>

      {batches.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-2 text-[0.8571rem] font-medium text-on-surface-variant">
            冲突删除
            <span className="ml-2 font-normal text-outline">
              系统对账发现「服务端已不存在」的记录，已移入回收站，可恢复
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {batches.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`rounded-full border px-3 py-1.5 text-[0.8571rem] transition-colors ${
                  activeBatch === b.id
                    ? 'border-primary bg-primary-fixed font-medium text-primary'
                    : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/50 hover:text-primary'
                }`}
                onClick={() => setActiveBatch(activeBatch === b.id ? null : b.id)}
              >
                {b.label}（{b.members.length} 条）
              </button>
            ))}
          </div>
        </Card>
      )}

      {roots.length === 0 ? (
        <EmptyState
          icon="settings_backup_restore"
          title={items.length === 0 ? '回收站是空的' : '没有符合条件的记录'}
          description={
            items.length === 0
              ? '删除的客户、流水、待办、笔记、项目与习惯会出现在这里'
              : '换个筛选条件或关键词再试'
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-outline-variant/30">
            {roots.map((item) => (
              <div key={keyOf(item)}>
                {renderRow(item)}
                {childrenOf(item).map((child) => renderRow(child, true))}
              </div>
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!confirmItem}
        title="恢复这条记录？"
        message={
          confirmItem
            ? `将恢复「${confirmItem.title}」${
                confirmItem.childCount ? ` 及 ${confirmItem.childCount} 条子记录` : ''
              }${
                confirmItem.linkCount ? `，并尝试重建 ${confirmItem.linkCount} 条关联` : ''
              }。目标已删除的关联会跳过。`
            : ''
        }
        confirmText="恢复"
        onConfirm={() => {
          if (confirmItem) void doRestore(confirmItem)
        }}
        onCancel={() => setConfirmItem(null)}
      />

      <ConfirmDialog
        open={!!purgeItem}
        danger
        title="永久删除这条记录？"
        message={
          purgeItem
            ? `将彻底删除「${purgeItem.title}」${
                purgeItem.childCount ? ` 及 ${purgeItem.childCount} 条子记录` : ''
              }。删除后无法恢复，也不会进入回收站。其他设备会在下次同步时一并消失；超过 30 天未联网的设备可能仍留旧副本。`
            : ''
        }
        confirmText="确认永久删除"
        onConfirm={() => {
          if (purgeItem) void doPurge(purgeItem)
        }}
        onCancel={() => setPurgeItem(null)}
      />

      <ConfirmDialog
        open={confirmEmpty}
        danger
        title="清空回收站？"
        message={`将彻底删除回收站中的全部 ${items.length} 条记录（含折叠显示的子记录）。删除后无法恢复；其他设备会在下次同步时一并消失。`}
        confirmText="清空"
        onConfirm={() => void doPurgeAll()}
        onCancel={() => setConfirmEmpty(false)}
      />
    </div>
  )
}

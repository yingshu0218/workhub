import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCollection, useRecord } from '@/queries/hooks'
import type { Customer, Ledger, Todo, Transaction } from '@/db/types'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Drawer,
  EmptyState,
  PageHeader,
  inputCls,
} from '@/design-system/ui'
import dayjs from 'dayjs'
import { todoStatusLabel } from '@/modules/todo/domain'
import { todoPriorityLabel } from '@/modules/todo/priority'
import LedgerFormDrawer from './LedgerFormDrawer'
import TransactionFormDrawer from './TransactionFormDrawer'
import { txnCustomerIds, txnTodoIds } from './links'
import {
  useAttachmentCount,
  useTransactionAttachments,
  deleteTransactionCascade,
  reorderLedgers,
} from './hooks'
import { ledgerRepo, transactionRepo } from '@/repositories'

type TypeFilter = 'all' | 'income' | 'expense'
type StatusFilter = 'all' | '已结算' | '待对账'

/** 流水客户端分页每页条数 */
const PAGE_SIZE = 20

/** 币种 → 符号映射（未登记币种回落 ¥） */
const CURRENCY_SYMBOLS: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€' }
const symbolOf = (currency: string | undefined) => CURRENCY_SYMBOLS[currency ?? 'CNY'] ?? '¥'

const fmtMoney = (n: number, symbol = '¥') =>
  `${symbol}${Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtSigned = (t: Transaction, symbol = '¥') =>
  `${t.type === 'income' ? '+' : '-'}${fmtMoney(t.amount, symbol)}`

/** 财务中心主页面（对齐原型 03-finance-center） */
export default function FinancePage() {
  const ledgers = useCollection<Ledger>('ledgers')
  const transactions = useCollection<Transaction>('transactions')
  const customers = useCollection<Customer>('customers')
  const [scope, setScope] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [creating, setCreating] = useState(false)
  const [newLedgerOpen, setNewLedgerOpen] = useState(false)
  const [editingLedger, setEditingLedger] = useState<Ledger | null>(null)
  const [ledgerError, setLedgerError] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [dragLedgerId, setDragLedgerId] = useState<string | null>(null)
  // 删除账本确认（应用风格弹窗，替代 window.confirm）
  const [confirmLedger, setConfirmLedger] = useState<Ledger | null>(null)

  // 筛选口径变化时回到第一页
  useEffect(() => {
    setPage(0)
  }, [scope, typeFilter, statusFilter, keyword])

  // 深链定位：/finance?focus=<transactionId>（客户时间线鱼骨穿透入口）——目标流水存在时直接打开详情抽屉
  const [searchParams, setSearchParams] = useSearchParams()
  const focusTxnId = searchParams.get('focus') ?? undefined
  useEffect(() => {
    if (!focusTxnId) return
    if (!transactions.some((t) => t.id === focusTxnId)) return
    setDetailId(focusTxnId)
    setSearchParams({}, { replace: true })
  }, [focusTxnId, transactions, setSearchParams])

  const ledgerMap = new Map(ledgers.map((l) => [l.id, l]))
  // 左侧账本树顺序：sortOrder 升序，旧记录（无 sortOrder）按 createdAt 兜底
  const sortedLedgers = [...ledgers].sort(
    (a, b) => (a.sortOrder ?? a.createdAt) - (b.sortOrder ?? b.createdAt),
  )
  const activeLedger = scope === 'all' ? undefined : ledgerMap.get(scope)
  // 当前口径币种：「全部账本」仅汇总 CNY 账本，按 CNY 展示
  const currency = scope === 'all' ? 'CNY' : (activeLedger?.currency ?? 'CNY')
  const symbol = symbolOf(currency)
  // 当前账本口径下的流水与汇总（统计一律从源记录推导）；全部账本口径仅计 CNY 账本
  const scoped = transactions.filter((t) =>
    scope === 'all'
      ? (ledgerMap.get(t.ledgerId)?.currency ?? 'CNY') === 'CNY'
      : t.ledgerId === scope,
  )
  const scopeNote = scope === 'all' ? ' · 仅 CNY 账本' : ''
  const income = scoped.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = scoped.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const opening =
    scope === 'all'
      ? ledgers
          .filter((l) => (l.currency ?? 'CNY') === 'CNY')
          .reduce((s, l) => s + l.openingBalance, 0)
      : (ledgerMap.get(scope)?.openingBalance ?? 0)
  const net = opening + income - expense
  const pending = scoped.filter((t) => t.status === '待对账')

  /** 删除账本：有未删流水则阻止（useCollection 已过滤软删记录） */
  async function handleDeleteLedger(l: Ledger) {
    setLedgerError('')
    const txnCount = transactions.filter((t) => t.ledgerId === l.id).length
    if (txnCount > 0) {
      setLedgerError(`账本「${l.name}」下仍有 ${txnCount} 笔流水，无法删除`)
      return
    }
    setConfirmLedger(l)
  }

  /** 确认后软删账本并回到「全部」范围 */
  async function doDeleteLedger(l: Ledger) {
    await ledgerRepo.softDelete(l.id)
    setScope('all')
  }

  function handleLedgerDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    if (!dragLedgerId || dragLedgerId === targetId) return
    const ids = sortedLedgers.map((l) => l.id)
    const from = ids.indexOf(dragLedgerId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    void reorderLedgers(ids)
    setDragLedgerId(null)
  }

  const list = scoped
    .filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        const haystack = [t.summary, t.channel, t.tags.join(' ')]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(kw)) return false
      }
      return true
    })
    .sort((a, b) => b.occurredAt - a.occurredAt)

  // 客户端分页：每页 20 条，筛选变化时由 useEffect 重置回第一页
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = list.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="财务中心"
        subtitle="多账本资金流水管控，跨业务凭证溯源与关联追踪"
        actions={
          <>
            <Button icon="payments" onClick={() => setCreating(true)}>
              记一笔
            </Button>
          </>
        }
      />

      {ledgerError && <div className="mb-3 text-[0.8571rem] text-danger">{ledgerError}</div>}

      <div className="flex items-start gap-4">
        {/* 左栏：账本树（全部账本 + 各账本，支持拖拽排序，hover 显示编辑/删除） */}
        <Card className="w-64 shrink-0 self-start p-4">
          <div className="mb-3 flex items-center justify-between text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
            <span>账本（{ledgers.length}）</span>
            <button
              className="rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
              title="新建账本"
              onClick={() => setNewLedgerOpen(true)}
            >
              <Icon name="create_new_folder" size={16} />
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <LedgerNode
              icon="account_balance"
              label="全部账本"
              count={transactions.length}
              active={scope === 'all'}
              onClick={() => {
                setScope('all')
                setLedgerError('')
              }}
            />
            {sortedLedgers.map((l) => (
              <LedgerNode
                key={l.id}
                icon="account_balance_wallet"
                label={l.name}
                count={transactions.filter((t) => t.ledgerId === l.id).length}
                active={scope === l.id}
                draggable
                onDragStart={() => setDragLedgerId(l.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleLedgerDrop(e, l.id)}
                onClick={() => {
                  setScope(l.id)
                  setLedgerError('')
                }}
                actions={
                  <>
                    <button
                      className="rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-primary"
                      title="编辑账本"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingLedger(l)
                      }}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      className="rounded p-0.5 text-outline transition-colors hover:bg-error-container hover:text-error"
                      title="删除账本"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDeleteLedger(l)
                      }}
                    >
                      <Icon name="delete" size={13} />
                    </button>
                  </>
                }
              />
            ))}
          </div>
          <div className="mt-2 text-[0.7857rem] leading-relaxed text-outline">拖动账本可调整排序</div>
        </Card>

        {/* 右侧：汇总 + 流水 */}
        <div className="min-w-0 flex-1">
          {/* 汇总卡 4 张 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryCard
              label={`累计收入${currency !== 'CNY' ? `（${currency}）` : ''}`}
              icon="trending_up"
              iconCls="bg-success-container/60 text-success"
              value={fmtMoney(income, symbol)}
              valueCls="text-success"
              sub={`共 ${scoped.filter((t) => t.type === 'income').length} 笔流入${scopeNote}`}
            />
            <SummaryCard
              label={`累计支出${currency !== 'CNY' ? `（${currency}）` : ''}`}
              icon="trending_down"
              iconCls="bg-danger-container/60 text-danger"
              value={fmtMoney(expense, symbol)}
              valueCls="text-danger"
              sub={`共 ${scoped.filter((t) => t.type === 'expense').length} 笔流出${scopeNote}`}
            />
            <SummaryCard
              label={`净结余${currency !== 'CNY' ? `（${currency}）` : ''}`}
              icon="account_balance"
              iconCls="bg-surface-container-high text-primary"
              value={`${net >= 0 ? '+' : '-'}${fmtMoney(net, symbol)}`}
              valueCls={net < 0 ? 'text-danger' : 'text-primary'}
              sub={`含期初结转 ${fmtMoney(opening, symbol)}${scopeNote}`}
            />
            <div
              className={`card card-hover cursor-pointer p-4 transition-colors ${
                statusFilter === '待对账' ? 'ring-2 ring-warning bg-warning-container/30' : ''
              }`}
              onClick={() => setStatusFilter(statusFilter === '待对账' ? 'all' : '待对账')}
            >
              <div className="flex items-center justify-between">
                <span className="text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
                  待对账核验
                </span>
                <Icon name="fact_check" size={18} className="bg-warning-container text-warning" />
              </div>
              <div className="mt-1 text-[1.5714rem] font-bold tracking-tight text-warning">
                {pending.length}
                <span className="ml-1 text-[0.9286rem] font-normal text-on-surface-variant">
                  笔待确认
                </span>
              </div>
              <div className="mt-0.5 text-[0.7857rem] text-outline">
                {statusFilter === '待对账' ? '已筛选：仅显示待对账流水' : '点击仅查看待对账流水'}
                {scopeNote}
              </div>
            </div>
          </div>

          {/* 筛选工具栏 */}
          <div className="mb-3 mt-5 flex flex-wrap items-center gap-2">
            <Segmented
              options={[
                { key: 'all', label: '全部流水' },
                { key: 'income', label: '仅看收入' },
                { key: 'expense', label: '仅看支出' },
              ]}
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as TypeFilter)}
            />
            <Segmented
              options={[
                { key: 'all', label: '全部状态' },
                { key: '已结算', label: '已结算' },
                { key: '待对账', label: '待对账' },
              ]}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
            />
            <div className="ml-auto w-56">
              <input
                className={inputCls}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="按交易名称、渠道、标签检索…"
              />
            </div>
          </div>

          {/* 流水列表 */}
          {list.length === 0 ? (
            <Card className="p-6">
              <EmptyState
                icon="account_balance_wallet"
                title={ledgers.length === 0 ? '还没有账本' : '没有符合条件的流水'}
                description={
                  ledgers.length === 0
                    ? '点击左栏「+」新建账本开始记账'
                    : '调整筛选条件，或点「记一笔」新增流水'
                }
              />
            </Card>
          ) : (
            <Card className="divide-y divide-outline-variant/30 px-5">
              {pageItems.map((t) => (
                <TransactionRow
                  key={t.id}
                  txn={t}
                  ledger={ledgerMap.get(t.ledgerId)}
                  customers={customers.filter((c) => txnCustomerIds(t).includes(c.id))}
                  showLedger={scope === 'all'}
                  onOpen={() => setDetailId(t.id)}
                />
              ))}
            </Card>
          )}
          {list.length > 0 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-[0.9286rem] text-on-surface-variant">
              <Button
                size="sm"
                variant="tonal"
                icon="chevron_left"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                上一页
              </Button>
              <span className="text-outline">
                共 {list.length} 条 · 第 {safePage + 1} / {pageCount} 页
              </span>
              <Button
                size="sm"
                variant="tonal"
                icon="chevron_right"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      </div>

      <TransactionFormDrawer
        open={creating}
        defaultLedgerId={scope}
        onClose={() => setCreating(false)}
      />
      <LedgerFormDrawer
        open={newLedgerOpen || editingLedger !== null}
        editLedger={editingLedger}
        onClose={() => {
          setNewLedgerOpen(false)
          setEditingLedger(null)
        }}
      />
      <TransactionDetailDrawer transactionId={detailId} onClose={() => setDetailId(null)} />

      {/* 删除账本确认（应用风格弹窗，替代 window.confirm） */}
      <ConfirmDialog
        open={confirmLedger !== null}
        title={`确认删除账本「${confirmLedger?.name ?? ''}」？`}
        danger
        confirmText="删除"
        message="删除后可在同步层恢复前撤销。"
        onCancel={() => setConfirmLedger(null)}
        onConfirm={() => {
          const target = confirmLedger
          setConfirmLedger(null)
          if (target) void doDeleteLedger(target)
        }}
      />
    </div>
  )
}

/** 左栏账本树节点（对齐笔记页 TreeNode：hover 出操作钮，计数随 hover 隐藏） */
function LedgerNode({
  icon,
  label,
  count,
  active,
  onClick,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  actions,
}: {
  icon: string
  label: string
  count: number
  active: boolean
  onClick: () => void
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  actions?: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.9286rem] transition-colors ${
        active
          ? 'bg-primary-fixed font-semibold text-primary'
          : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
      }`}
    >
      {draggable && (
        <span
          className="cursor-grab text-[1rem] leading-none text-outline/60 group-hover:text-outline"
          title="拖动排序"
        >
          ⠿
        </span>
      )}
      <Icon name={icon} size={16} className={active ? 'text-primary' : 'text-outline'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {actions && (
        <span
          className="hidden items-center gap-0.5 group-hover:flex"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </span>
      )}
      <span className="shrink-0 text-[0.7857rem] text-outline group-hover:hidden">{count}</span>
      {actions && (
        <span className="hidden shrink-0 text-[0.7857rem] text-outline group-hover:hidden">{count}</span>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  icon,
  iconCls,
  value,
  valueCls,
  sub,
}: {
  label: string
  icon: string
  iconCls: string
  value: string
  valueCls: string
  sub: string
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
          {label}
        </span>
        <Icon
          name={icon}
          className={`flex h-8 w-8 items-center justify-center rounded-xl ${iconCls}`}
          size={18}
        />
      </div>
      <div className={`mt-1 text-[1.5714rem] font-bold tracking-tight ${valueCls}`}>{value}</div>
      <div className="mt-0.5 text-[0.7857rem] text-outline">{sub}</div>
    </Card>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-surface-container p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-3 py-1.5 text-[0.9286rem] transition-colors ${
            value === o.key
              ? 'bg-surface-container-lowest font-semibold text-primary shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function TransactionRow({
  txn,
  ledger,
  customers,
  showLedger,
  onOpen,
}: {
  txn: Transaction
  ledger: Ledger | undefined
  /** 多关联（Issue #140）：一笔流水可挂多个客户，逐个出芯片 */
  customers: Customer[]
  showLedger: boolean
  onOpen: () => void
}) {
  // 每行独立计数 Hook：count() 只走索引计数，不反序列化 Blob
  const attCount = useAttachmentCount(txn.id)
  const symbol = symbolOf(ledger?.currency)
  const isIncome = txn.type === 'income'
  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer items-start gap-3 px-2 py-3.5 transition-colors hover:bg-surface-container-low/40"
    >
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          isIncome ? 'bg-success-container/60 text-success' : 'bg-danger-container/60 text-danger'
        }`}
      >
        <Icon name={isIncome ? 'call_received' : 'call_made'} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[1rem] font-medium">{txn.summary}</span>
          {showLedger && ledger && <Chip tone={isIncome ? 'blue' : 'gray'}>{ledger.name}</Chip>}
        </div>
        <div className="mt-0.5 text-[0.8571rem] text-outline">
          {dayjs(txn.occurredAt).format('YYYY-MM-DD')} · {txn.channel || '—'}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {txn.tags.map((tag) => (
            <Chip key={tag} tone="gray">
              #{tag}
            </Chip>
          ))}
          {customers.map((c) => (
            <Chip key={c.id} tone="blue" icon="person">
              {c.company} · {c.name}
            </Chip>
          ))}
          {attCount > 0 && (
            <Chip tone="gray" icon="attach_file">
              {attCount}
            </Chip>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={`text-[1.0714rem] font-bold tracking-tight ${isIncome ? 'text-success' : 'text-danger'}`}
        >
          {fmtSigned(txn, symbol)}
        </span>
        <Chip
          tone={txn.status === '已结算' ? 'green' : 'amber'}
          icon={txn.status === '已结算' ? 'check_circle' : 'fact_check'}
        >
          {txn.status}
        </Chip>
      </div>
    </div>
  )
}

function downloadAttachment(a: { name: string; blob: Blob }) {
  const url = URL.createObjectURL(a.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = a.name
  link.click()
  URL.revokeObjectURL(url)
}

/** 凭证详情抽屉：完整字段 + 附件下载 + 关联业务溯源 + 状态流转与编辑 */
function TransactionDetailDrawer({
  transactionId,
  onClose,
}: {
  transactionId: string | null
  onClose: () => void
}) {
  const txn = useRecord<Transaction>('transactions', transactionId ?? undefined)
  const ledgers = useCollection<Ledger>('ledgers')
  const customers = useCollection<Customer>('customers')
  const todos = useCollection<Todo>('todos')
  const attachments = useTransactionAttachments(transactionId ?? undefined)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  // 删除流水确认（应用风格弹窗，替代 window.confirm）
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ledger = ledgers.find((l) => l.id === txn?.ledgerId)
  // 多关联（Issue #140）：溯源区按数组逐个列出（失效 id 自然被 find 过滤掉）
  const linkedCustomers = txn ? customers.filter((c) => txnCustomerIds(txn).includes(c.id)) : []
  const linkedTodos = txn ? todos.filter((t) => txnTodoIds(txn).includes(t.id)) : []
  const hasLinks = linkedCustomers.length > 0 || linkedTodos.length > 0
  const symbol = symbolOf(ledger?.currency)

  /** 状态流转：以旧记录为基底，仅覆盖 status */
  async function changeStatus(status: Transaction['status']) {
    if (!txn) return
    await transactionRepo.put({ ...txn, status })
  }

  /** 删除此笔流水：级联软删其全部附件存根，成功后关闭抽屉 */
  function handleDelete() {
    if (!txn) return
    setConfirmDelete(true)
  }

  /** 确认后级联软删流水及其附件存根，并关闭抽屉 */
  async function doDelete() {
    if (!txn) return
    await deleteTransactionCascade(txn.id)
    setEditing(false)
    onClose()
  }

  return (
    <Drawer
      open={transactionId !== null && !editing}
      title="财务流水凭证详情"
      onClose={onClose}
      width={460}
    >
      {!txn ? null : (
        <div className="space-y-5">
          {/* 金额主卡 */}
          <div
            className={`rounded-xl p-4 ${
              txn.type === 'income' ? 'bg-success-container/40' : 'bg-danger-container/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[0.8571rem] font-medium text-on-surface-variant">
                {txn.type === 'income' ? '收入入账' : '支出出账'}（{ledger?.currency ?? 'CNY'}）
              </span>
              <Chip
                tone={txn.status === '已结算' ? 'green' : 'amber'}
                icon={txn.status === '已结算' ? 'check_circle' : 'fact_check'}
              >
                {txn.status}
              </Chip>
            </div>
            <div
              className={`mt-1 text-[2rem] font-bold tracking-tight ${
                txn.type === 'income' ? 'text-success' : 'text-danger'
              }`}
            >
              {fmtSigned(txn, symbol)}
            </div>
            <div className="mt-1 text-[0.9286rem] font-medium">{txn.summary}</div>
          </div>

          {/* 状态流转 + 编辑 + 删除 */}
          <div className="flex gap-2">
            {txn.status === '待对账' ? (
              <Button icon="check_circle" onClick={() => changeStatus('已结算')}>
                ✓ 标记已入账
              </Button>
            ) : (
              <Button variant="tonal" icon="undo" onClick={() => changeStatus('待对账')}>
                退回待对账
              </Button>
            )}
            <Button variant="ghost" icon="edit" onClick={() => setEditing(true)}>
              编辑
            </Button>
            <Button
              variant="danger"
              icon="delete"
              className="ml-auto"
              onClick={() => void handleDelete()}
            >
              删除此笔
            </Button>
          </div>

          {/* 基础明细 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface-container-low/50 p-4">
            <DetailField label="交易类型">{txn.type === 'income' ? '收入' : '支出'}</DetailField>
            <DetailField label="资金渠道">{txn.channel || '—'}</DetailField>
            <DetailField label="记账时间">
              {dayjs(txn.occurredAt).format('YYYY-MM-DD')}
            </DetailField>
            <DetailField label="归属账本">{ledger?.name ?? '—'}</DetailField>
            <DetailField label="关联客户">
              {linkedCustomers.length > 0
                ? linkedCustomers.map((c) => `${c.company} · ${c.name}`).join('、')
                : '—'}
            </DetailField>
            {txn.note && (
              <div className="col-span-2">
                <DetailField label="备注">{txn.note}</DetailField>
              </div>
            )}
          </div>

          {/* 业务标签 */}
          {txn.tags.length > 0 && (
            <div>
              <div className="mb-2 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
                业务分类标签
              </div>
              <div className="flex flex-wrap gap-1.5">
                {txn.tags.map((t) => (
                  <Chip key={t} tone="blue">
                    #{t}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {/* 附件 */}
          <div>
            <div className="mb-2 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
              附件（{attachments.length}）
            </div>
            {attachments.length === 0 ? (
              <div className="text-[0.8571rem] text-outline">无附件</div>
            ) : (
              <div className="space-y-1.5">
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between surface-card !bg-transparent px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon name="description" className="text-[1.2857rem] text-primary" />
                      <div className="min-w-0">
                        <div className="truncate text-[0.9286rem]">{a.name}</div>
                        <div className="text-[0.7857rem] text-outline">
                          {(a.size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="tonal"
                      icon="download"
                      onClick={() => downloadAttachment(a)}
                    >
                      下载
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 关联业务溯源 */}
          {hasLinks && (
            <div>
              <div className="mb-2 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
                关联业务溯源
              </div>
              <div className="space-y-2">
                {linkedCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => navigate(`/crm/${customer.id}`)}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-container-low"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={customer.name} size={36} />
                      <div className="min-w-0">
                        <div className="truncate text-[0.9286rem] font-semibold">
                          {customer.company} · {customer.name}
                        </div>
                        <div className="truncate text-[0.8571rem] text-on-surface-variant">
                          {customer.title}
                        </div>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 pl-2 text-[0.8571rem] font-semibold text-primary">
                      前往 CRM 档案
                      <Icon name="open_in_new" size={14} />
                    </span>
                  </button>
                ))}
                {linkedTodos.map((todo) => (
                  <button
                    key={todo.id}
                    onClick={() => navigate('/todo')}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-container-low"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon
                        name="task_alt"
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-success-container/40 text-success"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[0.9286rem] font-medium">{todo.title}</div>
                        <div className="truncate text-[0.8571rem] text-on-surface-variant">
                          {todoPriorityLabel(todo.priority)} · {todoStatusLabel(todo)}
                        </div>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 pl-2 text-[0.8571rem] font-semibold text-primary">
                      查看待办详情
                      <Icon name="open_in_new" size={14} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* 编辑模式：以当前流水为基底回填表单，保存后详情随 liveQuery 刷新；
          该表单从详情抽屉内打开，需 elevated 抬到更高层级 */}
      <TransactionFormDrawer
        open={editing}
        defaultLedgerId={txn?.ledgerId ?? 'all'}
        editTxn={txn}
        elevated
        onClose={() => setEditing(false)}
      />

      {/* 删除流水确认（应用风格弹窗，替代 window.confirm） */}
      <ConfirmDialog
        open={confirmDelete}
        title={`确认删除流水「${txn?.summary ?? ''}」？`}
        danger
        confirmText="删除"
        message="其全部附件将一并删除。"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          void doDelete()
        }}
      />
    </Drawer>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.7857rem] font-medium text-on-surface-variant">{label}</span>
      <span className="break-all text-[0.9286rem]">{children}</span>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection, useRecord } from '@/queries/hooks'
import type { Customer, Ledger, Todo, Transaction } from '@/db/types'
import {
  Avatar,
  Button,
  Card,
  Chip,
  Drawer,
  EmptyState,
  PageHeader,
  inputCls,
} from '@/design-system/ui'
import dayjs from 'dayjs'
import LedgerFormDrawer from './LedgerFormDrawer'
import TransactionFormDrawer from './TransactionFormDrawer'
import { useAttachmentCount, useTransactionAttachments, deleteTransactionCascade } from './hooks'
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

  // 筛选口径变化时回到第一页
  useEffect(() => {
    setPage(0)
  }, [scope, typeFilter, statusFilter, keyword])

  const ledgerMap = new Map(ledgers.map((l) => [l.id, l]))
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
    if (!window.confirm(`确认删除账本「${l.name}」？删除后可在同步层恢复前撤销。`)) return
    await ledgerRepo.softDelete(l.id)
    setScope('all')
  }

  const list = scoped
    .filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        const haystack = [t.summary, t.channel, t.invoiceNo ?? '', t.tags.join(' ')]
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
            <Button variant="ghost" icon="add_circle" onClick={() => setNewLedgerOpen(true)}>
              新建账本
            </Button>
            <Button icon="payments" onClick={() => setCreating(true)}>
              记一笔
            </Button>
          </>
        }
      />

      {/* 账本穿透 Tabs */}
      <div className="mb-4 flex items-center gap-1 overflow-x-auto rounded-lg bg-surface-container p-1" style={{ width: 'fit-content', maxWidth: '100%' }}>
        <LedgerTab
          label="全部账本"
          count={transactions.length}
          active={scope === 'all'}
          onClick={() => {
            setScope('all')
            setLedgerError('')
          }}
        />
        {ledgers.map((l) => (
          <LedgerTab
            key={l.id}
            label={l.name}
            count={transactions.filter((t) => t.ledgerId === l.id).length}
            active={scope === l.id}
            onClick={() => {
              setScope(l.id)
              setLedgerError('')
            }}
          />
        ))}
        {activeLedger && (
          <div className="ml-1 flex shrink-0 items-center gap-0.5 pl-1">
            <button
              title="编辑账本"
              onClick={() => setEditingLedger(activeLedger)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
            >
              <Icon name="edit" size={16} />
            </button>
            <button
              title="删除账本"
              onClick={() => handleDeleteLedger(activeLedger)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-danger"
            >
              <Icon name="delete" size={16} />
            </button>
          </div>
        )}
      </div>
      {ledgerError && (
        <div className="-mt-2 mb-3 text-[12px] text-danger">{ledgerError}</div>
      )}

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
            <span className="text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
              待对账核验
            </span>
            <Icon name="fact_check" size={18} className="bg-warning-container text-warning" />
          </div>
          <div className="mt-1 text-[22px] font-bold tracking-tight text-warning">
            {pending.length}
            <span className="ml-1 text-[13px] font-normal text-on-surface-variant">笔待确认</span>
          </div>
          <div className="mt-0.5 text-[11px] text-outline">
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
            placeholder="按交易名称、发票号、标签检索…"
          />
        </div>
      </div>

      {/* 流水列表 */}
      {list.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon="account_balance_wallet"
            title={ledgers.length === 0 ? '还没有账本' : '没有符合条件的流水'}
            description={ledgers.length === 0 ? '点击右上角「新建账本」开始记账' : '调整筛选条件，或点「记一笔」新增流水'}
          />
        </Card>
      ) : (
        <Card className="divide-y divide-outline-variant/30 px-5">
          {pageItems.map((t) => (
            <TransactionRow
              key={t.id}
              txn={t}
              ledger={ledgerMap.get(t.ledgerId)}
              customer={customers.find((c) => c.id === t.customerId)}
              showLedger={scope === 'all'}
              onOpen={() => setDetailId(t.id)}
            />
          ))}
        </Card>
      )}
      {list.length > 0 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-[13px] text-on-surface-variant">
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
    </div>
  )
}

function LedgerTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-1.5 text-[13px] transition-colors ${
        active
          ? 'bg-primary font-semibold text-on-primary shadow-sm'
          : 'text-on-surface-variant hover:text-on-surface'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-[11px] ${
          active ? 'bg-white/20' : 'bg-surface-container-high text-on-surface-variant'
        }`}
      >
        {count}
      </span>
    </button>
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
        <span className="text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">{label}</span>
        <Icon
          name={icon}
          className={`flex h-8 w-8 items-center justify-center rounded-xl ${iconCls}`}
          size={18}
        />
      </div>
      <div className={`mt-1 text-[22px] font-bold tracking-tight ${valueCls}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-outline">{sub}</div>
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
          className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${
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
  customer,
  showLedger,
  onOpen,
}: {
  txn: Transaction
  ledger: Ledger | undefined
  customer: Customer | undefined
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
          <span className="truncate text-[14px] font-medium">{txn.summary}</span>
          {showLedger && ledger && <Chip tone={isIncome ? 'blue' : 'gray'}>{ledger.name}</Chip>}
        </div>
        <div className="mt-0.5 text-[12px] text-outline">
          {dayjs(txn.occurredAt).format('YYYY-MM-DD HH:mm')} · {txn.channel}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {txn.tags.map((tag) => (
            <Chip key={tag} tone="gray">
              #{tag}
            </Chip>
          ))}
          {customer && (
            <Chip tone="blue" icon="person">
              {customer.company} · {customer.name}
            </Chip>
          )}
          {attCount > 0 && (
            <Chip tone="gray" icon="attach_file">
              {attCount}
            </Chip>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`text-[15px] font-bold tracking-tight ${isIncome ? 'text-success' : 'text-danger'}`}>
          {fmtSigned(txn, symbol)}
        </span>
        <Chip tone={txn.status === '已结算' ? 'green' : 'amber'} icon={txn.status === '已结算' ? 'check_circle' : 'fact_check'}>
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

  const ledger = ledgers.find((l) => l.id === txn?.ledgerId)
  const customer = customers.find((c) => c.id === txn?.customerId)
  const todo = todos.find((t) => t.id === txn?.todoId)
  const symbol = symbolOf(ledger?.currency)

  /** 状态流转：以旧记录为基底，仅覆盖 status */
  async function changeStatus(status: Transaction['status']) {
    if (!txn) return
    await transactionRepo.put({ ...txn, status })
  }

  /** 删除此笔流水：级联软删其全部附件存根，成功后关闭抽屉 */
  async function handleDelete() {
    if (!txn) return
    if (!window.confirm(`确认删除流水「${txn.summary}」？其全部附件存根将一并删除。`)) return
    await deleteTransactionCascade(txn.id)
    setEditing(false)
    onClose()
  }

  return (
    <Drawer open={transactionId !== null && !editing} title="财务流水凭证详情" onClose={onClose} width={460}>
      {!txn ? null : (
        <div className="space-y-5">
          {/* 金额主卡 */}
          <div
            className={`rounded-xl p-4 ${
              txn.type === 'income' ? 'bg-success-container/40' : 'bg-danger-container/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-on-surface-variant">
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
              className={`mt-1 text-[28px] font-bold tracking-tight ${
                txn.type === 'income' ? 'text-success' : 'text-danger'
              }`}
            >
              {fmtSigned(txn, symbol)}
            </div>
            <div className="mt-1 text-[13px] font-medium">{txn.summary}</div>
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
            <Button variant="danger" icon="delete" className="ml-auto" onClick={() => void handleDelete()}>
              删除此笔
            </Button>
          </div>

          {/* 基础明细 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface-container-low/50 p-4">
            <DetailField label="交易类型">{txn.type === 'income' ? '收入' : '支出'}</DetailField>
            <DetailField label="结算渠道">{txn.channel}</DetailField>
            <DetailField label="记账时间">{dayjs(txn.occurredAt).format('YYYY-MM-DD HH:mm')}</DetailField>
            <DetailField label="归属账本">{ledger?.name ?? '—'}</DetailField>
            <DetailField label="发票号">{txn.invoiceNo ?? '—'}</DetailField>
            <DetailField label="关联客户">
              {customer ? `${customer.company} · ${customer.name}` : '—'}
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
              <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
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

          {/* 附件存根 */}
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
              附件存根（{attachments.length}）
            </div>
            {attachments.length === 0 ? (
              <div className="text-[12px] text-outline">无附件存根</div>
            ) : (
              <div className="space-y-1.5">
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-outline-variant/40 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon name="description" className="text-[18px] text-primary" />
                      <div className="min-w-0">
                        <div className="truncate text-[13px]">{a.name}</div>
                        <div className="text-[11px] text-outline">{(a.size / 1024).toFixed(0)} KB</div>
                      </div>
                    </div>
                    <Button size="sm" variant="tonal" icon="download" onClick={() => downloadAttachment(a)}>
                      下载
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 关联业务溯源 */}
          {(customer || todo) && (
            <div>
              <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
                关联业务溯源
              </div>
              <div className="space-y-2">
                {customer && (
                  <button
                    onClick={() => navigate(`/crm/${customer.id}`)}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-container-low"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={customer.name} size={36} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold">
                          {customer.company} · {customer.name}
                        </div>
                        <div className="truncate text-[12px] text-on-surface-variant">{customer.title}</div>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 pl-2 text-[12px] font-semibold text-primary">
                      前往 CRM 档案
                      <Icon name="open_in_new" size={14} />
                    </span>
                  </button>
                )}
                {todo && (
                  <button
                    onClick={() => navigate('/todo')}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-container-low"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon name="task_alt" className="flex h-9 w-9 items-center justify-center rounded-xl bg-success-container/40 text-success" />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">{todo.title}</div>
                        <div className="truncate text-[12px] text-on-surface-variant">
                          {todo.priority} · {todo.status === 'done' ? '已完成' : '进行中'}
                        </div>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 pl-2 text-[12px] font-semibold text-primary">
                      查看待办详情
                      <Icon name="open_in_new" size={14} />
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* 编辑模式：以当前流水为基底回填表单，保存后详情随 liveQuery 刷新 */}
      <TransactionFormDrawer
        open={editing}
        defaultLedgerId={txn?.ledgerId ?? 'all'}
        editTxn={txn}
        onClose={() => setEditing(false)}
      />
    </Drawer>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-on-surface-variant">{label}</span>
      <span className="break-all text-[13px]">{children}</span>
    </div>
  )
}

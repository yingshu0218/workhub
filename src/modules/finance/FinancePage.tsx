import { useState } from 'react'
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
import { useAttachmentCounts, useTransactionAttachments } from './hooks'

type TypeFilter = 'all' | 'income' | 'expense'
type StatusFilter = 'all' | '已结算' | '待对账'

const fmtMoney = (n: number) =>
  `¥${Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtSigned = (t: Transaction) => `${t.type === 'income' ? '+' : '-'}${fmtMoney(t.amount)}`

/** 财务中心主页面（对齐原型 03-finance-center） */
export default function FinancePage() {
  const ledgers = useCollection<Ledger>('ledgers')
  const transactions = useCollection<Transaction>('transactions')
  const customers = useCollection<Customer>('customers')
  const attachCounts = useAttachmentCounts()
  const [scope, setScope] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [creating, setCreating] = useState(false)
  const [newLedgerOpen, setNewLedgerOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const ledgerMap = new Map(ledgers.map((l) => [l.id, l]))
  // 当前账本口径下的流水与汇总（统计一律从源记录推导）
  const scoped = transactions.filter((t) => scope === 'all' || t.ledgerId === scope)
  const income = scoped.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = scoped.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const opening =
    scope === 'all'
      ? ledgers.reduce((s, l) => s + l.openingBalance, 0)
      : (ledgerMap.get(scope)?.openingBalance ?? 0)
  const net = opening + income - expense
  const pending = scoped.filter((t) => t.status === '待对账')
  const pendingAmount = pending.reduce((s, t) => s + t.amount, 0)

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
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-surface-container p-1" style={{ width: 'fit-content', maxWidth: '100%' }}>
        <LedgerTab
          label="全部账本"
          count={transactions.length}
          active={scope === 'all'}
          onClick={() => setScope('all')}
        />
        {ledgers.map((l) => (
          <LedgerTab
            key={l.id}
            label={l.name}
            count={transactions.filter((t) => t.ledgerId === l.id).length}
            active={scope === l.id}
            onClick={() => setScope(l.id)}
          />
        ))}
      </div>

      {/* 汇总卡 4 张 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          label="累计收入"
          icon="trending_up"
          iconCls="bg-success-container/60 text-success"
          value={fmtMoney(income)}
          valueCls="text-success"
          sub={`共 ${scoped.filter((t) => t.type === 'income').length} 笔流入`}
        />
        <SummaryCard
          label="累计支出"
          icon="trending_down"
          iconCls="bg-danger-container/60 text-danger"
          value={fmtMoney(expense)}
          valueCls="text-danger"
          sub={`共 ${scoped.filter((t) => t.type === 'expense').length} 笔流出`}
        />
        <SummaryCard
          label="净结余"
          icon="account_balance"
          iconCls="bg-surface-container-high text-primary"
          value={`${net >= 0 ? '+' : '-'}${fmtMoney(net)}`}
          valueCls="text-primary"
          sub={`含期初结转 ${fmtMoney(opening)}`}
        />
        <div
          className="card card-hover cursor-pointer p-4"
          onClick={() => setStatusFilter(pending.length > 0 ? '待对账' : 'all')}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wide text-on-surface-variant">
              待对账核验
            </span>
            <span className="material-symbols-rounded bg-warning-container text-warning" style={{ fontSize: 18 }}>
              fact_check
            </span>
          </div>
          <div className="mt-1 text-[22px] font-bold tracking-tight text-warning">
            {pending.length}
            <span className="ml-1 text-[13px] font-normal text-on-surface-variant">笔待确认</span>
          </div>
          <div className="mt-0.5 text-[11px] text-outline">涉及金额 {fmtMoney(pendingAmount)}</div>
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
          {list.map((t) => (
            <TransactionRow
              key={t.id}
              txn={t}
              ledger={ledgerMap.get(t.ledgerId)}
              customer={customers.find((c) => c.id === t.customerId)}
              attCount={attachCounts.get(t.id) ?? 0}
              showLedger={scope === 'all'}
              onOpen={() => setDetailId(t.id)}
            />
          ))}
        </Card>
      )}

      <TransactionFormDrawer
        open={creating}
        defaultLedgerId={scope}
        onClose={() => setCreating(false)}
      />
      <LedgerFormDrawer open={newLedgerOpen} onClose={() => setNewLedgerOpen(false)} />
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
        <span
          className={`material-symbols-rounded flex h-8 w-8 items-center justify-center rounded-xl ${iconCls}`}
          style={{ fontSize: 18 }}
        >
          {icon}
        </span>
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
  attCount,
  showLedger,
  onOpen,
}: {
  txn: Transaction
  ledger: Ledger | undefined
  customer: Customer | undefined
  attCount: number
  showLedger: boolean
  onOpen: () => void
}) {
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
        <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
          {isIncome ? 'call_received' : 'call_made'}
        </span>
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
          {fmtSigned(txn)}
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

/** 凭证详情抽屉：完整字段 + 附件下载 + 关联业务溯源 */
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

  const ledger = ledgers.find((l) => l.id === txn?.ledgerId)
  const customer = customers.find((c) => c.id === txn?.customerId)
  const todo = todos.find((t) => t.id === txn?.todoId)

  return (
    <Drawer open={transactionId !== null} title="财务流水凭证详情" onClose={onClose} width={460}>
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
              {fmtSigned(txn)}
            </div>
            <div className="mt-1 text-[13px] font-medium">{txn.summary}</div>
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
                      <span className="material-symbols-rounded text-[18px] text-primary">description</span>
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
                    onClick={() => navigate('/crm')}
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
                      <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                        open_in_new
                      </span>
                    </span>
                  </button>
                )}
                {todo && (
                  <button
                    onClick={() => navigate('/todo')}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-container-low"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="material-symbols-rounded flex h-9 w-9 items-center justify-center rounded-xl bg-success-container/40 text-success">
                        task_alt
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">{todo.title}</div>
                        <div className="truncate text-[12px] text-on-surface-variant">
                          {todo.priority} · {todo.status === 'done' ? '已完成' : '进行中'}
                        </div>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 pl-2 text-[12px] font-semibold text-primary">
                      查看待办详情
                      <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                        open_in_new
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
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

import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { FilterChip } from '@/design-system/FilterChip'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCollection, useRecord } from '@/queries/hooks'
import { downloadBlob } from '@/shared/download'
import { useIsMobile } from '@/shared/useIsMobile'
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
  StatCard,
  inputCls,
} from '@/design-system/ui'
import dayjs from 'dayjs'
import { todoStatusLabel, todoFocusPath } from '@/modules/todo/domain'
import { todoPriorityLabel } from '@/modules/todo/priority'
import LedgerFormDrawer from './LedgerFormDrawer'
import TransactionFormDrawer from './TransactionFormDrawer'
import { txnLinksOf } from './links'
import { useTxnLinkIndex } from './hooks'
import {
  useAttachmentCount,
  useTransactionAttachments,
  deleteTransactionCascade,
  reorderLedgers,
} from './hooks'
import { deleteLedgerCascade, transactionRepo } from '@/repositories'
import { staggerStyle } from '@/shared/stagger'

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
  // 流水行在窄屏要换成另一套结构（无标签/关联/附件芯片），CSS 类名做不到，只能走 JS 判定
  const isMobile = useIsMobile()
  const ledgers = useCollection<Ledger>('ledgers')
  const transactions = useCollection<Transaction>('transactions')
  // 流水关联索引（v15 起关联迁 links）：列表行的关联客户名走 link 索引
  const txnLinkIndex = useTxnLinkIndex()
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

  /** 确认后级联软删账本（有流水的账本已在上方预检拦截，数据层守卫双保险）并回到「全部」范围 */
  async function doDeleteLedger(l: Ledger) {
    try {
      await deleteLedgerCascade(l.id)
      setScope('all')
    } catch (e) {
      // 数据层守卫（与 UI 预检同口径）：绕过预检的路径或并发新增流水时给出可读错误
      setLedgerError(e instanceof Error ? e.message : '删除失败，请重试')
    }
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
        actions={
          <>
            <Button icon="payments" onClick={() => setCreating(true)}>
              {/* 窄屏标题行挤不下文案，收成纯图标；sr-only 副本保住可访问名（图标是纯 SVG，读不出来） */}
              <span className="hidden md:inline">记一笔</span>
              <span className="sr-only md:hidden">记一笔</span>
            </Button>
          </>
        }
      />

      {ledgerError && <div className="mb-3 text-[0.8571rem] text-danger">{ledgerError}</div>}

      <div className="flex items-start gap-4">
        {/* 左栏：账本树（全部账本 + 各账本，支持拖拽排序，hover 显示编辑/删除）。
            窄屏整栏隐藏：拖拽排序本就不是触屏交互，改为下方横向滚动的账本 chips */}
        <Card className="hidden w-64 shrink-0 self-start p-4 md:block">
          <div className="mb-3 flex items-center justify-between text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
            <span>账本（{ledgers.length}）</span>
            <button
              className="rounded p-0.5 text-outline transition-colors hover:bg-surface-hover-high hover:text-on-surface"
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
                      className="rounded p-0.5 text-outline transition-colors hover:bg-surface-hover-high hover:text-primary"
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
        </Card>

        {/* 右侧：汇总 + 流水 */}
        <div className="min-w-0 flex-1">
          {/* 汇总卡 4 张。窄屏保持等分 2 列（原型 05 口径），仅把间距收紧一点给金额让位 */}
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <StatCard
              label={`累计收入${currency !== 'CNY' ? `（${currency}）` : ''}`}
              icon="trending_up"
              iconCls="bg-success-container/60 text-success"
              value={fmtMoney(income, symbol)}
              valueCls="text-success"
              sub={`共 ${scoped.filter((t) => t.type === 'income').length} 笔流入${scopeNote}`}
            />
            <StatCard
              label={`累计支出${currency !== 'CNY' ? `（${currency}）` : ''}`}
              icon="trending_down"
              iconCls="bg-danger-container/60 text-danger"
              value={fmtMoney(expense, symbol)}
              valueCls="text-danger"
              sub={`共 ${scoped.filter((t) => t.type === 'expense').length} 笔流出${scopeNote}`}
            />
            <StatCard
              label={`净结余${currency !== 'CNY' ? `（${currency}）` : ''}`}
              icon="account_balance"
              iconCls="bg-surface-container-high text-primary"
              value={`${net >= 0 ? '+' : '-'}${fmtMoney(net, symbol)}`}
              valueCls={net < 0 ? 'text-danger' : 'text-primary'}
              sub={`含期初结转 ${fmtMoney(opening, symbol)}${scopeNote}`}
            />
            {/* min-w-0 + overflow-hidden：金额是不断行的长串，窄屏栏宽不够时宁可裁掉也不许把整行撑宽 */}
            <div
              className={`card card-hover min-w-0 cursor-pointer overflow-hidden p-4 transition-colors ${
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
              <div className="mt-1 text-[1.2857rem] font-bold tracking-tight text-warning md:text-[1.5714rem]">
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

          {/* 账本 chips（仅窄屏）：左栏账本树已隐藏，scope 切换挪到这里。
              负边距 + 同值内边距让这一条横向滚到屏幕边缘，不用换行挤成两排。
              外形用 `FilterChip variant="filled"`（无边框实心填充）—— 这是账本行
              的**原始设计**，与 CrmPage 的描边筛选项语义不同，不要合并成同一种外观。
              右侧「新建账本」是动作按钮不是筛选项，尺寸维持原样（py-1 + 0.8571rem） */}
          <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-0.5 md:hidden">
            <FilterChip
              variant="filled"
              active={scope === 'all'}
              onClick={() => {
                setScope('all')
                setLedgerError('')
              }}
            >
              全部账本
            </FilterChip>
            {sortedLedgers.map((l) => (
              <FilterChip
                key={l.id}
                variant="filled"
                active={scope === l.id}
                onClick={() => {
                  setScope(l.id)
                  setLedgerError('')
                }}
              >
                {l.name}
              </FilterChip>
            ))}
            <button
              className="flex shrink-0 items-center gap-0.5 rounded-full border border-primary/40 px-3 py-1 text-[0.8571rem] font-medium text-primary"
              onClick={() => setNewLedgerOpen(true)}
            >
              <Icon name="add" size={14} />
              新建账本
            </button>
          </div>

          {/* 筛选工具栏：窄屏竖排（分段控件各占一行 + 检索框整行），
              ≥768px 回到原来「一行内 wrap、检索框右对齐」的排布 */}
          <div className="mb-3 mt-5 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
            <Segmented
              options={[
                { key: 'all', label: '全部流水' },
                { key: 'income', label: '仅看收入' },
                { key: 'expense', label: '仅看支出' },
              ]}
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as TypeFilter)}
              className="self-start md:self-auto"
            />
            <Segmented
              options={[
                { key: 'all', label: '全部状态' },
                { key: '已结算', label: '已结算' },
                { key: '待对账', label: '待对账' },
              ]}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              className="self-start md:self-auto"
            />
            <div className="md:ml-auto md:w-56">
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
                    ? isMobile
                      ? '点上方「新建账本」开始记账'
                      : '点击左栏「+」新建账本开始记账'
                    : '调整筛选条件，或点「记一笔」新增流水'
                }
              />
            </Card>
          ) : (
            <Card
              /* key 随筛选变化 → 切换账本/类型/状态时整块重挂，条目错峰重新入场。
                 挂 key 在 Card 上而不是包 wrapper：本 Card 用 `divide-y` 做行分隔线，
                 包一层 div 会破坏「直接子元素」关系。 */
              key={`${scope}-${typeFilter}-${statusFilter}-${page}`}
              className="divide-y divide-outline-variant/30 px-3 md:px-5"
            >
              {pageItems.map((t, i) =>
                isMobile ? (
                  <TransactionRowCompact
                    key={t.id}
                    txn={t}
                    ledger={ledgerMap.get(t.ledgerId)}
                    showLedger={scope === 'all'}
                    index={i}
                    onOpen={() => setDetailId(t.id)}
                  />
                ) : (
                  <TransactionRow
                    key={t.id}
                    txn={t}
                    ledger={ledgerMap.get(t.ledgerId)}
                    customers={customers.filter((c) => txnLinksOf(txnLinkIndex, t.id).customerIds.includes(c.id))}
                    showLedger={scope === 'all'}
                    index={i}
                    onOpen={() => setDetailId(t.id)}
                  />
                ),
              )}
            </Card>
          )}
          {list.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[0.9286rem] text-on-surface-variant md:gap-3">
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
        message="删除后可在回收站恢复（30 天内）。"
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
          : 'text-on-surface-variant hover:bg-surface-hover-low hover:text-on-surface'
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

function Segmented({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <div className={`flex gap-1 rounded-lg bg-surface-container p-1 ${className}`}>
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

/**
 * 窄屏流水行（<768px 专用，由 useIsMobile 分流）。
 *
 * 为什么不与桌面行共用一套结构：桌面行要挂标签、关联客户、附件三类芯片 + 状态芯片，
 * 390px 下必然挤成多行甚至横向溢出；且移动原型 05 的口径就是
 * 「圆形图标位 / 名称 + 一行次要信息 / 金额」。两端结构差异是真实存在的，
 * 于是各留一份：桌面行原样保留，这里只承载窄屏需要的字段。
 */
function TransactionRowCompact({
  txn,
  ledger,
  showLedger,
  onOpen,
  index,
}: {
  txn: Transaction
  ledger: Ledger | undefined
  showLedger: boolean
  onOpen: () => void
  /** 列表序号：仅用于错峰入场延迟（可选，不传则不参与错峰） */
  index?: number
}) {
  const symbol = symbolOf(ledger?.currency)
  const isIncome = txn.type === 'income'
  // 账本 · 日期 · 支付方式。日期取 MM-DD 而非 YYYY-MM-DD：省 5 个字符才够一行放下，
  // 真要更长时由 truncate 兜底（次要信息被截断不影响主次判断）
  const meta = [
    showLedger ? ledger?.name : null,
    dayjs(txn.occurredAt).format('MM-DD'),
    txn.channel || '—',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      onClick={onOpen}
      /* 错峰入场挂在行根：外层 Card 用 `divide-y` 做分隔线、依赖直接子元素，不能包 div */
      style={staggerStyle(index)}
      className="anim-list-item flex cursor-pointer items-center gap-2.5 px-1 py-3 transition-colors active:bg-surface-container-low/60"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          isIncome ? 'bg-success-container/60 text-success' : 'bg-danger-container/60 text-danger'
        }`}
      >
        <Icon name={isIncome ? 'call_received' : 'call_made'} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.9286rem] font-medium">{txn.summary}</div>
        <div className="mt-0.5 truncate text-[0.7857rem] text-outline">{meta}</div>
      </div>
      {/* 金额不参与压缩（shrink-0）：宁可截名称也不截数字；支出沿用移动原型的 warning 色 */}
      <span
        className={`shrink-0 whitespace-nowrap text-[0.9286rem] font-bold tracking-tight ${
          isIncome ? 'text-success' : 'text-warning'
        }`}
      >
        {fmtSigned(txn, symbol)}
      </span>
    </div>
  )
}

function TransactionRow({
  txn,
  ledger,
  customers,
  showLedger,
  onOpen,
  index,
}: {
  txn: Transaction
  ledger: Ledger | undefined
  /** 多关联（Issue #140）：一笔流水可挂多个客户，逐个出芯片 */
  customers: Customer[]
  showLedger: boolean
  onOpen: () => void
  /** 列表序号：仅用于错峰入场延迟（可选，不传则不参与错峰） */
  index?: number
}) {
  // 每行独立计数 Hook：count() 只走索引计数，不反序列化 Blob
  const attCount = useAttachmentCount(txn.id)
  const symbol = symbolOf(ledger?.currency)
  const isIncome = txn.type === 'income'
  return (
    <div
      onClick={onOpen}
      style={staggerStyle(index)}
      className="anim-list-item group flex cursor-pointer items-start gap-3 px-2 py-3.5 transition-colors hover:bg-surface-hover-low"
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
  downloadBlob(a.blob, a.name)
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
  const txnLinkIndex = useTxnLinkIndex()
  const txnLinks = txn ? txnLinksOf(txnLinkIndex, txn.id) : { customerIds: [], todoIds: [], projectIds: [] }
  const linkedCustomers = customers.filter((c) => txnLinks.customerIds.includes(c.id))
  const linkedTodos = todos.filter((t) => txnLinks.todoIds.includes(t.id))
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

  // ⚠️ 表单与确认弹窗必须是 Drawer 的「兄弟」而非子节点：Drawer 退场动画播完会整棵卸载子树
  // （usePresence → return null），曾经把内嵌的编辑表单一起带走 —— 表单闪现 ~200ms 即消失，
  // 凭证详情里根本无法编辑流水。待办详情（TodoDetailDrawer）的同位做法就是表单挂在外层。
  return (
    <>
      <Drawer
        open={transactionId !== null}
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

          {/* 状态流转 + 编辑 + 删除。flex-wrap：抽屉在窄屏只剩 ~350px，
              三个按钮并排会顶出横向滚动，宁可换行 */}
          <div className="flex flex-wrap gap-2">
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
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-hover-low"
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
                    onClick={() => navigate(todoFocusPath(todo.id))}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-hover-low"
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
      </Drawer>
      {/* 编辑模式：以当前流水为基底回填表单，保存后详情随 liveQuery 刷新；
          elevated 叠在仍打开的详情抽屉之上（对齐待办详情→编辑的既有模式） */}
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
        message="其全部附件将一并删除；可在回收站恢复（30 天内），附件会一并回位。"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          void doDelete()
        }}
      />
    </>
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

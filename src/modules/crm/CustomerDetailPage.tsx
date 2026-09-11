import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate, useParams } from 'react-router-dom'
import { useCollection, useRecord } from '@/queries/hooks'
import type { Customer, Interaction, Note, Project } from '@/db/types'
import { deleteCustomerCascade, newId, saveInteractionAndTouchCustomer } from '@/repositories'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  inputCls,
  PageHeader,
} from '@/design-system/ui'
import dayjs from 'dayjs'
import { isTodoOpen } from '@/modules/todo/domain'
import { todoPriorityLabel, todoPriorityTone } from '@/modules/todo/priority'
import CustomerFormDrawer from './CustomerFormDrawer'
import { useCustomerTodos, useCustomerTransactions } from './hooks'
import { financeFocusPath } from '@/modules/finance/links'
import { fmtRelative, tierChipTone } from './shared'
import IntimacyPicker from './intimacy/IntimacyPicker'
import {
  TIMELINE_FILTERS,
  fmtTimelineTime,
  filterTimeline,
  fmtMoney,
  type TimelineEvent,
  type TimelineFilter,
  useCustomerTimeline,
} from './timeline'

const TYPE_ICONS: Record<Interaction['type'], string> = {
  电话: 'call',
  会议: 'groups',
  邮件: 'mail',
  拜访: 'directions_walk',
  跟进: 'trending_up',
  小结: 'summarize',
  其他: 'more_horiz',
}

/** 时间轴系统事件的 kind → 图标映射（与手写日志的 TYPE_ICONS 分开，不复用不混用） */
const KIND_ICONS: Record<Exclude<TimelineEvent['kind'], 'interaction'>, string> = {
  transaction: 'payments',
  todo: 'task_alt',
}

/** 沟通日志类型选择仍需 4 种类型常量（QuickLog 使用） */
const INTERACTION_TYPE_OPTIONS = Object.keys(TYPE_ICONS) as Interaction['type'][]

/** 明细区 Tab（Issue #108：「概览给数字，明细给记录」，一次只显示一层） */
type DetailTab = 'timeline' | 'finance' | 'project' | 'profile'

/**
 * 客户智能管家详情页（Issue #108 信息架构重构，路由 /crm/:id）
 * 三段式：身份条 → 行动区（记一笔 + 待跟进）→ 概览区（数字下钻）→ 明细区（Tabs）。
 * 原则：同一份数据只在一处出现——概览给数字，明细给记录，杜绝一屏双份。
 */
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const customer = useRecord<Customer>('customers', id)
  const allProjects = useCollection<Project>('projects')
  const customerProjects = allProjects.filter((p) => p.customerId === id)
  const transactions = useCustomerTransactions(id)
  const todos = useCustomerTodos(id)
  const timeline = useCustomerTimeline(id)
  // 客户关联笔记（经 notes.mentions 反查，与图谱投影同一口径）
  // 审计纪律 P2-9：只投影所需字段，笔记整篇 markdown 不进入 React 状态
  const allNotes = useCollection<Note>('notes', ['id', 'title', 'mentions'])
  const customerNotes = allNotes.filter((n) =>
    (n.mentions ?? []).some((m) => m.type === 'customer' && m.id === id),
  )
  // 明细区 Tab：默认停在「时间轴」
  const [tab, setTab] = useState<DetailTab>('timeline')
  // 时间轴默认只显示沟通日志（Issue #108）：交易/待办切「全部」chip 再看，消除与明细区双份
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('interaction')
  // 关联待办口径：计数与列表统一只统计未完成项
  const openTodos = todos.filter(isTodoOpen)
  const visibleTimeline = filterTimeline(timeline, timelineFilter)
  const counts = {
    interaction: timeline.filter((e) => e.kind === 'interaction').length,
    transaction: timeline.filter((e) => e.kind === 'transaction').length,
    todo: timeline.filter((e) => e.kind === 'todo').length,
  }
  // 资金汇总（概览数字，与「资金」Tab 共享同一批源记录，只是呈现粒度不同）
  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const pendingReconcile = transactions.filter((t) => t.status === '待对账')
  const recentInteractionCount = timeline.filter(
    (e) => e.kind === 'interaction' && e.at >= dayjs().subtract(7, 'day').valueOf(),
  ).length
  const [editing, setEditing] = useState(false)
  // 删除客户确认（应用风格弹窗，替代 window.confirm）
  const [confirmDelete, setConfirmDelete] = useState<{ name: string; id: string } | null>(null)

  if (!customer) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          title="客户详情"
          actions={
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
              返回列表
            </Button>
          }
        />
        <Card className="p-6">
          <EmptyState
            icon="person_off"
            title="客户不存在或已删除"
            description="可能已被移除，返回列表查看其他客户"
          />
        </Card>
      </div>
    )
  }

  function handleDelete(name: string, id: string) {
    setConfirmDelete({ name, id })
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={customer.name}
        subtitle={customer.company || undefined}
        actions={
          <>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
              返回列表
            </Button>
            <Button
              variant="tonal"
              icon="schedule"
              onClick={() => navigate(`/crm/${customer.id}/timeline`)}
            >
              时间线
            </Button>
            <Button icon="edit" onClick={() => setEditing(true)}>
              编辑档案
            </Button>
            <Button
              variant="danger"
              icon="person_remove"
              onClick={() => handleDelete(customer.name, customer.id)}
            >
              删除客户
            </Button>
          </>
        }
      />

      {/* ① 身份条：身份属性 + 健康分档位 + 关系摘要，一行读完「这人现在什么状态」 */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <Avatar name={customer.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[1.2857rem] font-bold">{customer.name}</span>
              <Chip tone={tierChipTone(customer.tier)}>
                {customer.tier === '潜在' ? '潜在' : `${customer.tier} 层`}
              </Chip>
            </div>
            <div className="mt-0.5 text-[0.9286rem] text-on-surface-variant">
              {customer.company || '—'}
              {customer.title ? ` · ${customer.title}` : ''}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8571rem] text-on-surface-variant">
              <span className="inline-flex items-center gap-1">
                <Icon name="schedule" className="text-[1.1429rem] text-primary" />
                最近联系 {fmtRelative(customer.lastContactAt)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="calendar_month" className="text-[1.1429rem] text-primary" />
                建档 {dayjs(customer.createdAt).format('YYYY-MM-DD')}
              </span>
            </div>
            {customer.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {customer.tags.map((t) => (
                  <Chip key={t} tone="gray">
                    #{t}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 健康分档位（原亲密度改名，Issue #108）：身份条内唯一的关系标尺 */}
        <IntimacyPicker customer={customer} />
      </Card>

      {/* ② 行动区：记一笔 + 待跟进（唯一出处，首屏直接给出下一步动作） */}
      <Card className="mt-4 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
            <Icon name="bolt" className="text-[1.1429rem] text-primary" />
            行动区 · 快速记一笔
          </div>
          <button
            className="text-[0.8571rem] font-semibold text-primary hover:underline"
            onClick={() => navigate(`/crm/${customer.id}/timeline`)}
          >
            查看完整时间线 →
          </button>
        </div>
        <QuickLog customerId={customer.id} />

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {/* 待跟进：进行中待办（唯一出处，明细区不再重复列待办） */}
          <div className="rounded-xl bg-surface-container-low/60 p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[0.8571rem] text-on-surface-variant">
                <Icon name="task_alt" className="text-[1.2857rem] text-primary" />
                待跟进事项
              </span>
              <span className="text-[0.8571rem] font-bold">{openTodos.length} 项进行中</span>
            </div>
            {openTodos.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {openTodos.slice(0, 4).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 text-[0.8571rem]"
                  >
                    <span className="truncate">{t.title}</span>
                    <Chip
                      tone={todoPriorityTone(t.priority)}
                    >
                      {todoPriorityLabel(t.priority)}
                    </Chip>
                  </div>
                ))}
                {openTodos.length > 4 && (
                  <div className="text-[0.7857rem] text-outline">等共 {openTodos.length} 项…</div>
                )}
              </div>
            ) : (
              <div className="mt-2 text-[0.7857rem] text-outline">暂无进行中的关联待办</div>
            )}
          </div>

          {/* 待对账：待处理资金（唯一出处，金额明细去「资金」Tab 看） */}
          <div className="rounded-xl bg-surface-container-low/60 p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[0.8571rem] text-on-surface-variant">
                <Icon name="receipt_long" className="text-[1.2857rem] text-primary" />
                待对账款项
              </span>
              <span className="text-[0.8571rem] font-bold">{pendingReconcile.length} 笔待处理</span>
            </div>
            {pendingReconcile.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {pendingReconcile.slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title="点击查看凭证详情"
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left text-[0.8571rem] transition-colors hover:bg-surface-container-low"
                    onClick={() => navigate(financeFocusPath(t.id))}
                  >
                    <span className="truncate text-on-surface-variant">{t.summary}</span>
                    <span
                      className={`ml-2 shrink-0 font-bold ${t.type === 'income' ? 'text-success' : 'text-danger'}`}
                    >
                      {t.type === 'income' ? '+' : '-'}
                      {fmtMoney(t.amount)}
                    </span>
                  </button>
                ))}
                {pendingReconcile.length > 4 && (
                  <div className="text-[0.7857rem] text-outline">
                    等共 {pendingReconcile.length} 笔…
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 text-[0.7857rem] text-outline">暂无待对账款项，账目清爽</div>
            )}
          </div>
        </div>
      </Card>

      {/* ③ 概览区：只给数字，点击下钻到对应 Tab（杜绝与明细区双份记录） */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="payments"
          tone="text-success"
          label="资金往来"
          value={fmtMoney(income + expense)}
          hint={`收 ${fmtMoney(income)} · 支 ${fmtMoney(expense)}`}
          onClick={() => setTab('finance')}
        />
        <StatCard
          icon="hub"
          tone="text-primary"
          label="名下项目"
          value={`${customerProjects.length} 个`}
          hint={
            customerProjects.length > 0
              ? customerProjects
                  .slice(0, 2)
                  .map((p) => p.name)
                  .join(' / ')
              : '尚无挂靠项目'
          }
          onClick={() => setTab('project')}
        />
        <StatCard
          icon="call"
          tone="text-primary"
          label="沟通次数"
          value={`${counts.interaction} 次`}
          hint={`近 7 天 ${recentInteractionCount} 次`}
          onClick={() => setTab('timeline')}
        />
        <StatCard
          icon="description"
          tone="text-primary"
          label="关联笔记"
          value={`${customerNotes.length} 篇`}
          hint={
            customerNotes.length > 0
              ? customerNotes
                  .slice(0, 1)
                  .map((n) => n.title)
                  .join('')
              : '暂无 @ 本客户的笔记'
          }
          onClick={() => setTab('profile')}
        />
      </div>

      {/* ④ 明细区：Tabs，一次只显示一层 */}
      <Card className="mt-4 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-outline-variant/40 pb-2">
          {(
            [
              ['timeline', '时间轴', counts.interaction + counts.transaction + counts.todo],
              ['finance', '资金', transactions.length],
              ['project', '项目', customerProjects.length],
              ['profile', '资料', customerNotes.length],
            ] as [DetailTab, string, number][]
          ).map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-full px-3 py-1 text-[0.8571rem] transition-colors ${
                tab === key
                  ? 'bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {label}
              <span className="ml-1 text-[0.7857rem] text-outline">{n}</span>
            </button>
          ))}
        </div>

        {tab === 'timeline' && (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[0.8571rem] text-on-surface-variant">
                手写沟通 + 关联动态投影，交易/待办详列见对应 Tab
              </div>
              <div className="flex gap-1">
                {TIMELINE_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setTimelineFilter(f.key)}
                    className={`rounded-full border px-2.5 py-0.5 text-[0.7857rem] transition-colors ${
                      timelineFilter === f.key
                        ? 'border-primary bg-primary-fixed font-semibold text-primary'
                        : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {f.label}
                    {f.key !== 'all' ? ` ${counts[f.key as keyof typeof counts]}` : ''}
                  </button>
                ))}
              </div>
            </div>
            {visibleTimeline.length === 0 ? (
              <div className="py-6 text-center text-[0.8571rem] text-outline">
                暂无记录，用上方「快速记一笔」开始跟进；记账或建待办时关联该客户也会同步显示在这里
              </div>
            ) : (
              <div className="relative space-y-4 border-l border-outline-variant/40 pl-4">
                {visibleTimeline.map((e) => (
                  <TimelineItem key={e.id} event={e} onOpenTxn={(id) => navigate(financeFocusPath(id))} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'finance' && (
          <FinanceTable
            transactions={transactions}
            onFocusTxn={(txnId) => navigate(financeFocusPath(txnId))}
          />
        )}

        {tab === 'project' && (
          <ProjectList projects={customerProjects} onOpen={(pid) => navigate(`/projects/${pid}`)} />
        )}

        {tab === 'profile' && (
          <ProfileTab
            customer={customer}
            notes={customerNotes}
            onOpenNote={(noteId) => navigate(`/notes/${noteId}`)}
          />
        )}
      </Card>

      {/* 迷你关系图谱：默认折叠，只留一行入口（Issue #108 去装饰性噪音） */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
            <Icon name="hub" className="text-[1.1429rem] text-primary" />
            跨系统关系图谱
            <span className="ml-1 font-normal normal-case text-outline">
              交易 {transactions.length} 笔 · 待办 {todos.length} 项
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="text-[0.8571rem] font-semibold text-primary hover:underline"
              onClick={() => navigate(`/crm/${id}/graph`)}
            >
              展开全屏图谱 →
            </button>
          </div>
        </div>
      </Card>

      <CustomerFormDrawer open={editing} customer={customer} onClose={() => setEditing(false)} />

      {/* 删除客户确认（应用风格弹窗，替代 window.confirm） */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`删除客户「${confirmDelete?.name ?? ''}」？`}
        danger
        confirmText="删除"
        message={
          <>
            将同时删除其名下 {counts.interaction} 条沟通日志，并解绑 {transactions.length}{' '}
            笔交易流水与 {todos.length} 项待办。
          </>
        }
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete
          setConfirmDelete(null)
          if (target) void deleteCustomerCascade(target.id).then(() => navigate('/crm'))
        }}
      />
    </div>
  )
}

/** 概览数字卡：只给数字，点击下钻到对应明细 Tab */
function StatCard({
  icon,
  tone,
  label,
  value,
  hint,
  onClick,
}: {
  icon: string
  tone: string
  label: string
  value: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      className="rounded-xl bg-surface-container-low/60 p-4 text-left transition-colors hover:bg-surface-container-low"
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-[0.8571rem] text-on-surface-variant">{label}</span>
        <Icon name={icon} className={`text-[1.2857rem] ${tone}`} />
      </div>
      <div className="mt-1 text-[1.4286rem] font-bold tracking-tight">{value}</div>
      <div className="mt-1 truncate text-[0.7857rem] text-outline">{hint}</div>
    </button>
  )
}

/** 明细区 · 资金：完整流水列表（概览只给总额，这里给记录） */
function FinanceTable({
  transactions,
  onFocusTxn,
}: {
  transactions: ReturnType<typeof useCustomerTransactions>
  /** 行点击穿透：/finance?focus=<txnId> 深链打开财务凭证详情抽屉（与时间线骨刺穿透同一深链，Issue #11 先例） */
  onFocusTxn: (txnId: string) => void
}) {
  if (transactions.length === 0) {
    return (
      <div className="py-6 text-center text-[0.8571rem] text-outline">
        暂无关联流水，在财务中心记账时可关联该客户
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.8571rem]">
        <thead>
          <tr className="text-left text-[0.7857rem] uppercase tracking-wide text-outline">
            <th className="pb-2 font-medium">日期</th>
            <th className="pb-2 font-medium">摘要</th>
            <th className="pb-2 font-medium">渠道</th>
            <th className="pb-2 font-medium">状态</th>
            <th className="pb-2 text-right font-medium">金额</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr
              key={t.id}
              title="点击查看凭证详情"
              className="cursor-pointer border-t border-outline-variant/30 transition-colors hover:bg-surface-container-low/60"
              onClick={() => onFocusTxn(t.id)}
            >
              <td className="py-2 whitespace-nowrap text-on-surface-variant">
                {dayjs(t.occurredAt).format('YYYY-MM-DD')}
              </td>
              <td className="py-2">
                <span className="line-clamp-1">{t.summary}</span>
              </td>
              <td className="py-2 text-on-surface-variant">{t.channel || '—'}</td>
              <td className="py-2">
                <Chip tone={t.status === '待对账' ? 'amber' : 'gray'}>{t.status}</Chip>
              </td>
              <td
                className={`py-2 text-right font-bold whitespace-nowrap ${
                  t.type === 'income' ? 'text-success' : 'text-danger'
                }`}
              >
                {t.type === 'income' ? '+' : '-'}
                {fmtMoney(t.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 明细区 · 项目：名下项目列表（实时推导，不存快照） */
function ProjectList({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  if (projects.length === 0) {
    return (
      <div className="py-6 text-center text-[0.8571rem] text-outline">
        暂无名下项目，在项目中可挂靠该客户
      </div>
    )
  }
  const STATUS_LABEL: Record<Project['status'], string> = {
    active: '进行中',
    paused: '暂搁置',
    archived: '已归档',
  }
  return (
    <div className="space-y-2">
      {projects.map((p) => (
        <button
          key={p.id}
          className="flex w-full items-center gap-3 rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-container-low"
          onClick={() => onOpen(p.id)}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="min-w-0 flex-1 truncate text-[0.9286rem] font-medium">{p.name}</span>
          {p.budget != null && (
            <span className="shrink-0 text-[0.7857rem] text-outline">
              预算 {fmtMoney(p.budget)}
            </span>
          )}
          <Chip tone={p.status === 'active' ? 'green' : 'gray'}>{STATUS_LABEL[p.status]}</Chip>
        </button>
      ))}
    </div>
  )
}

/** 明细区 · 资料：档案属性全量成列（身份条只做摘要，完整属性唯一出处在此）+ 关联笔记 */
function ProfileTab({
  customer,
  notes,
  onOpenNote,
}: {
  customer: Customer
  notes: Note[]
  onOpenNote: (noteId: string) => void
}) {
  // 可复制字段（与同步前的「即时通讯与联系渠道」能力对齐，唯一出处收敛于此）
  const rows: [string, string, boolean?][] = [
    ['公司', customer.company || '—'],
    ['职位', customer.title || '—'],
    ['决策层级', customer.decisionLevel || '—'],
    ['客户分层', customer.tier === '潜在' ? '潜在' : `${customer.tier} 层`],
    ['手机号码', customer.phone || '—', true],
    ['企业微信', customer.wechat || '—', true],
    ['工作邮箱', customer.email || '—', true],
    ['地址', customer.address || '—'],
    ['标签', customer.tags.length > 0 ? customer.tags.map((t) => `#${t}`).join(' ') : '—'],
    [
      '客户关系',
      (customer.relations ?? []).length > 0
        ? (customer.relations ?? []).map((r) => r.label).join(' / ')
        : '—',
    ],
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl bg-surface-container-low/60 p-4">
        <div className="mb-2 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
          档案属性
        </div>
        <dl className="space-y-1.5 text-[0.8571rem]">
          {rows.map(([k, v, copyable]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-20 shrink-0 text-outline">{k}</dt>
              <dd className="flex min-w-0 flex-1 items-start gap-1.5 break-words">
                <span className="min-w-0 flex-1 break-words">{v}</span>
                {copyable && v !== '—' && <CopyChip text={v} />}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="rounded-xl bg-surface-container-low/60 p-4">
        <div className="mb-2 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
          关联笔记
        </div>
        {notes.length === 0 ? (
          <div className="text-[0.7857rem] text-outline">
            暂无 @ 本客户的笔记，在笔记中用 @ 提及客户即可建立关联
          </div>
        ) : (
          <div className="space-y-1.5">
            {notes.map((n) => (
              <button
                key={n.id}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.8571rem] transition-colors hover:bg-surface-container-low"
                onClick={() => onOpenNote(n.id)}
              >
                <Icon name="description" size={14} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{n.title || '未命名笔记'}</span>
                <Icon name="chevron_right" size={14} className="shrink-0 text-outline" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 时间轴单条：手写沟通保持原蓝 Chip；关联财务/事件渲染为系统样式（金额色 / 优先级色） */
function TimelineItem({
  event,
  onOpenTxn,
}: {
  event: TimelineEvent
  /** 关联记账行点击穿透：打开 /finance?focus=<txnId> 凭证详情（Issue #147） */
  onOpenTxn: (txnId: string) => void
}) {
  if (event.kind === 'transaction') {
    const income = event.direction === 'income'
    return (
      <div className="relative">
        <span className="absolute -left-[22px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-container-low">
          <Icon
            name={KIND_ICONS.transaction}
            size={12}
            className={income ? 'text-success' : 'text-danger'}
          />
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={income ? 'green' : 'red'} icon={KIND_ICONS.transaction}>
            关联记账 · {income ? '收入' : '支出'}
          </Chip>
          {event.status === '待对账' && <Chip tone="gray">待对账</Chip>}
          <span className="text-[0.8571rem] text-outline">{fmtTimelineTime(event.at)}</span>
        </div>
        <button
          type="button"
          title="点击查看凭证详情"
          className="mt-1 flex w-full cursor-pointer flex-wrap items-center gap-2 rounded-lg bg-surface-container-low/50 px-3 py-2 text-left text-[0.9286rem] leading-relaxed transition-colors hover:bg-surface-container-low"
          onClick={() => onOpenTxn(event.recordId)}
        >
          <span className="truncate">{event.summary}</span>
          <span className={`ml-auto shrink-0 font-bold ${income ? 'text-success' : 'text-danger'}`}>
            {income ? '+' : '-'}
            {fmtMoney(event.amount)}
          </span>
        </button>
      </div>
    )
  }
  if (event.kind === 'todo') {
    // 三态（Issue #128）：完成=绿「完成待办」/ 作废=灰「作废待办」/ 进行中=琥珀「新增待办」
    const done = event.status === 'done'
    const voided = event.status === 'voided'
    return (
      <div className="relative">
        <span className="absolute -left-[22px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-container-low">
          <Icon
            name={voided ? 'block' : KIND_ICONS.todo}
            size={12}
            className={done ? 'text-success' : voided ? 'text-outline' : 'text-primary'}
          />
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={done ? 'green' : voided ? 'gray' : 'amber'} icon={voided ? 'block' : KIND_ICONS.todo}>
            {done ? '完成待办' : voided ? '作废待办' : '新增待办'}
          </Chip>
          <Chip tone={todoPriorityTone(event.priority)}>{todoPriorityLabel(event.priority)}</Chip>
          <span className="text-[0.8571rem] text-outline">{fmtTimelineTime(event.at)}</span>
        </div>
        <p className="mt-1 rounded-lg bg-surface-container-low/50 px-3 py-2 text-[0.9286rem] leading-relaxed">
          {event.title}
        </p>
      </div>
    )
  }
  return (
    <div className="relative">
      <span className="absolute -left-[22px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary-fixed">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="blue" icon={TYPE_ICONS[event.type]}>
          {event.type}
        </Chip>
        <span className="text-[0.8571rem] text-outline">{fmtTimelineTime(event.at)}</span>
      </div>
      <p className="mt-1 rounded-lg bg-surface-container-low/50 px-3 py-2 text-[0.9286rem] leading-relaxed">
        {event.content}
      </p>
    </div>
  )
}

/** 资料 Tab 内联复制按钮（联系方式复制能力保留，唯一出处） */
function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="shrink-0 text-[0.7857rem] font-semibold text-primary hover:underline"
      onClick={() => {
        copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function copyText(text: string) {
  if (!text) return
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text)
    return
  }
  // 非安全上下文兜底
  const el = document.createElement('textarea')
  el.value = text
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}

/** 快速记一笔：类型 + 内容 → interactions 表，并联动刷新 lastContactAt */
function QuickLog({ customerId }: { customerId: string }) {
  const [type, setType] = useState<Interaction['type']>('电话')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!content.trim() || saving) return
    setSaving(true)
    try {
      // 原子双写：日志落库 + 客户 lastContactAt 刷新在同一事务完成
      const at = Date.now()
      // 事件（customer:contacted）已下沉 saveInteractionAndTouchCustomer（事务 commit 后统一 emit），
      // UI 侧不再内联 emit，避免双发。
      await saveInteractionAndTouchCustomer(
        { id: newId('itx'), customerId, type, content: content.trim(), at },
        customerId,
      )
      setContent('')
    } catch (err) {
      console.error('[QuickLog] 保存沟通日志失败', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl bg-surface-container-low/60 p-3">
      <div className="mb-2 flex gap-1.5">
        {INTERACTION_TYPE_OPTIONS.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[0.8571rem] transition-colors ${
              type === t
                ? 'border-primary bg-primary-fixed font-semibold text-primary'
                : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Icon name={TYPE_ICONS[t]} size={14} />
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void save()}
          placeholder="如：确认了二期验收标准，下周回签合同…"
        />
        <Button icon="send" disabled={!content.trim() || saving} onClick={() => void save()}>
          记录
        </Button>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import type { Customer } from '@/db/types'
import { Avatar, Button, Card, Chip, EmptyState, PageHeader, inputCls } from '@/design-system/ui'
import CustomerFormDrawer from './CustomerFormDrawer'
import { fmtRelative, healthColor, tierChipTone } from './shared'

/** 客户管理主页面（对齐原型 08-crm-list） */
export default function CrmPage() {
  const customers = useCollection<Customer>('customers')
  const navigate = useNavigate()
  const [tierFilter, setTierFilter] = useState<'all' | Customer['tier']>('all')
  const [industryFilter, setIndustryFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const industries = useMemo(
    () => Array.from(new Set(customers.map((c) => c.industry).filter(Boolean))).sort(),
    [customers],
  )

  const counts = {
    total: customers.length,
    s: customers.filter((c) => c.tier === 'S').length,
    a: customers.filter((c) => c.tier === 'A').length,
    b: customers.filter((c) => c.tier === 'B').length,
  }

  const list = customers
    .filter((c) => {
      if (tierFilter !== 'all' && c.tier !== tierFilter) return false
      if (industryFilter !== 'all' && c.industry !== industryFilter) return false
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        const haystack = [c.name, c.company, c.title, c.industry, c.tags.join(' ')]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(kw)) return false
      }
      return true
    })
    .sort((a, b) => b.lastContactAt - a.lastContactAt)

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户管理"
        subtitle="客户档案 · 智能管家 · 关系画布，跨系统商机与资金流向回溯"
        actions={
          <>
            <Button variant="ghost" icon="hub" onClick={() => navigate('/crm/canvas')}>
              关系画布
            </Button>
            <Button icon="person_add" onClick={() => setFormOpen(true)}>
              新建客户
            </Button>
          </>
        }
      />

      {/* 顶部统计 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="客户总数"
          icon="group"
          iconCls="bg-primary-fixed text-primary"
          value={counts.total}
          sub="全部活跃档案"
        />
        <StatCard
          label="S 层 · 核心战略"
          icon="workspace_premium"
          iconCls="bg-danger-container text-danger"
          value={counts.s}
          sub="最高优先跟进"
        />
        <StatCard
          label="A 层 · 重点"
          icon="star"
          iconCls="bg-warning-container text-warning"
          value={counts.a}
          sub="重点客户池"
        />
        <StatCard
          label="B 层 · 常规"
          icon="person"
          iconCls="bg-surface-container-high text-on-surface-variant"
          value={counts.b}
          sub="常规维护节奏"
        />
      </div>

      {/* 筛选工具栏：分层 / 行业 / 关键字 */}
      <div className="mb-3 mt-5 flex flex-wrap items-center gap-2">
        <Segmented
          options={[
            { key: 'all', label: `全部 (${counts.total})` },
            { key: 'S', label: `S 层 (${counts.s})` },
            { key: 'A', label: `A 层 (${counts.a})` },
            { key: 'B', label: `B 层 (${counts.b})` },
            { key: '潜在', label: '潜在' },
          ]}
          value={tierFilter}
          onChange={(v) => setTierFilter(v as typeof tierFilter)}
        />
        <select
          className={`${inputCls} w-44`}
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
        >
          <option value="all">全部行业</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <div className="ml-auto w-56">
          <input
            className={inputCls}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="按姓名、公司、职位、标签检索…"
          />
        </div>
      </div>

      {/* 客户列表 */}
      {list.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon="group"
            title={customers.length === 0 ? '还没有客户档案' : '没有符合条件的客户'}
            description={
              customers.length === 0 ? '点击右上角「新建客户」建立第一份档案' : '调整筛选条件试试'
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-outline-variant/30 px-5">
          {list.map((c) => (
            <CustomerRow key={c.id} customer={c} onOpen={() => navigate(`/crm/${c.id}`)} />
          ))}
        </Card>
      )}

      <CustomerFormDrawer open={formOpen} customer={null} onClose={() => setFormOpen(false)} />
    </div>
  )
}

function StatCard({
  label,
  icon,
  iconCls,
  value,
  sub,
}: {
  label: string
  icon: string
  iconCls: string
  value: number
  sub: string
}) {
  return (
    <div className="card p-4">
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
      <div className="mt-1 text-[1.5714rem] font-bold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[0.7857rem] text-outline">{sub}</div>
    </div>
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

function CustomerRow({ customer: c, onOpen }: { customer: Customer; onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer items-center gap-4 px-2 py-3.5 transition-colors hover:bg-surface-container-low/40"
    >
      <Avatar name={c.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[1rem] font-semibold">{c.name}</span>
          <Chip tone={tierChipTone(c.tier)}>{c.tier === '潜在' ? '潜在' : `${c.tier} 层`}</Chip>
        </div>
        <div className="mt-0.5 truncate text-[0.8571rem] text-on-surface-variant">
          {c.company || '—'}
          {c.title ? ` · ${c.title}` : ''}
          {c.industry ? ` · ${c.industry}` : ''}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {c.tags.map((t) => (
            <Chip key={t} tone="gray">
              #{t}
            </Chip>
          ))}
        </div>
      </div>
      <div className="hidden w-32 shrink-0 md:block">
        <div className="flex items-center justify-between text-[0.7857rem]">
          <span className="text-on-surface-variant">健康指数</span>
          <span className="font-bold" style={{ color: healthColor(c.healthScore) }}>
            {c.healthScore}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${c.healthScore}%`, background: healthColor(c.healthScore) }}
          />
        </div>
      </div>
      <div className="hidden w-28 shrink-0 text-right lg:block">
        <div className="text-[0.8571rem] text-on-surface-variant">最近联系</div>
        <div className="text-[0.8571rem] font-medium">{fmtRelative(c.lastContactAt)}</div>
      </div>
      <Icon
        name="chevron_right"
        className="text-[1.2857rem] text-outline opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  )
}

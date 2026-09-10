import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import type { Customer, CustomerGroup } from '@/db/types'
import { matchGroup } from '@/db/types'
import {
  Avatar,
  Button,
  Card,
  Chip,
  Modal,
  useAutoFocus,
  EmptyState,
  Field,
  PageHeader,
  inputCls,
} from '@/design-system/ui'
import CustomerFormDrawer from './CustomerFormDrawer'
import { fmtRelative, healthColor, normalizeTags, tierChipTone } from './shared'
import {
  useCustomerGroups,
  useCustomerGroupCounts,
  useTagSuggestions,
  createCustomerGroup,
  updateCustomerGroup,
  deleteCustomerGroup,
} from './hooks'

/** 客户管理主页面（对齐原型 08-crm-list） */
export default function CrmPage() {
  const customers = useCollection<Customer>('customers')
  const navigate = useNavigate()
  const [group, setGroup] = useState<'all' | Customer['tier']>('all')
  const [keyword, setKeyword] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  // 自定义分组（Issue #63）：选中分组 id 与编辑弹层
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [editorGroup, setEditorGroup] = useState<CustomerGroup | 'new' | null>(null)

  const customGroups = useCustomerGroups()
  const groupCounts = useCustomerGroupCounts(customers, customGroups)
  const selectedGroup = customGroups.find((g) => g.id === selectedGroupId) ?? null

  const counts = {
    total: customers.length,
    s: customers.filter((c) => c.tier === 'S').length,
    a: customers.filter((c) => c.tier === 'A').length,
    b: customers.filter((c) => c.tier === 'B').length,
    potential: customers.filter((c) => c.tier === '潜在').length,
  }

  /** 左侧分组项：全部 + 各分层 */
  const groups: { key: 'all' | Customer['tier']; label: string; icon: string }[] = [
    { key: 'all', label: '全部客户', icon: 'group' },
    { key: 'S', label: 'S 层 · 核心战略', icon: 'workspace_premium' },
    { key: 'A', label: 'A 层 · 重点', icon: 'star' },
    { key: 'B', label: 'B 层 · 常规', icon: 'person' },
    { key: '潜在', label: '潜在客户', icon: 'trending_up' },
  ]

  const list = customers
    .filter((c) => {
      if (group !== 'all' && c.tier !== group) return false
      if (selectedGroup && !matchGroup(c, selectedGroup)) return false
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase()
        const haystack = [c.name, c.company, c.title, c.tags.join(' ')]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(kw)) return false
      }
      return true
    })
    .sort((a, b) => b.lastContactAt - a.lastContactAt)

  const groupCount = (g: (typeof groups)[number]['key']) =>
    g === 'all'
      ? counts.total
      : g === 'S'
        ? counts.s
        : g === 'A'
          ? counts.a
          : g === 'B'
            ? counts.b
            : counts.potential

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

      <div className="flex items-start gap-4">
        {/* 左栏：客户分组菜单 */}
        <Card className="w-60 shrink-0 self-start p-4">
          <div className="mb-3 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
            客户分组
          </div>
          <div className="flex flex-col gap-0.5">
            {groups.map((g) => (
              <button
                key={g.key}
                onClick={() => {
                  setGroup(g.key)
                  setSelectedGroupId(null)
                }}
                className={`app-nav-link flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.9286rem] transition-colors ${
                  group === g.key && !selectedGroupId
                    ? 'bg-primary-fixed font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <Icon
                  name={g.icon}
                  size={16}
                  className={group === g.key && !selectedGroupId ? 'text-primary' : 'text-outline'}
                />
                <span className="min-w-0 flex-1 truncate">{g.label}</span>
                <span
                  className={`shrink-0 text-[0.7857rem] ${group === g.key && !selectedGroupId ? 'text-primary/70' : 'text-outline'}`}
                >
                  {groupCount(g.key)}
                </span>
              </button>
            ))}
          </div>

          {/* 我的分组：自定义 tag 规则圈人，实时计数，可增/改名/改规则/删（Issue #63） */}
          <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 px-1 pt-2 pb-1">
            <span className="text-[0.7857rem] font-semibold uppercase tracking-wider text-outline">
              我的分组
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {customGroups.map((g) => (
              <div
                key={g.id}
                className={`app-nav-link group/g flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.9286rem] transition-colors ${
                  selectedGroupId === g.id
                    ? 'bg-primary-fixed font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setSelectedGroupId(selectedGroupId === g.id ? null : g.id)}
                >
                  <Icon
                    name="flag"
                    size={16}
                    className={selectedGroupId === g.id ? 'text-primary' : 'text-outline'}
                  />
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                </button>
                <span
                  className={`shrink-0 text-[0.7857rem] ${selectedGroupId === g.id ? 'text-primary/70' : 'text-outline'}`}
                >
                  {groupCounts[g.id] ?? 0}
                </span>
                <span className="hidden shrink-0 items-center gap-1 group-hover/g:flex">
                  <button
                    title="编辑分组"
                    className="text-outline hover:text-primary"
                    onClick={() => setEditorGroup(g)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    title="删除分组"
                    className="text-outline hover:text-danger"
                    onClick={() => void removeGroup(g.id)}
                  >
                    <Icon name="delete" size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setEditorGroup('new')}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-outline-variant px-2.5 py-2 text-[0.8929rem] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            <Icon name="add" size={15} />
            新建分组
          </button>
        </Card>

        {/* 右侧：统计 + 列表 */}
        <div className="min-w-0 flex-1">
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

          {/* 筛选工具栏：关键字 */}
          <div className="mb-3 mt-5 flex items-center gap-2">
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
                  customers.length === 0
                    ? '点击右上角「新建客户」建立第一份档案'
                    : '调整筛选条件试试'
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
        </div>
      </div>

      <CustomerFormDrawer open={formOpen} customer={null} onClose={() => setFormOpen(false)} />

      <GroupEditorDrawer
        group={editorGroup === 'new' ? null : editorGroup}
        customers={customers}
        open={editorGroup !== null}
        onClose={() => setEditorGroup(null)}
      />
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

async function removeGroup(id: string) {
  await deleteCustomerGroup(id)
}

/**
 * 新建/编辑分组弹层（Issue #63）：起名 → 从聚合标签联想挑 include/exclude → 实时预览命中人数。
 * 第一期 AND + NOT；OR（DNF）下一迭代加「再添加一组条件」即可，数据结构已预留。
 */
function GroupEditorDrawer({
  group,
  customers,
  open,
  onClose,
}: {
  group: CustomerGroup | null
  customers: Customer[]
  open: boolean
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [includeRaw, setIncludeRaw] = useState('')
  const [excludeRaw, setExcludeRaw] = useState('')
  const [error, setError] = useState('')
  const nameRef = useAutoFocus<HTMLInputElement>()

  const openKey = `${open}-${group?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    if (open) {
      setName(group?.name ?? '')
      setIncludeRaw(group?.includeTags.join(', ') ?? '')
      setExcludeRaw(group?.excludeTags.join(', ') ?? '')
      setError('')
    }
  }

  // 标签归一化抽共享工具（Issue #63）：配组界面与客户表单共用，避免打错字导致分组失效
  const includeTags = normalizeTags(includeRaw)
  const excludeTags = normalizeTags(excludeRaw)

  // 联想候选：现有客户 tags 实时 distinct（按热度排序），非强制 —— 手打照旧
  const suggestions = useTagSuggestions(customers)
  const draftGroup: CustomerGroup = {
    id: group?.id ?? 'draft',
    name: name.trim(),
    includeTags,
    excludeTags,
    sortOrder: group?.sortOrder ?? 0,
    createdAt: group?.createdAt ?? 0,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
  const previewCount = customers.filter((c) => matchGroup(c, draftGroup)).length

  async function save() {
    if (!name.trim()) {
      setError('请填写分组名称')
      return
    }
    if (includeTags.length === 0) {
      setError('至少选择一个须包含的标签')
      return
    }
    if (group) {
      await updateCustomerGroup(group.id, { name: name.trim(), includeTags, excludeTags })
    } else {
      await createCustomerGroup({ name, includeTags, excludeTags })
    }
    onClose()
  }

  return (
    <Modal open={open} title={group ? '编辑分组' : '新建分组'} onClose={onClose} size="md">
      <Field label="分组名称 *">
        <input
          ref={nameRef}
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：重点培育"
        />
      </Field>
      <TagRuleField
        label="须包含标签（全部命中，AND）"
        raw={includeRaw}
        onRawChange={setIncludeRaw}
        tags={includeTags}
        suggestions={suggestions.filter((t) => !includeTags.includes(t))}
        placeholder="如：续约意向, 大客户"
        onPick={(t) => setIncludeRaw((r) => (r.trim() ? `${r.trim()}, ${t}` : t))}
      />
      <TagRuleField
        label="排除标签（命中任一即剔除，NOT）"
        raw={excludeRaw}
        onRawChange={setExcludeRaw}
        tags={excludeTags}
        suggestions={suggestions.filter((t) => !excludeTags.includes(t))}
        placeholder="如：已流失"
        onPick={(t) => setExcludeRaw((r) => (r.trim() ? `${r.trim()}, ${t}` : t))}
      />
      <div className="mb-4 rounded-lg bg-surface-container-low px-3 py-2.5 text-[0.9286rem]">
        <span className="text-on-surface-variant">实时预览命中：</span>
        <span className="font-bold text-primary">{previewCount}</span>
        <span className="text-on-surface-variant"> 位客户</span>
      </div>
      {error && <div className="mb-3 text-[0.8929rem] text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button onClick={() => void save()}>{group ? '保存' : '创建'}</Button>
      </div>
    </Modal>
  )
}

/** 标签规则输入：手打 + 聚合联想点击补入，已选回显 Chip 可删 */
function TagRuleField({
  label,
  raw,
  onRawChange,
  tags,
  suggestions,
  placeholder,
  onPick,
}: {
  label: string
  raw: string
  onRawChange: (v: string) => void
  tags: string[]
  suggestions: string[]
  placeholder: string
  onPick: (tag: string) => void
}) {
  return (
    <Field label={label}>
      <input
        className={inputCls}
        value={raw}
        onChange={(e) => onRawChange(e.target.value)}
        placeholder={placeholder}
      />
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button key={t} onClick={() => onRawChange(tags.filter((x) => x !== t).join(', '))}>
              <Chip tone="gray">#{t} ×</Chip>
            </button>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[0.7857rem] text-outline">联想：</span>
          {suggestions.slice(0, 8).map((t) => (
            <button
              key={t}
              onClick={() => onPick(t)}
              className="rounded-full border border-outline-variant px-2 py-0.5 text-[0.8214rem] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            >
              #{t}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}

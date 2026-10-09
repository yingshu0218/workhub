import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import type { Customer, CustomerGroup, IntimacyLevel } from '@/db/types'
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
import { fmtRelative, normalizeTags } from './shared'
import { filterBlacklisted, useIntimacyConfig, resolveIntimacyLevel } from './intimacy'
import { resolveHealthScoreDisplay } from './healthScore'
import {
  useCustomerGroups,
  useCustomerGroupCounts,
  useTagSuggestions,
  useCustomerScoreRows,
  createCustomerGroup,
  updateCustomerGroup,
  deleteCustomerGroup,
  reorderCustomerGroups,
  moveInOrder,
} from './hooks'

/** 客户管理主页面（对齐原型 08-crm-list） */
export default function CrmPage() {
  const customers = useCollection<Customer>('customers')
  const navigate = useNavigate()
  // 左侧分层维度：原手动 tier 已并入健康分，分组直接按健康分档位（key 取自配置，档位名随配置可变）
  const [group, setGroup] = useState<'all' | IntimacyLevel>('all')
  const [keyword, setKeyword] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  // 自定义分组（Issue #63）：选中分组 id 与编辑弹层
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [editorGroup, setEditorGroup] = useState<CustomerGroup | 'new' | null>(null)
  // 分组的拖拽排序（用例 #34）：记录被拖起的 id，落点由目标项决定
  const [dragGroupId, setDragGroupId] = useState<string | null>(null)

  const customGroups = useCustomerGroups()
  const intimacyCfg = useIntimacyConfig()
  /**
   * 黑名单「时间线隐藏」（缺陷 D15）：列表与所有计数一律按**可见集**算 ——
   * 配置文案写的是「客户列表与时间线中隐藏（仅档案直接访问可见）」，
   * 所以档案页（含单客户时间线）不受影响，只屏蔽「列举客户」的这些面。
   */
  const visibleCustomers = filterBlacklisted(customers, intimacyCfg, 'hideInTimeline')
  // 算法兜底入参只需为「未手动设置档位」的客户计算（批次查询，避免 N+1）。
  // 刻意用**全量** customers：它是算法输入而不是列表呈现，被隐藏的客户一旦不再被列举，
  // 若从入参里摘掉会让算法分凭空变化（口径漂移）。
  const scoreInputs = useCustomerScoreRows(
    customers.filter((c) => !c.intimacy?.level).map((c) => c.id),
  )
  const groupCounts = useCustomerGroupCounts(visibleCustomers, customGroups)
  const selectedGroup = customGroups.find((g) => g.id === selectedGroupId) ?? null

  /**
   * 每客户解析出的健康分档位（手动优先 → 算法兜底）—— 分组、统计与行内 chip 共用这一份口径。
   * 原手动 `tier` 已删除，分层维度统一由健康分承担（两套分层合并为一套）。
   */
  const levelOf = (c: Customer): IntimacyLevel =>
    resolveIntimacyLevel(c, intimacyCfg, scoreInputs[c.id] ?? null).level

  /** 各健康分档位人数（key 从配置派生，档位名随配置可变） */
  const counts: Record<string, number> = { total: visibleCustomers.length }
  for (const lv of intimacyCfg.levels) counts[lv.key] = 0
  for (const c of visibleCustomers) {
    const key = levelOf(c)
    counts[key] = (counts[key] ?? 0) + 1
  }

  /** 左侧分组项：全部 + 各健康分档位 */
  const groups: { key: 'all' | IntimacyLevel; label: string; icon: string }[] = [
    { key: 'all', label: '全部客户', icon: 'group' },
    ...intimacyCfg.levels.map((lv) => ({
      key: lv.key,
      label: `${lv.key} · ${lv.name}`,
      icon: 'favorite',
    })),
  ]

  const list = visibleCustomers
    .filter((c) => {
      if (group !== 'all' && levelOf(c) !== group) return false
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

  const groupCount = (g: 'all' | IntimacyLevel) =>
    g === 'all' ? visibleCustomers.length : (counts[g] ?? 0)

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
                /* 拖拽排序（用例 #34）：内置分组（全部/S/A/B/潜在）是固定顺序不参与，
                   只有自定义分组可拖 —— 它们的 sortOrder 才是用户语义上的「我的排序」 */
                draggable
                onDragStart={(e) => {
                  setDragGroupId(g.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => setDragGroupId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (!dragGroupId || dragGroupId === g.id) return
                  const ids = customGroups.map((x) => x.id)
                  const from = ids.indexOf(dragGroupId)
                  const to = ids.indexOf(g.id)
                  if (from < 0 || to < 0) return
                  void reorderCustomerGroups(moveInOrder(ids, from, to))
                  setDragGroupId(null)
                }}
                className={`app-nav-link group/g flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.9286rem] transition-colors ${
                  dragGroupId === g.id ? 'opacity-40' : ''
                } ${
                  selectedGroupId === g.id
                    ? 'bg-primary-fixed font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                {/* 拖拽手柄：仅作视觉提示（整行都可拖，与 /todo 清单、/finance 账本同款写法
                    与同一个 ⠿ 字符），hover 或正在拖时可见，避免常态下与「编辑/删除」抢注意力 */}
                <span
                  title="拖动调整分组顺序"
                  className={`-ml-1 shrink-0 cursor-grab text-[1rem] leading-none text-outline/60 transition-opacity group-hover/g:text-outline ${
                    dragGroupId ? 'opacity-100' : 'opacity-0 group-hover/g:opacity-100'
                  }`}
                >
                  ⠿
                </span>
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
          {/* 顶部统计：总数 + 健康分前 3 档（档位名/顺序/说明全部从配置派生。
              原「S/A/B 分层」四张卡已合并到此 —— 手动分层并入健康分后不再有第二套维度） */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="客户总数"
              icon="group"
              iconCls="bg-primary-fixed text-primary"
              value={visibleCustomers.length}
              sub="全部活跃档案"
            />
            {intimacyCfg.levels.slice(0, 3).map((lv, i) => (
              <StatCard
                key={lv.key}
                label={`${lv.key} · ${lv.name}`}
                icon={TOP_LEVEL_ICONS[i]?.icon ?? 'favorite'}
                iconCls={
                  TOP_LEVEL_ICONS[i]?.cls ?? 'bg-surface-container-high text-on-surface-variant'
                }
                value={counts[lv.key] ?? 0}
                sub={lv.desc}
              />
            ))}
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
                <CustomerRow
                  key={c.id}
                  customer={c}
                  intimacyCfg={intimacyCfg}
                  scoreInputs={scoreInputs}
                  onOpen={() => navigate(`/crm/${c.id}`)}
                />
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

/** 顶部健康分统计卡的图标与配色（按档位序取，第 4 档起用兜底样式） */
const TOP_LEVEL_ICONS = [
  { icon: 'workspace_premium', cls: 'bg-danger-container text-danger' },
  { icon: 'star', cls: 'bg-warning-container text-warning' },
  { icon: 'person', cls: 'bg-surface-container-high text-on-surface-variant' },
]

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

function CustomerRow({
  customer: c,
  intimacyCfg,
  scoreInputs,
  onOpen,
}: {
  customer: Customer
  intimacyCfg: ReturnType<typeof useIntimacyConfig>
  /** 未手动设置档位的客户的算法入参（批次查询结果，缺失即「未设置」文案的旧口径兜底） */
  scoreInputs: Record<string, Parameters<typeof resolveIntimacyLevel>[2]>
  onOpen: () => void
}) {
  // 健康分档位（原亲密度，Issue #108）：手动优先 → 算法兜底。
  // 未手动设置时不再显示「未设置」——按用户拍板，算法推断的档位用括号标出，与详情页口径统一。
  const healthLevel = resolveHealthScoreDisplay(c, intimacyCfg, scoreInputs[c.id] ?? null)
  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer items-center gap-4 px-2 py-3.5 transition-colors hover:bg-surface-container-low/40"
    >
      <Avatar name={c.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[1rem] font-semibold">{c.name}</span>
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
          <span className="text-on-surface-variant">健康分</span>
          <span
            className="font-bold"
            style={{
              color: healthLevel.color,
            }}
          >
            {healthLevel.label}
          </span>
        </div>
        <div className="mt-1 text-right text-[0.7857rem] text-outline">
          {healthLevel.manual ? '手动设置' : '算法推断 · 未手动设置'}
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
  const nameRef = useAutoFocus<HTMLInputElement>(open)

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

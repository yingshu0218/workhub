import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import { customerRepo } from '@/repositories'
import { useIsMobile } from '@/shared/useIsMobile'
import type { Customer, CustomerGroup, IntimacyLevel, ModuleConfigIntimacy } from '@/db/types'
import { INTIMACY_VISUAL, customerInGroup, matchGroup } from '@/db/types'
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
import { staggerStyle } from '@/shared/stagger'
import { fmtRelative, normalizeTags, tagsForGroupJoin } from './shared'
import { fmtMoney } from './timeline'
import { filterBlacklisted, useIntimacyConfig, resolveIntimacyLevel } from './intimacy'
import { resolveHealthScoreDisplay } from './healthScore'
import {
  useCustomerGroups,
  useCustomerGroupCounts,
  useCustomerListStats,
  STALE_FOLLOW_UP_DAYS,
  useTagSuggestions,
  useCustomerScoreRows,
  createCustomerGroup,
  updateCustomerGroup,
  deleteCustomerGroup,
  reorderCustomerGroups,
  moveInOrder,
} from './hooks'

/**
 * 窄屏筛选 chips 的胶囊外形（只留「选中态」差异给调用处拼）：
 * 两个调用处（全部 / 各档位）必须同一外形，否则一行横滑里会出现高矮不齐。
 */
const filterChip =
  'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[0.9286rem] transition-colors'
const filterChipIdle =
  'border-outline-variant bg-surface-container-lowest text-on-surface-variant'

/** 客户管理主页面（对齐原型 08-crm-list） */
export default function CrmPage() {
  const customers = useCollection<Customer>('customers')
  const navigate = useNavigate()
  /**
   * 桌面 / 窄屏互斥渲染的开关。
   *
   * 为什么不用「两份 DOM + `hidden md:*` / `md:hidden` 互斥」这套 CSS 断点写法（本次适配
   * 最初就是这么做的）：CSS 断点只在真实浏览器里生效，jsdom **不执行媒体查询** —— 两份内容
   * 会同时留在 DOM 里，同一个客户名被渲染两次，`findByText` / `getByText` 直接抛
   * 「Found multiple elements」；而且就算抛开测试，重复 DOM 本身也会让无障碍树多出一份同名
   * 节点、并付出双倍渲染开销。
   *
   * 所以凡结构真的不同处（页头、分组入口、工具栏、客户列表）都改由这里二选一，
   * `isMobile` 为 false 的一侧即本次适配前的原实现。
   */
  const isMobile = useIsMobile()
  /**
   * 筛选维度（改版）：**健康分/亲密度分层不再进左栏**。
   * 左栏只承载「用户自己加的分组」；分层收进工具栏浮层，并作为**与自定义分组正交的筛选条件**
   * （两者可叠加：自定义分组圈人 ∩ 分层档位）。分层 key 取自配置，档位名随配置可变。
   */
  const [levelFilter, setLevelFilter] = useState<'all' | IntimacyLevel>('all')
  const [keyword, setKeyword] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  // 自定义分组（Issue #63）：选中分组 id 与编辑弹层
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [editorGroup, setEditorGroup] = useState<CustomerGroup | 'new' | null>(null)

  const customGroups = useCustomerGroups()
  const intimacyCfg = useIntimacyConfig()
  /**
   * 客户拖入分组（2026-10-16，2026-10-17 起分模式）：
   * - 手动组：**groupId 单选覆盖**——拖入即加入（自动离开原手动组），一个客户至多属一个手动组
   * - 规则组：补齐该组缺失的 includeTags（tagsForGroupJoin；刻意不做拖出，多组共享标签会误伤）
   * 两种都走 customerRepo.update（盖章 + 入队同步）。
   */
  /** 拖到「全部客户」= 清空手动分组归属（只对手动组成员有意义；规则组是标签判定无从「拖出」） */
  async function handleDropCustomerToAll(customerId: string) {
    const customer = customers.find((c) => c.id === customerId)
    if (!customer?.groupId) return
    try {
      await customerRepo.update(customerId, { groupId: undefined })
    } catch (err) {
      console.error('[crm] 移出分组失败', err)
    }
  }

  async function handleDropCustomer(customerId: string, groupId: string) {
    const group = customGroups.find((g) => g.id === groupId)
    const customer = customers.find((c) => c.id === customerId)
    if (!group || !customer) return
    try {
      if (customerInGroup(customer, group)) return // 已在该组：拖入无操作
      if ((group.kind ?? 'rule') === 'manual') {
        await customerRepo.update(customerId, { groupId: group.id })
        return
      }
      const merged = tagsForGroupJoin(customer.tags, group.includeTags)
      if (!merged) return // 已命中全部分组条件：拖入无操作
      await customerRepo.update(customerId, { tags: merged })
    } catch (err) {
      console.error('[crm] 拖入分组失败', err)
    }
  }
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
  // 顶部统计（改版）：口径全部与分层无关 —— 总数 / 本月新增 / 待跟进 / 待回收款
  const stats = useCustomerListStats(visibleCustomers)

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

  const list = visibleCustomers
    .filter((c) => {
      if (levelFilter !== 'all' && levelOf(c) !== levelFilter) return false
      if (selectedGroup && !customerInGroup(c, selectedGroup)) return false
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

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* 桌面页头（≥768px）：原样保留 */}
      {!isMobile && (
        <div className="hidden md:block">
          <PageHeader
            title="客户管理"
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
        </div>
      )}

      {/* 移动页头（<768px，原型 03）：标题压到两字、新建图标化 ——
          桌面那个带文字的「新建客户」按钮约 96px，加上标题与画布入口在 390px 里会撑破一行；
          关系画布入口另有落位，见列表上方的次级操作行。 */}
      {isMobile && (
        <header className="mb-4 flex items-center justify-between gap-3 md:hidden">
          <h1 className="min-w-0 truncate text-[1.2857rem] font-bold tracking-[-0.01em]">客户</h1>
          <button
            type="button"
            aria-label="新建客户"
            title="新建客户"
            onClick={() => setFormOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary transition-colors hover:bg-primary-container"
          >
            <Icon name="person_add" size={18} />
          </button>
        </header>
      )}

      <div className="flex items-start gap-4">
        {/* 左栏：客户分组菜单（改版：只放「用户自己加的分组」—— 分层是算法推断、用户改不了，
            与自定义分组混在一栏会让人以为分层也能增删改，已整体移到工具栏浮层）。

            窄屏（<768px）整栏撤掉：它是固定 240px 的兄弟列，留在 390px 里会把主列挤到
            100px 出头，必然横向溢出。分组是用户自己维护的筛选维度、不能一起砍掉，
            所以改由右侧列里的 <details> 折叠入口承载，两者共用同一个 CustomerGroupNav。 */}
        {!isMobile && (
          <Card className="hidden w-60 shrink-0 self-start p-4 md:block">
            <CustomerGroupNav
              groups={customGroups}
              counts={groupCounts}
              totalCount={visibleCustomers.length}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
              onEditGroup={setEditorGroup}
              onCreateGroup={() => setEditorGroup('new')}
              onDropCustomer={handleDropCustomer}
              onDropCustomerToAll={handleDropCustomerToAll}
            />
          </Card>
        )}

        {/* 右侧：统计 + 列表 */}
        <div className="min-w-0 flex-1">
          {/* 顶部统计（改版）：原「客户总数 + 健康分前 3 档」里三张是分层派生，
              按用户拍板一并移出列表页 —— 换成本页自己的业务指标，与分层维度彻底解耦 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="客户总数"
              icon="group"
              iconCls="bg-primary-fixed text-primary"
              value={stats.total}
              sub="全部活跃档案"
            />
            <StatCard
              label="本月新增"
              icon="trending_up"
              iconCls="bg-success-container/60 text-success"
              value={stats.newThisMonth}
              sub="本月建立档案"
            />
            <StatCard
              label="待跟进"
              icon="schedule"
              iconCls="bg-warning-container text-warning"
              value={stats.staleFollowUp}
              sub={`超 ${STALE_FOLLOW_UP_DAYS} 天未联系`}
            />
            <StatCard
              label="待回收款"
              icon="account_balance_wallet"
              iconCls="bg-success-container/60 text-success"
              value={fmtMoney(stats.pendingReceivable)}
              sub={stats.topReceivable ?? '暂无待对账收入'}
            />
          </div>

          {/* 移动工具栏（<768px）：搜索占满整行 + 健康分筛选 chips。
              桌面的「输入框 w-56 + 下拉浮层 + 计数」三件套在 390px 里排不下（合计约 460px，
              换行后会散成两三行），所以窄屏换成上下两段。 */}
          {isMobile && (
            <div className="mb-3 mt-4 md:hidden">
              <input
                className={inputCls}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="按姓名、公司、职位、标签检索…"
              />
              {/* 横向滚动而不是 flex-wrap：档位数由配置决定（可能 7 档），换行会把工具栏
                  挤成三四排、把列表压到屏幕外。滚动条在触摸端没有操作价值，一并隐藏。 */}
              <div className="mt-2.5 -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => setLevelFilter('all')}
                  className={`${filterChip} ${
                    levelFilter === 'all'
                      ? 'border-primary bg-primary-fixed font-medium text-primary'
                      : filterChipIdle
                  }`}
                >
                  全部 · {visibleCustomers.length}
                </button>
                {intimacyCfg.levels.map((lv) => {
                  const on = levelFilter === lv.key
                  return (
                    <button
                      key={lv.key}
                      type="button"
                      onClick={() => setLevelFilter(lv.key)}
                      /* 选中态沿用图谱圈层色（INTIMACY_VISUAL）：档位→颜色是同一个语义，
                         在此另写一套色板必然与图谱漂移 */
                      style={
                        on
                          ? {
                              borderColor: INTIMACY_VISUAL[lv.key].color,
                              color: INTIMACY_VISUAL[lv.key].color,
                              background: `${INTIMACY_VISUAL[lv.key].color}1f`,
                            }
                          : undefined
                      }
                      className={`${filterChip} ${on ? 'font-medium' : filterChipIdle}`}
                    >
                      {lv.name} · {counts[lv.key] ?? 0}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 text-[0.8571rem] text-on-surface-variant">
                共 {list.length} 位客户
              </div>
            </div>
          )}

          {/* 筛选工具栏（≥768px）：关键字 + 亲密度（分层从左侧分组移出后的落位，二者可叠加） */}
          {!isMobile && (
            <div className="mb-3 mt-5 hidden flex-wrap items-center gap-2 md:flex">
              <div className="w-56">
                <input
                  className={inputCls}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="按姓名、公司、职位、标签检索…"
                />
              </div>
              <IntimacyFilterMenu
                cfg={intimacyCfg}
                counts={counts}
                total={visibleCustomers.length}
                value={levelFilter}
                onChange={setLevelFilter}
              />
              <span className="ml-auto text-[0.8571rem] text-on-surface-variant">
                共 {list.length} 位客户
              </span>
            </div>
          )}

          {/* 移动端次级操作行（<768px）：分组折叠入口 + 关系画布。
              两项都从主位降下来 —— 分组原是 240px 的左栏（窄屏放不下），画布原是带文字的页头按钮
              （窄屏与标题抢行）。展开后就是左栏那一份分组菜单（同一个组件，含新建/改名/改规则/删）。 */}
          {isMobile && (
            <div className="mb-3 flex items-start gap-2 md:hidden">
              <details className="group min-w-0 flex-1">
                <summary className="card flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <Icon name="group" size={16} className="text-outline" />
                  <span className="min-w-0 flex-1 truncate text-[0.9286rem] font-medium">
                    客户分组 · {selectedGroup?.name ?? '全部客户'}
                  </span>
                  <Icon
                    name="keyboard_arrow_down"
                    size={18}
                    /* 时长走 token（原为 Tailwind 默认 150ms，与 fast 档等价） */
                    className="text-outline transition-transform duration-[calc(var(--motion-duration-fast)*var(--motion-duration-scale))] group-open:rotate-180"
                  />
                </summary>
                <div className="card mt-2 p-3">
                  <CustomerGroupNav
                    groups={customGroups}
                    counts={groupCounts}
                    totalCount={visibleCustomers.length}
                    selectedGroupId={selectedGroupId}
                    onSelectGroup={setSelectedGroupId}
                    onEditGroup={setEditorGroup}
                    onCreateGroup={() => setEditorGroup('new')}
                    onDropCustomer={handleDropCustomer}
                    onDropCustomerToAll={handleDropCustomerToAll}
                    touch
                  />
                </div>
              </details>
              <button
                type="button"
                title="关系画布"
                onClick={() => navigate('/crm/canvas')}
                className="card flex shrink-0 items-center gap-1 px-3 py-2.5 text-[0.9286rem] text-on-surface-variant transition-colors hover:text-primary"
              >
                <Icon name="hub" size={16} />
                画布
              </button>
            </div>
          )}

          {/* 客户列表：桌面一行一表格行、窄屏一行一卡，两套结构由 isMobile 二选一 */}
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
            <>
              {/* 桌面（≥768px）：原结构逐像素不变 */}
              {!isMobile && (
                <Card className="hidden divide-y divide-outline-variant/30 px-5 md:block">
                  {list.map((c, i) => (
                    <CustomerRow
                      key={c.id}
                      customer={c}
                      intimacyCfg={intimacyCfg}
                      scoreInputs={scoreInputs}
                      index={i}
                      onOpen={() => navigate(`/crm/${c.id}`)}
                    />
                  ))}
                </Card>
              )}
              {/* 移动（<768px）：一行一卡 —— 桌面行把健康分/最近联系放在 w-32/w-28 的固定列里，
                  390px 下这两列没有摆放空间（连名带公司都会截断），所以整体换成卡片。 */}
              {isMobile && (
                <div className="flex flex-col gap-2 md:hidden">
                  {list.map((c, i) => (
                    <CustomerCard
                      key={c.id}
                      customer={c}
                      intimacyCfg={intimacyCfg}
                      scoreInputs={scoreInputs}
                      index={i}
                      onOpen={() => navigate(`/crm/${c.id}`)}
                    />
                  ))}
                </div>
              )}
            </>
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

/**
 * 亲密度筛选浮层（改版：分层从左侧「客户分组」移出，收进工具栏按钮）。
 *
 * 为什么不做成左栏的第二组条目：分层是**算法推断、用户不可编辑**，而「我的分组」是用户
 * 按 tag 规则自己圈的人 —— 两类东西混在一栏，既会让人以为分层可增删改，也让「分组」这个
 * 概念承担两种语义。收进按钮后它回到本位：一个**可与自定义分组叠加**的筛选条件。
 *
 * 点外关闭沿用 MatchCombobox / ChannelSelect / EntityLinkField 的既有口径
 * （`data-dropdown-root` 认内部 + window 冒泡阶段 `mousedown`），不新造第三套。
 */
function IntimacyFilterMenu({
  cfg,
  counts,
  total,
  value,
  onChange,
}: {
  cfg: ModuleConfigIntimacy
  /** 各分层命中人数（与左侧分组计数同源，由页面按可见集算出） */
  counts: Record<string, number>
  /** 「全部客户」人数（= 可见集大小） */
  total: number
  value: 'all' | IntimacyLevel
  onChange: (next: 'all' | IntimacyLevel) => void
}) {
  const [open, setOpen] = useState(false)
  const active = value !== 'all'
  const current = cfg.levels.find((lv) => lv.key === value)

  useEffect(() => {
    if (!open) return
    const isInside = (target: Node | null) =>
      target instanceof Element ? !!target.closest('[data-dropdown-root]') : false
    const onDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // Esc 关闭：走 window 捕获并在本层消费，避免冒泡给上层弹层顺手关掉别的东西
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const pick = (next: 'all' | IntimacyLevel) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div data-dropdown-root className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="按亲密度筛选"
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.9286rem] transition-colors ${
          active
            ? 'border-primary bg-primary-fixed font-medium text-primary'
            : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary hover:text-primary'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="tune" size={16} />
        <span className="whitespace-nowrap">
          亲密度 · {active ? (current?.name ?? value) : '全部'}
        </span>
        <Icon name="keyboard_arrow_down" size={16} className="text-outline" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="亲密度分层"
          className="surface-card absolute left-0 top-full z-20 mt-1 w-60 py-1 shadow-lg"
        >
          <button
            type="button"
            role="option"
            aria-selected={!active}
            onClick={() => pick('all')}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
              !active ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-hover'
            }`}
          >
            <Icon name="group" size={15} className="shrink-0 text-outline" />
            <span className="min-w-0 flex-1 truncate">全部客户</span>
            <span className="shrink-0 text-[0.7857rem]">{total}</span>
          </button>
          {cfg.levels.map((lv) => (
            <button
              key={lv.key}
              type="button"
              role="option"
              aria-selected={value === lv.key}
              onClick={() => pick(lv.key)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
                value === lv.key ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-hover'
              }`}
            >
              {/* 档位色沿用图谱圈层色（INTIMACY_VISUAL）：档位→颜色是同一个语义，
                  在此另写一套色板必然与图谱漂移 */}
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: INTIMACY_VISUAL[lv.key].color }}
              />
              <span className="min-w-0 flex-1 truncate">
                {lv.key} · {lv.name}
              </span>
              <span className="shrink-0 text-[0.7857rem]">{counts[lv.key] ?? 0}</span>
            </button>
          ))}
          {active && (
            <button
              type="button"
              onClick={() => pick('all')}
              className="mt-1 w-full border-t border-outline-variant/40 px-3 pb-1 pt-2 text-left text-[0.8571rem] text-primary hover:underline"
            >
              清除筛选条件
            </button>
          )}
        </div>
      )}
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
  /** 计数或已格式化金额（如「¥120,000」） */
  value: number | string
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
  index,
}: {
  customer: Customer
  intimacyCfg: ReturnType<typeof useIntimacyConfig>
  /** 未手动设置档位的客户的算法入参（批次查询结果，缺失即「未设置」文案的旧口径兜底） */
  scoreInputs: Record<string, Parameters<typeof resolveIntimacyLevel>[2]>
  onOpen: () => void
  /** 列表序号：仅用于错峰入场延迟（可选，不传则不参与错峰） */
  index?: number
}) {
  // 健康分档位（原亲密度，Issue #108）：手动优先 → 算法兜底。
  // 未手动设置时不再显示「未设置」——按用户拍板，算法推断的档位用括号标出，与详情页口径统一。
  const healthLevel = resolveHealthScoreDisplay(c, intimacyCfg, scoreInputs[c.id] ?? null)
  return (
    <div
      onClick={onOpen}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-nexus-customer', c.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      title="拖动到左侧分组可加入该分组（按分组规则补齐标签）"
      /* 错峰入场挂在行根：桌面 Card 用 `divide-y` 做分隔线、依赖直接子元素，
         故**不能**在外面包一层 div。 */
      style={staggerStyle(index)}
      className="anim-list-item group flex cursor-pointer items-center gap-4 px-2 py-3.5 transition-colors hover:bg-surface-hover-low"
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

/**
 * 窄屏客户卡（<768px，原型 03）：左头像 / 中姓名 + 健康分 chip + 一行次要信息 / 右最近联系。
 *
 * 为什么另起一份而不是让 CustomerRow 自己降级：桌面行是「头像 + 弹性主列 + 两个固定宽度
 * 指标列 + 尾巴图标」的四段横排，窄屏放不下固定列、也不该把一行折成三行 —— 结构与桌面不同，
 * 按仓库约定（`shared/useIsMobile.ts`）两侧各留一套结构。
 *
 * 右侧放「最近联系」而不是累计金额：客户档案里没有金额字段，列表页也没有按客户聚合成交额的
 * 领域查询（`useCustomerListStats` 只给全局待收款）。为避免在视图层直连 Dexie 现算，
 * 这里沿用桌面行右侧已经在显示的那个指标。
 */
function CustomerCard({
  customer: c,
  intimacyCfg,
  scoreInputs,
  onOpen,
  index,
}: {
  customer: Customer
  intimacyCfg: ReturnType<typeof useIntimacyConfig>
  scoreInputs: Record<string, Parameters<typeof resolveIntimacyLevel>[2]>
  onOpen: () => void
  /** 列表序号：仅用于错峰入场延迟（可选，不传则不参与错峰） */
  index?: number
}) {
  const healthLevel = resolveHealthScoreDisplay(c, intimacyCfg, scoreInputs[c.id] ?? null)
  return (
    <button
      type="button"
      onClick={onOpen}
      style={staggerStyle(index)}
      /* 仍挂 .card 而不是自己拼 border/bg：皮肤层（skins.css）按 `.card` 改圆角/描边/阴影，
         自己拼一份就会在换皮肤时变成唯一不长皮肤的那张卡。 */
      className="anim-list-item card flex w-full cursor-pointer items-center gap-3 p-3 text-left"
    >
      <Avatar name={c.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[1rem] font-semibold">{c.name}</span>
          {/* 档位色与桌面同源（resolveHealthScoreDisplay）；底色取同色 12% 透明，
              另配一套 chip 色板会与图谱/详情页漂移 */}
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[0.7857rem] font-medium"
            style={{ color: healthLevel.color, background: `${healthLevel.color}1f` }}
          >
            {healthLevel.label}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[0.8571rem] text-on-surface-variant">
          {c.company || '—'}
          {c.title ? ` · ${c.title}` : ''}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[0.7857rem] text-on-surface-variant">最近联系</div>
        <div className="text-[0.8571rem] font-medium">{fmtRelative(c.lastContactAt)}</div>
      </div>
    </button>
  )
}

/**
 * 客户分组菜单（桌面左栏 Card 与窄屏折叠入口共用一份）。
 *
 * 为什么要抽出来：窄屏没有固定左栏的位置，但分组是用户自己维护的筛选维度、不能跟着一起砍。
 * 两处各写一遍的话，「桌面能改名、手机改不了」是迟早的事。
 *
 * 拖拽排序的 dragGroupId 收在组件内部：它是纯瞬态交互态、页面其它地方不消费，
 * 两个实例各持一份即可（桌面拖拽不受移动端影响）。
 */
function CustomerGroupNav({
  groups,
  counts,
  totalCount,
  selectedGroupId,
  onSelectGroup,
  onEditGroup,
  onCreateGroup,
  onDropCustomer,
  onDropCustomerToAll,
  touch = false,
}: {
  groups: CustomerGroup[]
  /** 各分组命中人数（由页面按可见集算出） */
  counts: Record<string, number>
  /** 「全部客户」人数（= 可见集大小） */
  totalCount: number
  selectedGroupId: string | null
  /** null = 切回「全部客户」 */
  onSelectGroup: (id: string | null) => void
  onEditGroup: (group: CustomerGroup) => void
  onCreateGroup: () => void
  /** 客户拖入分组（2026-10-16）：按分组规则补齐客户标签；缺省 = 不接收拖入 */
  onDropCustomer?: (customerId: string, groupId: string) => void
  /** 客户拖到「全部客户」= 清空手动分组归属（2026-10-17）；缺省 = 不接收 */
  onDropCustomerToAll?: (customerId: string) => void
  /**
   * 触摸端实例（窄屏折叠入口）。这里刻意用 prop 而不是 `md:` 类：
   * 本组件的桌面实例必须逐像素不变，而「常态 `hidden`、hover 才 `flex`」这套写法
   * 一旦两侧都挂上前缀，谁盖谁就要看 Tailwind 的生成顺序了 —— 拿不准就别赌。
   * 触摸端没有 hover，编辑/删除会永远点不到，故常显；拖拽手柄则整根藏掉。
   */
  touch?: boolean
}) {
  // 分组的拖拽排序（用例 #34）：记录被拖起的 id，落点由目标项决定
  const [dragGroupId, setDragGroupId] = useState<string | null>(null)
  /** 手柄常态不可见（避免与编辑/删除抢注意力），hover 或正在拖时才现形 */
  const handleCls = dragGroupId ? 'opacity-100' : 'opacity-0 group-hover/g:opacity-100'
  // 双模式分段渲染（2026-10-17）：手动组与规则组用小节标题分隔；段内保持既有排序相对顺序，
  // 拖拽排序仍作用于全局 ids 数组（reorderCustomerGroups 不分段）。
  const manualGroups = groups.filter((g) => (g.kind ?? 'rule') === 'manual')
  const ruleGroups = groups.filter((g) => (g.kind ?? 'rule') !== 'manual')

  return (
    <>
      <div className="mb-3 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
        客户分组
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const droppedCustomer = e.dataTransfer.getData('application/x-nexus-customer')
            if (droppedCustomer) onDropCustomerToAll?.(droppedCustomer)
          }}
          title="点击查看全部客户；也可把客户拖到这里移出手动分组"
          onClick={() => onSelectGroup(null)}
          className={`app-nav-link flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.9286rem] transition-colors ${
            selectedGroupId === null
              ? 'bg-primary-fixed font-semibold text-primary'
              : 'text-on-surface-variant hover:bg-surface-hover-low hover:text-on-surface'
          }`}
        >
          <Icon
            name="group"
            size={16}
            className={selectedGroupId === null ? 'text-primary' : 'text-outline'}
          />
          <span className="min-w-0 flex-1 truncate">全部客户</span>
          <span
            className={`shrink-0 text-[0.7857rem] ${selectedGroupId === null ? 'text-primary/70' : 'text-outline'}`}
          >
            {totalCount}
          </span>
        </button>
      </div>

      {/* 我的分组：双模式（2026-10-17）—— 手动分组（详情页单选归属）与标签规则分组（自动圈人） */}
      <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 px-1 pt-2 pb-1">
        <span className="text-[0.7857rem] font-semibold uppercase tracking-wider text-outline">
          我的分组
        </span>
      </div>
      {manualGroups.length > 0 && (
        <>
          <div className="px-1 pt-1.5 pb-0.5 text-[0.7857rem] text-outline">
            手动分组
          </div>
          <div className="flex flex-col gap-0.5">
        {manualGroups.map((g) => (
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
              // 先判客户拖入（与排序拖拽共用落点）：带 customer 拖拽类型 → 加入分组
              const droppedCustomer = e.dataTransfer.getData('application/x-nexus-customer')
              if (droppedCustomer) {
                onDropCustomer?.(droppedCustomer, g.id)
                return
              }
              if (!dragGroupId || dragGroupId === g.id) return
              const ids = groups.map((x) => x.id)
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
                : 'text-on-surface-variant hover:bg-surface-hover-low hover:text-on-surface'
            }`}
          >
            {/* 拖拽手柄：仅作视觉提示（整行都可拖，与 /todo 清单、/finance 账本同款写法
                与同一个 ⠿ 字符），hover 或正在拖时可见，避免常态下与「编辑/删除」抢注意力。
                触摸端（<768px）整根藏掉：HTML5 拖拽在触屏上不生效，留着只会让人白试。 */}
            <span
              title="拖动调整分组顺序"
              className={`-ml-1 shrink-0 cursor-grab text-[1rem] leading-none text-outline/60 transition-opacity group-hover/g:text-outline ${
                touch ? 'hidden' : handleCls
              }`}
            >
              ⠿
            </span>
            <button
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="点击筛选该分组；也可把右侧客户拖到这里加入分组"
              onClick={() => onSelectGroup(selectedGroupId === g.id ? null : g.id)}
            >
              <Icon
                name="flag"
                size={16}
                className={selectedGroupId === g.id ? 'text-primary' : 'text-outline'}
              />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {(g.kind ?? 'rule') === 'manual' && (
                <span className="shrink-0 rounded bg-surface-container px-1 text-[0.7143rem] text-outline">
                  手动
                </span>
              )}
            </button>
            <span
              className={`shrink-0 text-[0.7857rem] ${selectedGroupId === g.id ? 'text-primary/70' : 'text-outline'}`}
            >
              {counts[g.id] ?? 0}
            </span>
            {/* 桌面常态藏、hover 显；触摸端没有 hover 可用，编辑/删除会永远点不到，故常显 */}
            <span
              className={`shrink-0 items-center gap-1 ${touch ? 'flex' : 'hidden group-hover/g:flex'}`}
            >
              <button
                title="编辑分组"
                className="text-outline hover:text-primary"
                onClick={() => onEditGroup(g)}
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
          </div>        ))}
          </div>
        </>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 px-1 pt-2 pb-0.5">
        <span className="text-[0.7857rem] text-outline">
          标签分组
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {ruleGroups.map((g) => (
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
              // 先判客户拖入（与排序拖拽共用落点）：带 customer 拖拽类型 → 加入分组
              const droppedCustomer = e.dataTransfer.getData('application/x-nexus-customer')
              if (droppedCustomer) {
                onDropCustomer?.(droppedCustomer, g.id)
                return
              }
              if (!dragGroupId || dragGroupId === g.id) return
              const ids = groups.map((x) => x.id)
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
                : 'text-on-surface-variant hover:bg-surface-hover-low hover:text-on-surface'
            }`}
          >
            {/* 拖拽手柄：仅作视觉提示（整行都可拖，与 /todo 清单、/finance 账本同款写法
                与同一个 ⠿ 字符），hover 或正在拖时可见，避免常态下与「编辑/删除」抢注意力。
                触摸端（<768px）整根藏掉：HTML5 拖拽在触屏上不生效，留着只会让人白试。 */}
            <span
              title="拖动调整分组顺序"
              className={`-ml-1 shrink-0 cursor-grab text-[1rem] leading-none text-outline/60 transition-opacity group-hover/g:text-outline ${
                touch ? 'hidden' : handleCls
              }`}
            >
              ⠿
            </span>
            <button
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="点击筛选该分组；也可把右侧客户拖到这里加入分组"
              onClick={() => onSelectGroup(selectedGroupId === g.id ? null : g.id)}
            >
              <Icon
                name="flag"
                size={16}
                className={selectedGroupId === g.id ? 'text-primary' : 'text-outline'}
              />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {(g.kind ?? 'rule') === 'manual' && (
                <span className="shrink-0 rounded bg-surface-container px-1 text-[0.7143rem] text-outline">
                  手动
                </span>
              )}
            </button>
            <span
              className={`shrink-0 text-[0.7857rem] ${selectedGroupId === g.id ? 'text-primary/70' : 'text-outline'}`}
            >
              {counts[g.id] ?? 0}
            </span>
            {/* 桌面常态藏、hover 显；触摸端没有 hover 可用，编辑/删除会永远点不到，故常显 */}
            <span
              className={`shrink-0 items-center gap-1 ${touch ? 'flex' : 'hidden group-hover/g:flex'}`}
            >
              <button
                title="编辑分组"
                className="text-outline hover:text-primary"
                onClick={() => onEditGroup(g)}
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
          </div>        ))}
      </div>
      <button
        onClick={onCreateGroup}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-outline-variant px-2.5 py-2 text-[0.8929rem] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
      >
        <Icon name="add" size={15} />
        新建分组
      </button>
    </>
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
  /**
   * 分组模式（2026-10-17 双模式）：**创建时选定、编辑时不可改**——改模式意味着
   * 「成员来源」整个换掉（手动名单 ↔ 标签规则），静默换会让既有成员凭空消失。
   * 编辑存量分组时回显其 kind（缺省 rule = 存量兼容）。
   */
  const [mode, setMode] = useState<'manual' | 'rule'>('rule')
  const nameRef = useAutoFocus<HTMLInputElement>(open)

  const openKey = `${open}-${group?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    if (open) {
      setName(group?.name ?? '')
      setMode(group?.kind ?? 'rule')
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
    // 错误处理（审计 P1 同类项）：此前无 try/catch，落库失败的 Promise 无人处理 → 静默失败零提示。
    try {
      if (mode === 'manual') {
        // 手动分组：只存名字与模式，成员由客户详情单选归属（无标签规则）
        if (group) {
          await updateCustomerGroup(group.id, { name: name.trim(), kind: 'manual' })
        } else {
          await createCustomerGroup({ name, includeTags: [], excludeTags: [], kind: 'manual' })
        }
        onClose()
        return
      }
      if (includeTags.length === 0) {
        setError('至少选择一个须包含的标签')
        return
      }
      if (group) {
        await updateCustomerGroup(group.id, { name: name.trim(), includeTags, excludeTags })
      } else {
        await createCustomerGroup({ name, includeTags, excludeTags, kind: 'rule' })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `保存失败：${e.message}` : '保存失败，请重试')
    }
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
      {/* 模式选择（2026-10-17 双模式）：创建时选定、编辑时只读展示（改模式=成员来源整个换掉） */}
      <Field label="分组模式">
        <div className="flex gap-2">
          {(
            [
              ['manual', '手动分组', '在客户详情里手动选择归属，一个客户只属一个手动分组'],
              ['rule', '标签分组', '按标签规则自动圈人，客户可同时命中多个'],
            ] as const
          ).map(([id, label, tip]) => {
            const disabled = Boolean(group) && mode !== id
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                title={group ? '编辑时不可更改分组模式' : tip}
                onClick={() => setMode(id)}
                className={`flex-1 rounded-lg border px-3 py-2 text-left text-[0.9286rem] transition-colors ${
                  mode === id
                    ? 'border-primary bg-primary-fixed/10 font-semibold text-primary'
                    : disabled
                      ? 'border-outline-variant/30 text-outline/60'
                      : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-hover'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </Field>
      {mode === 'manual' && (
        <div className="mb-4 rounded-lg bg-surface-container-low px-3 py-2.5 text-[0.9286rem] text-on-surface-variant">
          手动分组的成员在**客户详情页**手动选择归属（单选）；创建后到客户详情里把客户加入本组。
        </div>
      )}
      {mode === 'rule' && (
        <>
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
        </>
      )}
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

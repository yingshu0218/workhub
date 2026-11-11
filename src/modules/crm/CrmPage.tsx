import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import { customerRepo } from '@/repositories'
import { useIsMobile } from '@/shared/useIsMobile'
import type { Customer, CustomerGroup, IntimacyLevel } from '@/db/types'
import { INTIMACY_VISUAL, customerInGroup } from '@/db/types'
import { setCustomerGroup } from '@/repositories'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  inputCls,
} from '@/design-system/ui'
import { FilterChip } from '@/design-system/FilterChip'
import CustomerFormDrawer from './CustomerFormDrawer'
import { CustomerGroupNav } from './CustomerGroupNav'
import { GroupEditorDrawer } from './GroupEditorDrawer'
import { CustomerRow, CustomerCard, IntimacyFilterMenu } from './CrmListParts'
import { tagsForGroupJoin } from './shared'
import { filterBlacklisted, useIntimacyConfig, resolveIntimacyLevel } from './intimacy'
import {
  useCustomerGroups,
  useCustomerGroupCounts,
  useCustomerGroupIdOf,
  useCustomerListStats,
  STALE_FOLLOW_UP_DAYS,
  useCustomerScoreRows,
} from './hooks'

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
  // 手动分组归属已迁 links（v16 member）：Map<customerId, groupId> 索引代替行字段
  const groupIdOf = useCustomerGroupIdOf()
  const intimacyCfg = useIntimacyConfig()
  /**
   * 客户拖入分组（2026-10-16，2026-10-17 起分模式）：
   * - 手动组：**groupId 单选覆盖**——拖入即加入（自动离开原手动组），一个客户至多属一个手动组
   * - 规则组：补齐该组缺失的 includeTags（tagsForGroupJoin；刻意不做拖出，多组共享标签会误伤）
   * 两种都走 customerRepo.update（盖章 + 入队同步）。
   */
  /** 拖到「全部客户」= 清空手动分组归属（只对手动组成员有意义；规则组是标签判定无从「拖出」） */
  async function handleDropCustomerToAll(customerId: string) {
    if (!groupIdOf.get(customerId)) return
    try {
      // 归属已迁 links（v16 member）：只动 member link，不动客户行
      await setCustomerGroup(customerId, undefined)
    } catch (err) {
      console.error('[crm] 移出分组失败', err)
    }
  }

  async function handleDropCustomer(customerId: string, groupId: string) {
    const group = customGroups.find((g) => g.id === groupId)
    const customer = customers.find((c) => c.id === customerId)
    if (!group || !customer) return
    try {
      if (customerInGroup(customer, group, groupIdOf.get(customerId))) return // 已在该组：拖入无操作
      if ((group.kind ?? 'rule') === 'manual') {
        await setCustomerGroup(customerId, group.id)
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
  const groupCounts = useCustomerGroupCounts(visibleCustomers, customGroups, groupIdOf)
  const selectedGroup = customGroups.find((g) => g.id === selectedGroupId) ?? null
  // 顶部统计（改版）：口径全部与分层无关 —— 总数 / 本月新增 / 待跟进 / 待核对收入
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
      if (selectedGroup && !customerInGroup(c, selectedGroup, groupIdOf.get(c.id))) return false
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
            />
            <StatCard
              label="本月新增"
              icon="trending_up"
              iconCls="bg-success-container/60 text-success"
              value={stats.newThisMonth}
            />
            <StatCard
              label="待跟进"
              icon="schedule"
              iconCls="bg-warning-container text-warning"
              value={stats.staleFollowUp}
              sub={`超 ${STALE_FOLLOW_UP_DAYS} 天未联系`}
            />
            <StatCard
              label="待核对收入"
              icon="account_balance_wallet"
              iconCls="bg-success-container/60 text-success"
              value={stats.pendingReceivable}
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
                <FilterChip active={levelFilter === 'all'} onClick={() => setLevelFilter('all')}>
                  全部 · {visibleCustomers.length}
                </FilterChip>
                {intimacyCfg.levels.map((lv) => {
                  const on = levelFilter === lv.key
                  return (
                    <FilterChip
                      key={lv.key}
                      active={on}
                      onClick={() => setLevelFilter(lv.key)}
                      /* 选中态沿用图谱圈层色（INTIMACY_VISUAL）：档位→颜色是同一个语义，
                         在此另写一套色板必然与图谱漂移。内联样式优先级高于选中态的三个 color 类 */
                      style={
                        on
                          ? {
                              borderColor: INTIMACY_VISUAL[lv.key].color,
                              color: INTIMACY_VISUAL[lv.key].color,
                              background: `${INTIMACY_VISUAL[lv.key].color}1f`,
                            }
                          : undefined
                      }
                    >
                      {lv.name} · {counts[lv.key] ?? 0}
                    </FilterChip>
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

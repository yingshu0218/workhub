import type { Activity, Customer, Todo, Transaction, Note, Habit, Project } from '@/db/types'
import { financeFocusPath } from '@/modules/finance/links'
import { todoFocusPath } from '@/modules/todo/domain'

/**
 * ⌘K 全局搜索检索层（Phase 6 · 戒点②：选择性投影，不拉整字段）
 * 每个实体只投影 { id, title, subtitle, path } 参与匹配与跳转，
 * 组件层零数据面扩张；将来换存储只改本文件的取数来源。
 * 投影下沉（审计 P2-6）：笔记实体仅投影 { id, title, tags }，
 * 整篇 markdown 不再进入搜索内存；摘要改用标签行。
 */

export type SearchEntityType = 'activity' | 'customer' | 'todo' | 'transaction' | 'note' | 'habit' | 'project'
export type ActivitySearchProjection = Pick<Activity, 'id' | 'title' | 'summary' | 'tags'>

/** 搜索用笔记投影（不含 markdown 大字段，与 useCollection pick 对齐） */
export type NoteSearchProjection = Pick<Note, 'id' | 'title' | 'tags'>

export interface SearchItem {
  id: string
  type: SearchEntityType
  title: string
  subtitle: string
  path: string
}

export const SEARCH_TYPE_META: Record<SearchEntityType, { label: string; icon: string }> = {
  activity: { label: '经历与事件', icon: 'timeline' },
  customer: { label: 'CRM 客户', icon: 'group' },
  todo: { label: '待办事项', icon: 'check_circle' },
  transaction: { label: '财务流水', icon: 'account_balance_wallet' },
  note: { label: '笔记', icon: 'description' },
  habit: { label: '打卡习惯', icon: 'local_fire_department' },
  project: { label: '项目', icon: 'hub' },
}

/** 投影顺序即结果组序 */
const TYPE_ORDER: SearchEntityType[] = [
  'activity',
  'customer',
  'project',
  'todo',
  'transaction',
  'note',
  'habit',
]

function fmtAmount(amount: number): string {
  return `¥${amount.toLocaleString('zh-CN')}`
}

/** 选择性投影：五实体 → 精简检索条目（notes 为投影类型，不携带 markdown） */
export function buildSearchIndex(inputs: {
  activities?: ActivitySearchProjection[]
  customers: Customer[]
  projects: Project[]
  todos: Todo[]
  transactions: Transaction[]
  notes: NoteSearchProjection[]
  habits: Habit[]
}): SearchItem[] {
  const items: SearchItem[] = []
  for (const a of inputs.activities || []) items.push({id:a.id,type:'activity',title:a.title || '',subtitle:[(a.summary || '').slice(0,500),...(a.tags || []).slice(0,50)].join(' · '),path:'/activities/'+encodeURIComponent(a.id)})
  for (const c of inputs.customers) {
    items.push({
      id: c.id,
      type: 'customer',
      title: c.name,
      subtitle: [c.preferredName, ...(c.aliases || []), c.company, c.title].filter(Boolean).join(' · '),
      path: `/crm/${c.id}`,
    })
  }
  for (const p of inputs.projects) {
    const meta = { active: '进行中', paused: '已搁置', archived: '已归档' }[p.status]
    items.push({
      id: p.id,
      type: 'project',
      title: p.name,
      subtitle: meta,
      path: `/projects/${p.id}`,
    })
  }
  for (const t of inputs.todos) {
    // 状态前缀（Issue #128）：⌘K 结果里一眼区分「已完成 / 已作废 / 未完成」，
    // 终态条目仍在索引内（可搜到、可跳转回溯），只是标注清楚
    const statusTag = t.status === 'done' ? '已完成' : t.status === 'voided' ? '已作废' : ''
    // ⚠️ desc 必须兜底：`Todo.desc` 类型上标为必填，但存量 / 同步 / 手写库的记录可能没有该字段。
    // 直接把它当作 subtitle 会让下面 filter 里的 `item.subtitle.toLowerCase()` 抛
    // "Cannot read properties of undefined" —— 一条脏数据即可让**整个 ⌘K 搜索崩溃**（整页错误页）。
    // 与 modules/todo/title.ts、TodoPage 详情抽屉同口径（缺陷 D11 的姊妹处，D13）。
    const desc = t.desc ?? ''
    items.push({
      id: t.id,
      type: 'todo',
      title: t.title ?? '',
      subtitle: statusTag ? `${statusTag} · ${desc}` : desc,
      // 深链定位（与时间线骨刺穿透同款口径）：/todo?focus=<id>，避免「点了结果只落到列表、
      // 目标条目在默认视图外 → 观感等同没反应」。TodoPage 消费 focus 后切视图 + 打开详情抽屉。
      path: todoFocusPath(t.id),
    })
  }
  for (const t of inputs.transactions) {
    items.push({
      id: t.id,
      type: 'transaction',
      title: t.summary,
      subtitle: `${t.type === 'income' ? '收入' : '支出'} ${fmtAmount(t.amount)} · ${t.status}`,
      // 深链定位（与时间线骨刺穿透同款口径）：/finance?focus=<id>，FinancePage 消费后直接
      // 打开该笔凭证详情抽屉。不带 focus 只会落到财务中心列表，观感上「点详情没反应」。
      path: financeFocusPath(t.id),
    })
  }
  for (const n of inputs.notes) {
    // 摘要：标签行（投影下沉后 markdown 不在内存，不再从正文截取）
    items.push({
      id: n.id,
      type: 'note',
      title: n.title,
      subtitle: n.tags.join(' · '),
      path: `/notes/${n.id}`,
    })
  }
  for (const h of inputs.habits) {
    items.push({
      id: h.id,
      type: 'habit',
      title: h.name,
      subtitle: [h.category, h.schedule].filter(Boolean).join(' · '),
      path: '/habits',
    })
  }
  return items
}

/** 模糊匹配：lowercase includes，命中标题权重高于副标题 */
export function searchAll(
  index: SearchItem[],
  query: string,
): { type: SearchEntityType; label: string; icon: string; items: SearchItem[] }[] {
  const q = query.trim().toLowerCase()
  // 消费侧同样兜底（与索引侧双保险）：搜索索引来自多类实体投影（客户/项目/待办/流水/笔记/习惯），
  // 任一类出现字段缺失都不该让整个搜索崩掉 —— 缺字段的项退化为「匹配不到」而非抛错。
  const matched = q
    ? index.filter(
        (item) =>
          (item.title ?? '').toLowerCase().includes(q) ||
          (item.subtitle ?? '').toLowerCase().includes(q),
      )
    : index
  return TYPE_ORDER.map((type) => ({
    type,
    label: SEARCH_TYPE_META[type].label,
    icon: SEARCH_TYPE_META[type].icon,
    items: matched.filter((it) => it.type === type),
  })).filter((g) => g.items.length > 0)
}

/* ------------------------------------------------------------------------- *
 * 模糊匹配基建（Issue #33 agentOps P1 第 1 步：从 design-system/MatchCombobox 提升）
 *
 * 提升理由：agentOps 消解器（shared 层）需与 UI 候选链路共用同一套匹配/排序/沉底语义，
 * 而 design-system 不能作为 shared 的依赖源（会形成 shared ↔ design-system 反向依赖）。
 * MatchCombobox 保留 re-export，5 个内部使用方零改动。
 * ------------------------------------------------------------------------- */

/** 模糊匹配：全部子序列命中即算匹配（如「深科」命中「深蓝科技」），优先级：前缀 > 子串 > 子序列 */
export function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return true
  const idx = t.indexOf(q)
  if (idx >= 0) return true
  // 子序列回退
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i >= q.length) return true
  }
  return false
}

/** 按匹配质量排序：子串命中在前，同质量按原顺序（**不做去重**——唯一性判定由调用方按 id 判，见 §9.7 第 3 步） */
export function fuzzySort<T>(items: T[], labelOf: (item: T) => string, query: string): T[] {
  const q = query.toLowerCase().trim()
  if (!q) return items
  return [...items]
    .map((item, i) => ({ item, i, score: labelOf(item).toLowerCase().indexOf(q) }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        if (a.score < 0) return 1
        if (b.score < 0) return -1
        return a.score - b.score
      }
      return a.i - b.i
    })
    .map((x) => x.item)
}

/** 候选项按归档状态沉底（归档项排最后，同状态保持原顺序），供「已归档」类候选统一使用 */
export function archivedLast<T extends { archived?: boolean }>(items: T[]): T[] {
  return [...items.filter((i) => !i.archived), ...items.filter((i) => i.archived)]
}

/**
 * 归档态映射收口（§9.7 第 1 步注 / 第 3 步 archived 映射注）。
 *
 * `archivedLast` 只认 `archived?: boolean`，而 `Project` 用业务字段 `status:'archived'` 表达归档。
 * 此前全仓 4 处调用方各自内联 `archived: p.status === 'archived'`，属重复约定。
 * 收口到本函数后，UI 候选链路与 agentOps 消解器共用同一判据，杜绝两侧漂移。
 *
 * 断言范围（§9.7 第 1 步注）：与 UI 4 处手工映射结果一致——
 * `NoteEditorPage.tsx` ×2、`TransactionFormDrawer.tsx`、`TodoPage.tsx`。
 * `ProjectsPage.tsx` 用 `select` 展示归档项目（同判据但不在候选链路上），不参与对照断言。
 */
export function isProjectArchived(project: Pick<Project, 'status'>): boolean {
  return project.status === 'archived'
}

/** 归档态映射（对象形态，便于直接展开进候选项）：`{ archived: boolean }` */
export function toArchivedFlag(project: Pick<Project, 'status'>): { archived: boolean } {
  return { archived: isProjectArchived(project) }
}

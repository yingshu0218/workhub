import type { Customer, Todo, Transaction, Note, Habit, Project } from '@/db/types'

/**
 * ⌘K 全局搜索检索层（Phase 6 · 戒点②：选择性投影，不拉整字段）
 * 每个实体只投影 { id, title, subtitle, path } 参与匹配与跳转，
 * 组件层零数据面扩张；将来换存储只改本文件的取数来源。
 * 投影下沉（审计 P2-6）：笔记实体仅投影 { id, title, tags }，
 * 整篇 markdown 不再进入搜索内存；摘要改用标签行。
 */

export type SearchEntityType = 'customer' | 'todo' | 'transaction' | 'note' | 'habit' | 'project'

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
  customer: { label: 'CRM 客户', icon: 'group' },
  todo: { label: '待办事项', icon: 'check_circle' },
  transaction: { label: '财务流水', icon: 'account_balance_wallet' },
  note: { label: '团队笔记', icon: 'description' },
  habit: { label: '打卡习惯', icon: 'local_fire_department' },
  project: { label: '项目', icon: 'hub' },
}

/** 投影顺序即结果组序 */
const TYPE_ORDER: SearchEntityType[] = ['customer', 'project', 'todo', 'transaction', 'note', 'habit']

function fmtAmount(amount: number): string {
  return `¥${amount.toLocaleString('zh-CN')}`
}

/** 选择性投影：五实体 → 精简检索条目（notes 为投影类型，不携带 markdown） */
export function buildSearchIndex(inputs: {
  customers: Customer[]
  projects: Project[]
  todos: Todo[]
  transactions: Transaction[]
  notes: NoteSearchProjection[]
  habits: Habit[]
}): SearchItem[] {
  const items: SearchItem[] = []
  for (const c of inputs.customers) {
    items.push({
      id: c.id,
      type: 'customer',
      title: c.name,
      subtitle: [c.company, c.title].filter(Boolean).join(' · '),
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
    items.push({
      id: t.id,
      type: 'todo',
      title: t.title,
      subtitle: t.desc,
      path: '/todo',
    })
  }
  for (const t of inputs.transactions) {
    items.push({
      id: t.id,
      type: 'transaction',
      title: t.summary,
      subtitle: `${t.type === 'income' ? '收入' : '支出'} ${fmtAmount(t.amount)} · ${t.status}`,
      path: '/finance',
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
  const matched = q
    ? index.filter((item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q))
    : index
  return TYPE_ORDER.map((type) => ({
    type,
    label: SEARCH_TYPE_META[type].label,
    icon: SEARCH_TYPE_META[type].icon,
    items: matched.filter((it) => it.type === type),
  })).filter((g) => g.items.length > 0)
}

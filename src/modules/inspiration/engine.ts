import dayjs from 'dayjs'
import type { Customer, Todo, Transaction, Note } from '@/db/types'

/**
 * 灵感闪现规则引擎（Phase 6 · 戒点①：权重一律从源记录推导，不存快照）
 * 候选源：逾期待办（P1 权重最高）/ 到期日程 / 待对账交易 / 久未跟进客户（距今天数 × 分层权重 S>A>B）/ 沉睡笔记（30 天未更新）
 * 每类候选输出 理由文案 + 关联实体上下文 + 匹配合度%（原始分对最高分归一化）
 */

export type CandidateKind =
  'overdue-todo' | 'due-todo' | 'reconciliation' | 'stale-customer' | 'stale-note'

export interface CandidateContext {
  icon: string
  label: string
  value: string
}

export interface InspirationCandidate {
  id: string
  kind: CandidateKind
  title: string
  reason: string
  /** 原始权重分 */
  score: number
  /** 匹配合度 0-100（score / 最高分 归一化） */
  match: number
  /** 可执行动作挂点 */
  todoId?: string
  customerId?: string
  /** 沉睡笔记候选：跳转 /notes/:id */
  noteId?: string
  /** 关联实体上下文（客户 · 款项 · 笔记） */
  context: CandidateContext[]
}

const PRIORITY_BASE: Record<Todo['priority'], number> = { P1: 100, P2: 75, P3: 55 }
/** 客户分层权重：S > A > B（潜在不计入） */
const TIER_WEIGHT: Record<string, number> = { S: 6, A: 4, B: 2.5 }

export interface EngineInput {
  todos: Todo[]
  transactions: Transaction[]
  customers: Customer[]
  notes: Note[]
}

function buildCandidates(input: EngineInput): InspirationCandidate[] {
  const now = Date.now()
  const customersById = new Map(input.customers.map((c) => [c.id, c]))
  const candidates: InspirationCandidate[] = []

  // ── 待办类：逾期（权重最高）与今日到期 ──
  for (const t of input.todos) {
    if (t.status === 'done') continue
    if (!t.dueAt) continue
    const overdueMs = now - t.dueAt
    const customer = t.customerId ? customersById.get(t.customerId) : undefined

    const context: CandidateContext[] = []
    if (customer)
      context.push({
        icon: 'group',
        label: '关联客户',
        value: `${customer.name} · ${customer.company}`,
      })
    const relatedNote = customer
      ? input.notes.find((n) =>
          n.mentions.some((m) => m.type === 'customer' && m.id === customer.id),
        )
      : undefined
    if (relatedNote)
      context.push({ icon: 'description', label: '前置笔记', value: relatedNote.title })
    if (t.ledgerId)
      context.push({ icon: 'account_balance_wallet', label: '关联账本', value: t.ledgerId })

    if (overdueMs > 0) {
      const overdueDays = Math.floor(overdueMs / 86400_000)
      const score = PRIORITY_BASE[t.priority] + Math.min(40, overdueDays * 8)
      candidates.push({
        id: `cand-todo-${t.id}`,
        kind: 'overdue-todo',
        title: t.title,
        reason:
          overdueDays >= 1
            ? `已逾期 ${overdueDays} 天 · ${t.priority} 紧急事项，商业影响最高`
            : `今天 ${dayjs(t.dueAt).format('HH:mm')} 截止已过 · ${t.priority} 优先级`,
        score,
        match: 0,
        todoId: t.id,
        customerId: t.customerId,
        context,
      })
    } else {
      const dueToday = dayjs(t.dueAt).isSame(dayjs(), 'day')
      if (!dueToday) continue
      const hoursLeft = Math.max(0, Math.floor(overdueMs / -3600_000))
      const score = PRIORITY_BASE[t.priority] * 0.8 + Math.max(0, 20 - hoursLeft)
      candidates.push({
        id: `cand-todo-${t.id}`,
        kind: 'due-todo',
        title: t.title,
        reason: `今天 ${dayjs(t.dueAt).format('HH:mm')} 截止 · 剩余 ${hoursLeft} 小时 · ${t.priority}`,
        score,
        match: 0,
        todoId: t.id,
        customerId: t.customerId,
        context,
      })
    }
  }

  // ── 待对账交易 ──
  for (const txn of input.transactions) {
    if (txn.status !== '待对账') continue
    const hangDays = Math.floor((now - txn.occurredAt) / 86400_000)
    const score = 60 + Math.min(35, txn.amount / 6000) + Math.min(15, Math.max(0, hangDays) * 2)
    const context: CandidateContext[] = [
      {
        icon: 'payments',
        label: '金额',
        value: `¥${txn.amount.toLocaleString('zh-CN')} · ${txn.channel}`,
      },
    ]
    const customer = txn.customerId ? customersById.get(txn.customerId) : undefined
    if (customer)
      context.push({
        icon: 'group',
        label: '往来客户',
        value: `${customer.name} · ${customer.company}`,
      })
    candidates.push({
      id: `cand-txn-${txn.id}`,
      kind: 'reconciliation',
      title: txn.summary,
      reason: `待对账 ¥${txn.amount.toLocaleString('zh-CN')} · 挂账 ${Math.max(0, hangDays)} 天，账实待核对`,
      score,
      match: 0,
      customerId: txn.customerId,
      context,
    })
  }

  // ── 久未跟进客户：距今天数 × 分层权重（≥7 天才进入候选） ──
  for (const c of input.customers) {
    if (c.tier === '潜在') continue
    const days = Math.floor((now - c.lastContactAt) / 86400_000)
    if (days < 7) continue
    const score = Math.min(90, days * (TIER_WEIGHT[c.tier] ?? 2))
    const context: CandidateContext[] = [
      {
        icon: 'badge',
        label: '客户分层',
        value: `${c.tier} 层 · ${c.stage} · 健康指数 ${c.healthScore}`,
      },
    ]
    const note = input.notes.find((n) =>
      n.mentions.some((m) => m.type === 'customer' && m.id === c.id),
    )
    if (note) context.push({ icon: 'description', label: '相关笔记', value: note.title })
    candidates.push({
      id: `cand-customer-${c.id}`,
      kind: 'stale-customer',
      title: `跟进 ${c.name}（${c.company}）`,
      reason: `${c.tier} 层客户已 ${days} 天未跟进 · 距上次沟通联系窗口拉大`,
      score,
      match: 0,
      customerId: c.id,
      context,
    })
  }

  // ── 沉睡笔记：updatedAt 距今 > 30 天的笔记作为候选类型补充 ──
  for (const n of input.notes) {
    if (!n.updatedAt) continue
    const days = Math.floor((now - n.updatedAt) / 86400_000)
    if (days <= 30) continue
    const score = Math.min(55, days * 1.5)
    const context: CandidateContext[] = []
    if (n.tags.length > 0)
      context.push({ icon: 'sell', label: '笔记标签', value: n.tags.map((t) => `#${t}`).join(' ') })
    candidates.push({
      id: `cand-note-${n.id}`,
      kind: 'stale-note',
      title: n.title || '未命名笔记',
      reason: `笔记已沉睡 ${days} 天 · 回顾沉淀或归档，保持文库活性`,
      score,
      match: 0,
      noteId: n.id,
      context,
    })
  }

  // 归一化：match = score / 最高分 → 百分比（封顶 98）
  const top = candidates.reduce((m, c) => Math.max(m, c.score), 0)
  for (const c of candidates) {
    c.match = top > 0 ? Math.max(40, Math.min(98, Math.round((98 * c.score) / top))) : 60
  }
  return candidates.sort((a, b) => b.score - a.score)
}

export default buildCandidates

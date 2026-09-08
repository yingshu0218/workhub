import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'
import dayjs from 'dayjs'
import type { Interaction, Todo, Transaction } from '@/db/types'

/**
 * 客户统一时间轴投影（Issue #11 需求 1 的底座）
 *
 * 设计原则：动态投影，不复制数据。
 * interactions / transactions / todos 三表仍是唯一真源，本模块只在展示层联查合成，
 * 客户详情页与时间线视图共用同一份投影，保证两处展示永远一致。
 * 删除客户时 deleteCustomerCascade 会解绑交易/待办（customerId → undefined），
 * 投影记录自然从该客户视图消失，无需额外处理。
 */

/** 时间轴事件：手写沟通日志 / 关联交易流水 / 关联待办 三源异构记录的统一形态 */
export type TimelineEvent = { customerId?: string } & (
  | { kind: 'interaction'; id: string; at: number; type: Interaction['type']; content: string }
  | {
      kind: 'transaction'
      id: string
      at: number
      /** 源记录 id（transactions 主键），供鱼骨穿透定位流水详情 */
      recordId: string
      direction: 'income' | 'expense'
      amount: number
      summary: string
      status: Transaction['status']
    }
  | {
      kind: 'todo'
      id: string
      at: number
      /** 源记录 id（todos 主键），供鱼骨穿透定位待办（同一待办的 created/done 事件点共享） */
      recordId: string
      /** 同一待办拆成 created / done 两个事件点（Issue #11 用户已确认接受） */
      event: 'created' | 'done'
      title: string
      priority: Todo['priority']
    }
)

/** 空数组单例：liveQuery 初始 undefined 时避免每次渲染换引用 */
const EMPTY: TimelineEvent[] = []

/**
 * 某客户的统一时间轴（按时间倒序）
 * 并行索引查询三表（customerId 均建有索引），再按 at 倒序合成投影
 */
/** 三源合并纯函数：interactions/transactions/todos 原始记录 → 统一时间轴事件（含 done 拆分） */
export function mergeTimelineEvents(
  interactions: Interaction[],
  transactions: Transaction[],
  todos: Todo[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [
    ...interactions.map(
      (i): TimelineEvent => ({
        kind: 'interaction',
        id: i.id,
        at: i.at,
        type: i.type,
        content: i.content,
      }),
    ),
    ...transactions.map(
      (t): TimelineEvent => ({
        kind: 'transaction',
        id: t.id,
        at: t.occurredAt,
        recordId: t.id,
        direction: t.type,
        amount: t.amount,
        summary: t.summary,
        status: t.status,
      }),
    ),
  ]
  for (const t of todos) {
    out.push({
      kind: 'todo',
      id: `${t.id}:created`,
      at: t.createdAt,
      recordId: t.id,
      event: 'created',
      title: t.title,
      priority: t.priority,
    })
    if (t.status === 'done' && t.completedAt) {
      out.push({
        kind: 'todo',
        id: `${t.id}:done`,
        at: t.completedAt,
        recordId: t.id,
        event: 'done',
        title: t.title,
        priority: t.priority,
      })
    }
  }
  return out
}

/**
 * 某客户的统一时间轴（按时间倒序）
 * 并行索引查询三表（customerId 均建有索引），再按 at 倒序合成投影
 * 三源合并逻辑在 mergeTimelineEvents 纯函数，与 useAllTimelines 共用同一份（口径不漂移）
 */
export function useCustomerTimeline(customerId: string | undefined): TimelineEvent[] {
  const events = useQuery<TimelineEvent[]>(async () => {
    if (!customerId) return EMPTY
    const [interactions, transactions, todos] = await Promise.all([
      db.interactions
        .where('customerId')
        .equals(customerId)
        .filter((i) => !i.deleted)
        .toArray(),
      db.transactions
        .where('customerId')
        .equals(customerId)
        .filter((t) => !t.deleted)
        .toArray(),
      db.todos.where('customerId').equals(customerId).filter((t) => !t.deleted).toArray(),
    ])
    const merged = mergeTimelineEvents(interactions, transactions, todos)
    // 单客户视图：回填 customerId 便于类型统一（查询本身已按 customerId 索引）
    for (const e of merged) e.customerId = customerId
    return merged.sort((a, b) => b.at - a.at)
  }, [customerId])
  return events ?? EMPTY
}

/**
 * 全部客户的统一时间轴（/crm/timeline-all 全局鱼骨数据源，Issue #22 需求 ④）
 * 复用同一套三源合并代码（mergeTimelineEvents），事件带 customerId，
 * 消费端用 useCollection<Customer> 打上客户名/色。删除级联解绑后事件自然消失，无需额外处理。
 */
export function useAllTimelines(): TimelineEvent[] {
  const events = useQuery<TimelineEvent[]>(async () => {
    const [interactions, transactions, todos] = await Promise.all([
      db.interactions.filter((i) => !i.deleted && !!i.customerId).toArray(),
      db.transactions.filter((t) => !t.deleted && !!t.customerId).toArray(),
      db.todos.filter((t) => !t.deleted && !!t.customerId).toArray(),
    ])
    const merged = mergeTimelineEvents(interactions, transactions, todos)
    // 回填 customerId：三源记录均携带该字段，按 kind 对齐源记录即可
    const byId = new Map<string, string>()
    for (const i of interactions) byId.set(i.id, i.customerId)
    for (const t of transactions) byId.set(t.id, t.customerId!)
    for (const t of todos) byId.set(t.id, t.customerId!)
    for (const e of merged) {
      const srcId = e.kind === 'todo' ? e.recordId : e.id
      e.customerId = byId.get(srcId)
    }
    return merged.sort((a, b) => b.at - a.at)
  }, [])
  return events ?? EMPTY
}

/** 时间轴过滤维度（详情页/时间线视图共用） */
export type TimelineFilter = 'all' | 'interaction' | 'transaction' | 'todo'

export const TIMELINE_FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'interaction', label: '沟通' },
  { key: 'transaction', label: '财务' },
  { key: 'todo', label: '事件' },
]

export function filterTimeline(events: TimelineEvent[], filter: TimelineFilter): TimelineEvent[] {
  if (filter === 'all') return events
  return events.filter((e) => e.kind === filter)
}

export const fmtMoney = (n: number) => `¥${n.toLocaleString('zh-CN')}`

/** 事件点的时间格式：今天/昨天给时分，更早给日期 */
export function fmtTimelineTime(at: number): string {
  const d = dayjs(at)
  if (d.isSame(dayjs(), 'day')) return d.format('HH:mm')
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return `昨天 ${d.format('HH:mm')}`
  return d.format('YYYY-MM-DD HH:mm')
}

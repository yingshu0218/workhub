import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'
import type { Interaction, Todo, Transaction } from '@/db/types'

/**
 * CRM 模块领域查询 Hook（组件不直碰 Dexie，审计纪律 P1-5）
 * 画布/详情聚合走选择性查询：只投影渲染所需字段，不把整条记录（含潜在大字段）拉进渲染层
 */

/** 关系画布聚合数据（节点仅保留渲染所需字段） */
export interface CanvasGraph {
  customers: { id: string; name: string; company: string; tier: 'S' | 'A' | 'B' | '潜在'; healthScore: number }[]
  transactions: { id: string; customerId: string; type: 'income' | 'expense'; amount: number; summary: string }[]
  todos: { id: string; customerId: string; title: string; priority: 'P1' | 'P2' | 'P3'; status: 'todo' | 'doing' | 'done' }[]
}

const EMPTY_GRAPH: CanvasGraph = { customers: [], transactions: [], todos: [] }

export function useCanvasGraph(): CanvasGraph {
  const graph = useQuery<CanvasGraph>(async () => {
    const [customers, txns, todos] = await Promise.all([
      db.customers.filter((c) => !c.deleted).toArray(),
      // customerId 建有索引：直接走索引取关联流水，跳过无关联的记录
      db.transactions.where('customerId').notEqual('').filter((t) => !t.deleted).toArray(),
      db.todos.where('customerId').notEqual('').filter((t) => !t.deleted).toArray(),
    ])
    return {
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        tier: c.tier,
        healthScore: c.healthScore,
      })),
      transactions: txns.map((t) => ({
        id: t.id,
        customerId: t.customerId ?? '',
        type: t.type,
        amount: t.amount,
        summary: t.summary,
      })),
      todos: todos.map((t) => ({
        id: t.id,
        customerId: t.customerId ?? '',
        title: t.title,
        priority: t.priority,
        status: t.status,
      })),
    }
  }, [])
  return graph ?? EMPTY_GRAPH
}

/** 某客户的沟通日志（按时间倒序） */
export function useCustomerInteractions(customerId: string | undefined): Interaction[] {
  const list = useQuery<Interaction[]>(
    () =>
      customerId
        ? db.interactions
            .where('customerId')
            .equals(customerId)
            .filter((i) => !i.deleted)
            .reverse()
            .sortBy('at')
        : Promise.resolve([]),
    [customerId],
  )
  return list ?? []
}

/** 某客户关联的交易流水（按时间倒序） */
export function useCustomerTransactions(customerId: string | undefined): Transaction[] {
  const list = useQuery<Transaction[]>(
    () =>
      customerId
        ? db.transactions
            .where('customerId')
            .equals(customerId)
            .filter((t) => !t.deleted)
            .reverse()
            .sortBy('occurredAt')
        : Promise.resolve([]),
    [customerId],
  )
  return list ?? []
}

/** 某客户关联的待办（按截止时间升序，无截止的排最后） */
export function useCustomerTodos(customerId: string | undefined): Todo[] {
  const list = useQuery<Todo[]>(
    () =>
      customerId
        ? db.todos.where('customerId').equals(customerId).filter((t) => !t.deleted).toArray()
        : Promise.resolve([]),
    [customerId],
  )
  return (list ?? []).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
}

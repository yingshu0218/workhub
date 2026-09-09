import { useMemo } from 'react'
import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'
import { syncEngine } from '@/sync/engine'
import { newId } from '@/repositories'
import type { Customer, Interaction, RelationCategory, Todo, Transaction } from '@/db/types'

/**
 * CRM 模块领域查询 Hook（组件不直碰 Dexie，审计纪律 P1-5）
 * 画布/详情聚合走选择性查询：只投影渲染所需字段，不把整条记录（含潜在大字段）拉进渲染层
 */

/** 关系画布聚合数据（节点仅保留渲染所需字段） */
export interface CanvasGraph {
  customers: {
    id: string
    name: string
    company: string
    tier: 'S' | 'A' | 'B' | '潜在'
    healthScore: number
    /** 最近联系时间（图谱缩略卡展示用，Issue #34） */
    lastContactAt: number
    /** 客户间语义关系（全景图画客户↔客户边的数据源；投影时过滤掉指向已删除/不存在客户的悬挂引用） */
    relations: { targetId: string; label: string; category?: RelationCategory }[]
    /** 亲密度手动档投影（Issue #34：圈层布局与黑名单过滤；缺省=未设置=算法兜底） */
    intimacy?: {
      level: 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'I6' | 'I7'
      note?: string
      updatedAt: number
    }
  }[]
  projects: { id: string; name: string; customerId: string }[]
  transactions: {
    id: string
    customerId: string
    type: 'income' | 'expense'
    amount: number
    summary: string
    projectId?: string
    ledgerId?: string
  }[]
  todos: {
    id: string
    customerId: string
    title: string
    priority: 'P1' | 'P2' | 'P3'
    status: 'todo' | 'doing' | 'done'
    projectId?: string
  }[]
  /** 沟通日志投影：桥接推导需 customerId+projectId（CanvasGraph 原不含 interaction，Issue #34 补齐） */
  interactions: { id: string; customerId: string; projectId?: string; at: number }[]
  /** 项目状态投影（Issue #34 算法亲密度：active 项目双倍权重） */
  projectStatuses: Record<string, 'active' | 'paused' | 'archived'>
  notes: { id: string; customerId: string; title: string }[]
}

const EMPTY_GRAPH: CanvasGraph = {
  customers: [],
  projects: [],
  transactions: [],
  todos: [],
  interactions: [],
  notes: [],
  projectStatuses: {},
}

export function useCanvasGraph(): CanvasGraph {
  const graph = useQuery<CanvasGraph>(async () => {
    const [customers, projects, txns, todos, itxs] = await Promise.all([
      db.customers.filter((c) => !c.deleted).toArray(),
      db.projects.filter((p) => !p.deleted).toArray(),
      // customerId 建有索引：直接走索引取关联流水，跳过无关联的记录
      db.transactions
        .where('customerId')
        .notEqual('')
        .filter((t) => !t.deleted)
        .toArray(),
      db.todos
        .where('customerId')
        .notEqual('')
        .filter((t) => !t.deleted)
        .toArray(),
      // customerId 建有索引（v1 起），与 transactions 同款索引查询（Issue #34 桥接推导前置）
      db.interactions
        .where('customerId')
        .notEqual('')
        .filter((i) => !i.deleted)
        .toArray(),
    ])
    // 笔记经 mentions 反查客户：notes 表无 customerId 索引，全表过滤（笔记量级小）
    const customerIds = new Set(customers.map((c) => c.id))
    const notes = await db.notes
      .filter(
        (n) =>
          !n.deleted &&
          (n.mentions ?? []).some((m) => m.type === 'customer' && customerIds.has(m.id)),
      )
      .toArray()
    return {
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        tier: c.tier,
        healthScore: c.healthScore,
        lastContactAt: c.lastContactAt,
        // 悬挂防御：只带出指向现存客户的 relations（删除级联已解绑，这里再挡一层历史脏数据）
        relations: (c.relations ?? []).filter((r) => customerIds.has(r.targetId)),
        intimacy: c.intimacy
          ? { level: c.intimacy.level, note: c.intimacy.note, updatedAt: c.intimacy.updatedAt }
          : undefined,
      })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, customerId: p.customerId ?? '' })),
      projectStatuses: Object.fromEntries(projects.map((p) => [p.id, p.status])),
      transactions: txns.map((t) => ({
        id: t.id,
        customerId: t.customerId ?? '',
        type: t.type,
        amount: t.amount,
        summary: t.summary,
        projectId: t.projectId ?? undefined,
        ledgerId: t.ledgerId ?? undefined,
      })),
      todos: todos.map((t) => ({
        id: t.id,
        customerId: t.customerId ?? '',
        title: t.title,
        priority: t.priority,
        status: t.status,
        projectId: t.projectId ?? undefined,
      })),
      interactions: itxs.map((i) => ({
        id: i.id,
        customerId: i.customerId ?? '',
        projectId: i.projectId ?? undefined,
        at: i.at,
      })),
      notes: notes.map((n) => {
        const mention = n.mentions.find((m) => m.type === 'customer' && customerIds.has(m.id))
        return { id: n.id, customerId: mention?.id ?? '', title: n.title }
      }),
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
        ? db.todos
            .where('customerId')
            .equals(customerId)
            .filter((t) => !t.deleted)
            .toArray()
        : Promise.resolve([]),
    [customerId],
  )
  return (list ?? []).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
}

/** 新建客户的第 4 步「跨模块关联初始化」选项 */
export interface CustomerInitOptions {
  /** 创建首联待办（标题=首联跟进：{客户名}，P2，当天） */
  firstContactTodo?: boolean
  /** 创建一条 opening 沟通日志（类型=拜访） */
  openingLog?: boolean
  /** 关联已有交易：把该交易的 customerId 指向新客户 */
  linkTransactionId?: string
}

/**
 * 客户建档 + 跨模块关联初始化：单 Dexie 事务覆盖
 * customers / todos / interactions / transactions / syncQueue 五表，任一步失败整体回滚。
 * 各子项均为可选；记录统一盖章 updatedAt/rev/deleted 并入同步队列（与 repository.put 语义一致）。
 */
export async function createCustomerWithInit(
  customer: Customer,
  opts: CustomerInitOptions = {},
): Promise<void> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.customers, db.todos, db.interactions, db.transactions, db.syncQueue],
    async () => {
      const prev = await db.customers.get(customer.id)
      await db.customers.put({
        ...customer,
        updatedAt: now,
        rev: (prev?.rev ?? 0) + 1,
        deleted: 0 as const,
      } as Customer)
      await db.syncQueue.add({
        table: 'customers',
        recordId: customer.id,
        op: 'upsert',
        createdAt: now,
      })

      if (opts.firstContactTodo) {
        const endOfDay = new Date()
        endOfDay.setHours(23, 59, 59, 999)
        const todo = {
          id: newId('td'),
          title: `首联跟进：${customer.name}`,
          desc: '',
          priority: 'P2' as const,
          status: 'todo' as const,
          dueAt: endOfDay.getTime(),
          customerId: customer.id,
          createdAt: now,
        }
        await db.todos.put({ ...todo, updatedAt: now, rev: 1, deleted: 0 as const } as Todo)
        await db.syncQueue.add({
          table: 'todos',
          recordId: todo.id,
          op: 'upsert',
          createdAt: now,
        })
      }

      if (opts.openingLog) {
        const itx = {
          id: newId('itx'),
          customerId: customer.id,
          type: '拜访' as const,
          content: '客户建档 · 首次建立联系（opening）',
          at: now,
        }
        await db.interactions.put({
          ...itx,
          updatedAt: now,
          rev: 1,
          deleted: 0 as const,
        } as Interaction)
        await db.syncQueue.add({
          table: 'interactions',
          recordId: itx.id,
          op: 'upsert',
          createdAt: now,
        })
      }

      if (opts.linkTransactionId) {
        const txn = await db.transactions.get(opts.linkTransactionId)
        if (txn && !txn.deleted) {
          await db.transactions.update(txn.id, {
            customerId: customer.id,
            updatedAt: now,
            rev: txn.rev + 1,
          })
          await db.syncQueue.add({
            table: 'transactions',
            recordId: txn.id,
            op: 'upsert',
            createdAt: now,
          })
        }
      }
    },
  )
  syncEngine.requestSync()
}

// ─────────────────────────── 自定义客户分组（Issue #63 收敛稿） ───────────────────────────

import type { CustomerGroup } from '@/db/types'
import { matchGroup } from '@/db/types'

/** 订阅自定义分组（按 sortOrder 排序，过滤软删） */
export function useCustomerGroups(): CustomerGroup[] {
  const groups = useQuery<CustomerGroup[]>(async () => {
    const all = await db.customerGroups.toArray()
    return all.filter((g) => !g.deleted).sort((a, b) => a.sortOrder - b.sortOrder)
  }, [])
  return groups ?? []
}

/** 各分组实时命中人数（Dexie 全量推导，本地量级无压力；不落快照，改 tag 即进出组） */
export function useCustomerGroupCounts(
  customers: Customer[],
  groups: CustomerGroup[],
): Record<string, number> {
  return useMemo(() => {
    const map: Record<string, number> = {}
    for (const g of groups) {
      map[g.id] = customers.filter((c) => matchGroup(c, g)).length
    }
    return map
  }, [customers, groups])
}

/** 新建分组（同事务入同步队列，走 TodoList 先例） */
export async function createCustomerGroup(input: {
  name: string
  includeTags: string[]
  excludeTags: string[]
}): Promise<CustomerGroup> {
  const all = await db.customerGroups.toArray()
  const group: CustomerGroup = {
    id: newId('cg'),
    name: input.name.trim(),
    includeTags: input.includeTags,
    excludeTags: input.excludeTags,
    sortOrder: all.filter((g) => !g.deleted).length,
    createdAt: Date.now(),
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
  const now = Date.now()
  await db.transaction('rw', [db.customerGroups, db.syncQueue], async () => {
    await db.customerGroups.put({ ...group, updatedAt: now, rev: 1 })
    await db.syncQueue.add({
      table: 'customerGroups',
      recordId: group.id,
      op: 'upsert',
      createdAt: now,
    })
  })
  syncEngine.requestSync()
  return group
}

/** 更新分组（改名 / 改规则） */
export async function updateCustomerGroup(
  id: string,
  patch: Partial<Pick<CustomerGroup, 'name' | 'includeTags' | 'excludeTags'>>,
): Promise<void> {
  const prev = await db.customerGroups.get(id)
  if (!prev || prev.deleted) return
  const now = Date.now()
  await db.transaction('rw', [db.customerGroups, db.syncQueue], async () => {
    await db.customerGroups.put({ ...prev, ...patch, updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({
      table: 'customerGroups',
      recordId: id,
      op: 'upsert',
      createdAt: now,
    })
  })
  syncEngine.requestSync()
}

/** 删除分组（纯删规则，不动客户档案 —— 分组是视图） */
export async function deleteCustomerGroup(id: string): Promise<void> {
  const prev = await db.customerGroups.get(id)
  if (!prev) return
  const now = Date.now()
  await db.transaction('rw', [db.customerGroups, db.syncQueue], async () => {
    await db.customerGroups.put({ ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({ table: 'customerGroups', recordId: id, op: 'delete', createdAt: now })
  })
  syncEngine.requestSync()
}

/** tag 实时聚合联想：从现有客户 tags distinct 出热门标签（按出现次数降序），录入与配组界面共用 */
export function useTagSuggestions(customers: Customer[], exclude: string[] = []): string[] {
  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of customers) {
      for (const t of c.tags ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)
      .filter((t) => !exclude.includes(t))
  }, [customers, exclude])
}

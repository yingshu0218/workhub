import { useMemo } from 'react'
import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'
import { syncEngine } from '@/sync/engine'
import { newId } from '@/repositories'
import type {
  Customer,
  Interaction,
  Project,
  RelationCategory,
  Todo,
  Transaction,
} from '@/db/types'
import { isTodoOpen } from '@/modules/todo/domain'
import type { computeIntimacyScore } from './intimacy'

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
    status: Todo['status']
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

/** 算法健康分因子投影（Issue #34）：含最后一次联系时间，客户列表页单客户场景复用 */
export interface CustomerScoreRows {
  transactions: { customerId?: string; amount: number }[]
  todos: { customerId?: string; title: string; status: Todo['status'] }[]
  projects: { id: string; customerId?: string; status: Project['status'] }[]
  interactions: { customerId?: string; at: number }[]
}

/**
 * 单客户算法健康分入参（Issue #108 收口）：口径与 `buildScoreInput(graph, id)` 完全一致，
 * 差别只在数据来源——这里是单客户索引查询（列表页没有全量画布投影），
 * 由 `crm/healthScore.ts` 统一推导展示口径，避免各页面各写一套。
 */
export function useCustomerScoreInput(
  customerId: string | undefined,
): Parameters<typeof computeIntimacyScore>[0] | null {
  const rows = useQuery<CustomerScoreRows>(async () => {
    if (!customerId) return { transactions: [], todos: [], projects: [], interactions: [] }
    const [transactions, todos, projects, interactions] = await Promise.all([
      db.transactions
        .where('customerId')
        .equals(customerId)
        .filter((t) => !t.deleted)
        .toArray(),
      db.todos
        .where('customerId')
        .equals(customerId)
        .filter((t) => !t.deleted)
        .toArray(),
      db.projects
        .where('customerId')
        .equals(customerId)
        .filter((p) => !p.deleted)
        .toArray(),
      db.interactions
        .where('customerId')
        .equals(customerId)
        .filter((i) => !i.deleted)
        .toArray(),
    ])
    return { transactions, todos, projects, interactions }
  }, [customerId])
  return useMemo(
    () => (rows ? buildScoreInputFromRows(rows, customerId ?? '', Date.now()) : null),
    [rows, customerId],
  )
}

/**
 * 批量算法健康分入参（Issue #108 列表页兜底）：
 * 未手动设置档位的客户才需要算，`ids` 为空时零查询直接返回空表。
 * 查询走 customerId 索引，只需 4 张表各一次 in 批量查询，不做 N+1。
 */
export function useCustomerScoreRows(
  ids: string[],
): Record<string, Parameters<typeof computeIntimacyScore>[0]> {
  const key = ids.join(',')
  const rows = useQuery<CustomerScoreRows>(async () => {
    if (ids.length === 0) return { transactions: [], todos: [], projects: [], interactions: [] }
    const [transactions, todos, projects, interactions] = await Promise.all([
      db.transactions
        .where('customerId')
        .anyOf(ids)
        .filter((t) => !t.deleted)
        .toArray(),
      db.todos
        .where('customerId')
        .anyOf(ids)
        .filter((t) => !t.deleted)
        .toArray(),
      db.projects
        .where('customerId')
        .anyOf(ids)
        .filter((p) => !p.deleted)
        .toArray(),
      db.interactions
        .where('customerId')
        .anyOf(ids)
        .filter((i) => !i.deleted)
        .toArray(),
    ])
    return { transactions, todos, projects, interactions }
  }, [key])
  // 依赖用 key（ids.join(',')）而非 ids：调用方每次渲染都新建数组，直接依赖 ids 会无限重算
  return useMemo(() => {
    if (!rows) return {}
    const now = Date.now()
    return Object.fromEntries(
      key ? key.split(',').map((id) => [id, buildScoreInputFromRows(rows, id, now)]) : [],
    )
  }, [rows, key])
}

/** 单客户算法健康分入参（纯函数版，供 hooks 与列表批量推导复用，口径与图谱侧一致） */
export function buildScoreInputFromRows(
  rows: CustomerScoreRows,
  customerId: string,
  now: number,
): Parameters<typeof computeIntimacyScore>[0] {
  const since = now - 90 * 86_400_000
  return {
    interactionCount90d: rows.interactions.filter(
      (i) => i.customerId === customerId && i.at >= since,
    ).length,
    financeAmount: rows.transactions
      .filter((t) => t.customerId === customerId)
      .reduce((sum, t) => sum + t.amount, 0),
    activeTodos: rows.todos.filter((t) => t.customerId === customerId && isTodoOpen(t)).length,
    doneTodos: rows.todos.filter((t) => t.customerId === customerId && !isTodoOpen(t)).length,
    projects: rows.projects.filter((p) => p.customerId === customerId).length,
    activeProjects: rows.projects.filter(
      (p) => p.customerId === customerId && p.status === 'active',
    ).length,
    lastContactAt: rows.interactions
      .filter((i) => i.customerId === customerId)
      .reduce((max, i) => (i.at > max ? i.at : max), 0),
  }
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

// 客户建档 + 跨模块关联初始化已下沉到 repositories（§9.6 不变式 / P1 第 2 步）。
// 此处 re-export 保持 UI 侧引用路径不变，消双份实现。
export { createCustomerWithInit, type CustomerInitOptions } from '@/repositories'

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

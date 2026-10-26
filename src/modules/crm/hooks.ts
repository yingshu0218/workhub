import { useMemo } from 'react'
import dayjs from 'dayjs'
import { db } from '@/db/db'
import { storage } from '@/storage'
import { nextSortOrder, reorderBySortOrder } from '@/repositories/sortOrder'
import { groupTxnLinks, txnLinksOf } from '@/modules/finance/links'
import { useQuery } from '@/queries/hooks'
import { newId } from '@/repositories'
import type {
  Customer,
  Interaction,
  Note,
  Project,
  RelationCategory,
  Todo,
  Transaction,
} from '@/db/types'
import { isTodoOpen, isTodoDone } from '@/modules/todo/domain'
import { normalizeTodoPriority } from '@/modules/todo/priority'
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
    priority: Todo['priority']
    status: Todo['status']
    projectId?: string
  }[]
  /** 沟通日志投影：桥接推导需 customerId+projectId（CanvasGraph 原不含 interaction，Issue #34 补齐） */
  interactions: { id: string; customerId: string; projectId?: string; at: number }[]
  /** 项目状态投影（Issue #34 算法亲密度：active 项目双倍权重） */
  projectStatuses: Record<string, 'active' | 'paused' | 'archived'>
  notes: { id: string; customerId: string; title: string }[]
  /**
   * 悬挂关系条数：`relations[].targetId` 指向不存在/已删除客户、被投影层过滤掉的条目数。
   *
   * 为什么必须带出来（2026-10-13 用户反馈驱动）：这些条目此前被**静默丢弃**，于是
   * 「本来就没有关系」与「关系全部指错了客户」在画布上长得一模一样 —— 都是一条线都没有。
   * 实测踩到：测试服 16 个客户 / 12 条关系 / 有效 0 条，画布表现为一组孤立点，排查成本很高。
   * 消费方（`CrmCanvasPage`）据此显式提示，不让数据坏掉这件事伪装成「没有关系」。
   */
  danglingRelations?: number
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
    // 流水关联索引（v15 起 related link）：建边投影与亲密度展开共用一份
    const txnIndex = groupTxnLinks(await db.links.where('kind').equals('related').toArray())
    const [customers, projects, txns, todos, itxs] = await Promise.all([
      db.customers.filter((c) => !c.deleted).toArray(),
      db.projects.filter((p) => !p.deleted).toArray(),
      // 流水关联已迁 links（v15）：取全量活流水，关联性由 link 索引判定
      db.transactions.filter((t) => !t.deleted).toArray(),
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
    // 笔记经 mention link 反查客户（v15 起 mentions 迁 links：kind 索引收窄 + 内存过滤目标客户）
    const customerIds = new Set(customers.map((c) => c.id))
    const mentionLinks = (await db.links.where('kind').equals('mention').toArray()).filter(
      (l) => !l.deleted && l.toType === 'customers' && customerIds.has(l.toId),
    )
    const noteRows = await db.notes.bulkGet([...new Set(mentionLinks.map((l) => l.fromId))])
    const notes = noteRows.filter((n): n is Note => !!n && !n.deleted)
    // noteId → 提及的客户 id（同笔记提及多客户时取首条 link 的目标，与原 find 口径一致）
    const mentionByNote = new Map<string, string>()
    for (const l of mentionLinks) {
      if (!mentionByNote.has(l.fromId)) mentionByNote.set(l.fromId, l.toId)
    }
    // 客户间关系已迁 links（v15，kind='relation' canonical）：按任一端归组出「各客户的关系视图」
    const relationLinks = (await db.links.where('kind').equals('relation').toArray()).filter(
      (l) => !l.deleted,
    )
    const relationsByCustomer = new Map<string, { targetId: string; label: string; category?: RelationCategory }[]>()
    for (const l of relationLinks) {
      if (!customerIds.has(l.fromId) || !customerIds.has(l.toId)) continue
      const push = (owner: string, target: string) => {
        const list = relationsByCustomer.get(owner) ?? []
        list.push({
          targetId: target,
          label: typeof l.meta?.label === 'string' ? l.meta.label : '',
          ...(l.meta?.category ? { category: l.meta.category } : {}),
        })
        relationsByCustomer.set(owner, list)
      }
      push(l.fromId, l.toId)
      push(l.toId, l.fromId) // canonical 一条记录，两侧视图各自展开
    }
    // 悬挂关系：写入端已校验端点存活、级联会墓碑化，结构上不可产生；此处仍逐条防御
    //（手工改库/异常数据），口径与投影过滤同源 —— 改一处必须改另一处。
    const aliveRelationLinks = relationLinks.filter(
      (l) => customerIds.has(l.fromId) && customerIds.has(l.toId),
    )
    const danglingRelations = relationLinks.length - aliveRelationLinks.length
    return {
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        lastContactAt: c.lastContactAt,
        // 双侧视图：canonical link 在两端各自展开成「我的关系」条目（原数组口径的形状不变，
        // 下游 buildGraph 纯函数层零改动）
        relations: relationsByCustomer.get(c.id) ?? [],
        intimacy: c.intimacy
          ? { level: c.intimacy.level, note: c.intimacy.note, updatedAt: c.intimacy.updatedAt }
          : undefined,
      })),
      danglingRelations,
      projects: projects.map((p) => ({ id: p.id, name: p.name, customerId: p.customerId ?? '' })),
      projectStatuses: Object.fromEntries(projects.map((p) => [p.id, p.status])),
      // 建边投影保持单值口径（Issue #140）：多关联的一笔流水对每个关联客户各出一份投影，
      // 画布/亲密度/时间轴按客户维度展开才能正确计数（总数由节点去重，不重复计数）。
      // 关联来源改为 link 索引（v15）；只保留有关联客户的流水（建边才有意义）。
      transactions: txns.flatMap((t) => {
        const links = txnLinksOf(txnIndex, t.id)
        return links.customerIds.map((cid) => ({
          id: t.id,
          customerId: cid,
          type: t.type,
          amount: t.amount,
          summary: t.summary,
          projectId: links.projectIds[0],
          ledgerId: t.ledgerId ?? undefined,
        }))
      }),
      todos: todos.map((t) => ({
        id: t.id,
        customerId: t.customerId ?? '',
        title: t.title,
        // 读投影归一化：存量 P1/P2/P3 也要能在图谱/健康分里按四档判定（Issue #148 后续）
        priority: normalizeTodoPriority(t.priority),
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
        return { id: n.id, customerId: mentionByNote.get(n.id) ?? '', title: n.title }
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
    // 关联已迁 links（v15）：按 link 索引过滤该客户的流水（与 useCustomerTransactions 同口径）
    const txnIndex = groupTxnLinks(await db.links.where('kind').equals('related').toArray())
    const [transactions, todos, projects, interactions] = await Promise.all([
      db.transactions
        .filter((t) => !t.deleted && txnLinksOf(txnIndex, t.id).customerIds.includes(customerId))
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
    // 内存过滤用的 id 集合；流水关联已迁 links（v15），先取 related link 索引再展开
    const idSet = new Set(ids)
    const txnIndex = groupTxnLinks(await db.links.where('kind').equals('related').toArray())
    const [transactions, todos, projects, interactions] = await Promise.all([
      // 多关联（Issue #140）：一笔流水对每个关联客户各展开一份因子投影（与 CanvasGraph 同口径）
      db.transactions
        .filter((t) => !t.deleted)
        .toArray()
        .then((rows) =>
          rows.flatMap((t) =>
            txnLinksOf(txnIndex, t.id)
              .customerIds.filter((id) => idSet.has(id))
              .map((id) => ({ customerId: id, amount: t.amount })),
          ),
        ),
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
    // 已完成口径（Issue #128）：只数 done；作废条目（终止）不计入完成数
    doneTodos: rows.todos.filter((t) => t.customerId === customerId && isTodoDone(t)).length,
    projects: rows.projects.filter((p) => p.customerId === customerId).length,
    activeProjects: rows.projects.filter(
      (p) => p.customerId === customerId && p.status === 'active',
    ).length,
    lastContactAt: rows.interactions
      .filter((i) => i.customerId === customerId)
      .reduce((max, i) => (i.at > max ? i.at : max), 0),
  }
}

// ─────────────────────────── 客户列表顶部统计（改版：指标去健康度化） ───────────────────────────

/** 客户列表顶部统计口径（刻意与健康分无关，故不依赖 intimacy 模块） */
export interface CustomerListStats {
  /** 可见客户总数（已剔除黑名单屏蔽集） */
  total: number
  /** 本月新建档案数 */
  newThisMonth: number
  /** 待跟进：超 7 天未联系（含从未联系） */
  staleFollowUp: number
  /** 待回收款：关联客户「收入 且 待对账」流水的金额合计 */
  pendingReceivable: number
  /** 待回收款中金额最大一笔的「客户名 · 摘要」；无待收款时为 null（卡片副标题用） */
  topReceivable: string | null
}

/** 待跟进判定天数 —— 卡片文案「超 N 天未联系」与判据必须同源，故提常量而非两处写死 */
export const STALE_FOLLOW_UP_DAYS = 7

/**
 * 客户列表顶部统计（改版）：原「客户总数 + 健康分前 3 档」四张卡里，三张是健康分派生，
 * 按用户拍板一并移出列表页 —— 换成与分层无关的指标。
 *
 * `pendingReceivable` 的判据刻意与客户详情页「待对账款项」同源（`status === '待对账'`），
 * 只是这里收窄到**收入**并跨客户聚合（详情页看单客户、列表页看全局）；
 * 两处口径若漂移，会出现「列表说有待收、点进去一笔都没有」。
 */
export function useCustomerListStats(visible: Customer[]): CustomerListStats {
  const ids = visible.map((c) => c.id)
  // 依赖用 join 后的 key 而非 ids 数组：调用方每次渲染都新建数组，直接依赖会无限重算
  const key = ids.join(',')
  const receivables = useQuery<{ customerId: string; amount: number; summary: string }[]>(
    async () => {
      if (ids.length === 0) return []
      const idSet = new Set(ids)
      // 关联已迁 links（v15）：related link 索引展开（关联客户命中 idSet 才计入）
      const txnIndex = groupTxnLinks(await db.links.where('kind').equals('related').toArray())
      const rows = await db.transactions
        .filter((t) => !t.deleted && t.type === 'income' && t.status === '待对账')
        .toArray()
      // 一笔款分摊多客户时各方各记一份（与健康分因子 / 图谱建边同一展开口径）
      return rows.flatMap((t) =>
        txnLinksOf(txnIndex, t.id)
          .customerIds.filter((id) => idSet.has(id))
          .map((id) => ({ customerId: id, amount: t.amount, summary: t.summary })),
      )
    },
    [key],
  )

  return useMemo(() => {
    const monthStart = dayjs().startOf('month').valueOf()
    const staleBefore = Date.now() - STALE_FOLLOW_UP_DAYS * 86_400_000
    const list = receivables ?? []
    const nameOf = new Map(visible.map((c) => [c.id, c.name]))
    const top = list.reduce<(typeof list)[number] | null>(
      (best, r) => (best && best.amount >= r.amount ? best : r),
      null,
    )
    return {
      total: visible.length,
      newThisMonth: visible.filter((c) => c.createdAt >= monthStart).length,
      staleFollowUp: visible.filter((c) => !c.lastContactAt || c.lastContactAt < staleBefore).length,
      pendingReceivable: list.reduce((sum, r) => sum + r.amount, 0),
      topReceivable: top ? `${nameOf.get(top.customerId) ?? '未知客户'} · ${top.summary}` : null,
    }
  }, [visible, receivables])
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
        ? // 关联已迁 links（v15）：按 [toType+toId] 索引反查流水 id，一笔款分摊多客户时各方都能看到
          db.links
            .where('[toType+toId]')
            .equals(['customers', customerId])
            .filter((l) => !l.deleted && l.kind === 'related' && l.fromType === 'transactions')
            .toArray()
            .then((ls) => db.transactions.bulkGet(ls.map((l) => l.fromId)))
            .then((rows) =>
              rows.filter((t): t is Transaction => !!t && !t.deleted).sort(
                (a, b) => b.occurredAt - a.occurredAt,
              ),
            )
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

import type { CustomerGroup, Link, TrashSnapshot } from '@/db/types'
import { customerInGroup } from '@/db/types'
import { cascadeSoftDeleteLinks, memberIndexOf } from '@/repositories/links'

/** 订阅自定义分组（按 sortOrder 排序，过滤软删） */
export function useCustomerGroups(): CustomerGroup[] {
  const groups = useQuery<CustomerGroup[]>(async () => {
    const all = await db.customerGroups.toArray()
    return all.filter((g) => !g.deleted).sort((a, b) => a.sortOrder - b.sortOrder)
  }, [])
  return groups ?? []
}

/**
 * 客户 → 手动分组归属索引（Phase 3 读侧收口）：Map<customerId, groupId>，
 * liveQuery 订阅 links —— 拖拽/级联/恢复/同步对 member link 的任何变更都自动重渲染。
 * 只覆盖 manual 语义（rule 组是标签视图，不消费 member link —— 裁决 C）。
 */
export function useCustomerGroupIdOf(): Map<string, string> {
  const rows =
    useQuery<Link[]>(
      () =>
        db.links
          .where('kind')
          .equals('member')
          .filter((l) => !l.deleted && l.fromType === 'customers' && l.toType === 'customerGroups')
          .toArray(),
      [],
    ) ?? EMPTY_GROUP_MEMBER_ROWS
  return memberIndexOf(rows)
}

const EMPTY_GROUP_MEMBER_ROWS: Link[] = []

/** 各分组实时命中人数（本地量级无压力；不落快照，改 tag 即进出组）。
 *  Phase 3 双轨：manual 组按 member 索引计数（groupIdOf 注入），rule 组按标签匹配。 */
export function useCustomerGroupCounts(
  customers: Customer[],
  groups: CustomerGroup[],
  groupIdOf: Map<string, string>,
): Record<string, number> {
  return useMemo(() => {
    const map: Record<string, number> = {}
    for (const g of groups) {
      const kind = g.kind ?? 'rule'
      map[g.id] =
        kind === 'manual'
          ? customers.filter((c) => groupIdOf.get(c.id) === g.id).length
          : customers.filter((c) => customerInGroup(c, g)).length
    }
    return map
  }, [customers, groups, groupIdOf])
}

/**
 * 拖拽落点的索引修正（纯函数，可测）。
 *
 * **先把源项从数组里摘掉，再按目标索引插入** —— 否则 `from < to` 时目标项会因源项
 * 被摘除而整体前移一位，表现为「往下拖一格只挪了半格 / 拖不动」。
 * 与 `/todo`（清单）和 `/finance`（账本）两处的实现同一口径，避免三处各写一遍。
 */
export function moveInOrder(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(from < to ? to - 1 : to, 0, moved)
  return next
}

/**
 * 拖拽排序：按传入的 id 顺序重写 sortOrder（用例 #34）。
 *
 * 与 `reorderTodoLists` 同款纪律：**同事务内改记录 + 入同步队列**，
 * 否则本地顺序变了但推不上服务端，换设备就回到旧顺序（本项目最容易踩的同步坑）。
 * `sortOrder` 字段早在 Issue #63 就已在模型与服务端集合里（customerGroups），
 * 缺的只是「改它的入口」—— 本函数补上写入侧，UI 侧在 CrmPage 的分组栏。
 *
 * ⚠️ 写入经 `storage.transaction`（StorageAdapter 原语），不直写 Dexie
 * —— 审计 P1（2026-10-21）：模块直写 `db.transaction` 的 30 处不随存储迁移。
 */
export async function reorderCustomerGroups(orderedIds: string[]): Promise<void> {
  await reorderBySortOrder('customerGroups', orderedIds)
}

/** 新建分组（同事务入同步队列，走 TodoList 先例） */
export async function createCustomerGroup(input: {
  name: string
  includeTags: string[]
  excludeTags: string[]
  /** 分组模式（2026-10-17 双模式）：缺省 rule 兼容旧调用方 */
  kind?: 'manual' | 'rule'
}): Promise<CustomerGroup> {
  const now = Date.now()
  const group: CustomerGroup = {
    id: newId('cg'),
    name: input.name.trim(),
    kind: input.kind ?? 'rule',
    includeTags: input.includeTags,
    excludeTags: input.excludeTags,
    // 尾值走收口实现（max+1，非 length —— length 在删除后会产生重号，见 repositories/sortOrder.ts）
    sortOrder: await nextSortOrder('customerGroups'),
    createdAt: now,
    updatedAt: now,
    deleted: 0,
    rev: 1,
  }
  await storage.transaction(['customerGroups', 'syncQueue'], async (tx) => {
    await tx.put('customerGroups', group)
    await tx.enqueue('customerGroups', group.id, 'upsert', now)
  })
  storage.requestSync()
  return group
}

/** 更新分组（改名 / 改规则） */
export async function updateCustomerGroup(
  id: string,
  patch: Partial<Pick<CustomerGroup, 'name' | 'includeTags' | 'excludeTags' | 'kind'>>,
): Promise<void> {
  const now = Date.now()
  await storage.transaction(['customerGroups', 'syncQueue'], async (tx) => {
    const prev = await tx.get<CustomerGroup>('customerGroups', id)
    if (!prev || prev.deleted) return
    await tx.put('customerGroups', { ...prev, ...patch, updatedAt: now, rev: prev.rev + 1 })
    await tx.enqueue('customerGroups', id, 'upsert', now)
  })
  storage.requestSync()
}

/**
 * 删除分组（Phase 3 集合层版：manual 成员 = member link，删除即统一墓碑化）。
 *
 * rule 组本无存储成员（标签视图），member 清扫对它是 no-op —— 与 manual 组同一实现。
 * 快照 `cascadeLinkIds` 留档：恢复分组时两端存活的成员关系逐条复活。
 */
export async function deleteCustomerGroup(id: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['customerGroups', 'links', 'syncQueue'], async (tx) => {
    const prev = await tx.get<CustomerGroup>('customerGroups', id)
    if (!prev || prev.deleted) return
    const cascadeLinkIds = await cascadeSoftDeleteLinks(tx, [{ type: 'customerGroups', id }], now)
    const trashSnapshot: TrashSnapshot = {
      children: [],
      links: [],
      ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
    }
    await tx.update('customerGroups', id, {
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot,
    })
    await tx.enqueue('customerGroups', id, 'delete', now)
  })
  storage.requestSync()
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

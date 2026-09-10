import type { IntimacyLevel, RelationCategory } from '@/db/types'
import { INTIMACY_LEVELS, INTIMACY_VISUAL } from '@/db/types'
import type { CanvasGraph } from '../hooks'
import { buildScoreInput, resolveIntimacyLevel, isBlacklistHidden } from '../intimacy'
import type { ModuleConfigIntimacy } from '@/db/types'
import type { GraphLink, GraphNode } from './types'
import { GRAPH_COLORS } from './types'

/**
 * graph 投影 → 节点/边 纯函数（无 React / d3 副作用，单测可覆盖）
 * 从 CrmCanvasPage 抽出的构建逻辑，含 Issue #22 的新增：
 * - 客户↔客户语义关系边（relations），kind='relation'，渲染层画带标签曲线
 * - focusId 聚焦模式：数据裁剪（只保留焦点客户 + 一跳邻居），非整图加载后隐藏
 * 悬挂防御：所有边的 source 必须命中节点 ID 集合（历史脏数据兜底）
 */

export interface BuildGraphOptions {
  /** 聚焦模式：只保留该客户 + 一跳邻居（其业务实体 + 关联客户） */
  focusId?: string
  /** 视图模式：mixed=客户+业务实体（默认，兼容原全景）；customer-only=纯客户+分类关系边 */
  mode?: GraphMode
  /** 关系归类筛选（customer-only 模式）：只保留含任一所选类别的边；缺省=全部 */
  categories?: RelationCategory[]
  /** 初始打散锚点（画布中心） */
  center: { x: number; y: number }
  /** 亲密度配置（Issue #34）：传入即启用黑名单过滤 + customer-only 模式下圈层布局 */
  intimacyCfg?: ModuleConfigIntimacy
}

const fmtMoney = (n: number) => `¥${n.toLocaleString('zh-CN')}`
const trunc = (s: string, n = 8) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** 图谱视图模式（Issue #34）：混合（客户+业务实体辐条，原全景） / customer-only（纯客户关系网） */
export type GraphMode = 'mixed' | 'customer-only'

/** 组装节点与从属边（客户 → 项目/流水/待办/笔记），返回 { nodes, links } 与客户 id 集合 */
function assemble(graph: CanvasGraph): { nodes: GraphNode[]; links: GraphLink[] } {
  const ns: GraphNode[] = []
  const ls: GraphLink[] = []
  // 已有节点 ID 集合：所有连线的 source 必须命中，避免悬挂边导致 d3 崩溃
  const nodeIds = new Set<string>()
  for (const c of graph.customers) {
    ns.push({
      id: c.id,
      kind: 'customer',
      label: c.name,
      color: GRAPH_COLORS.customer.stroke,
      fill: GRAPH_COLORS.customer.fill,
      radius: 24,
    })
  }
  for (const n of ns) nodeIds.add(n.id)

  // 项目节点：挂靠客户的主题容器（客户 → 项目 → 流水/待办 层级）
  for (const p of graph.projects) {
    ns.push({
      id: `proj:${p.id}`,
      kind: 'project',
      to: `/projects/${p.id}`,
      label: trunc(p.name),
      color: GRAPH_COLORS.project.stroke,
      fill: GRAPH_COLORS.project.fill,
      radius: 15,
    })
    // 防御：客户可能已被删除（历史脏数据），悬挂边会让 d3 forceLink 抛 node not found 白屏
    if (p.customerId && nodeIds.has(p.customerId))
      ls.push({ source: p.customerId, target: `proj:${p.id}`, kind: 'belongs' })
  }
  for (const t of graph.transactions) {
    ns.push({
      id: `txn:${t.id}`,
      kind: 'txn',
      label: `${t.type === 'income' ? '+' : '-'}${fmtMoney(t.amount)}`,
      color: t.type === 'income' ? GRAPH_COLORS.income.stroke : GRAPH_COLORS.expense.stroke,
      fill: t.type === 'income' ? GRAPH_COLORS.income.fill : GRAPH_COLORS.expense.fill,
      radius: 12,
    })
    ls.push({ source: t.customerId, target: `txn:${t.id}`, kind: 'belongs' })
  }
  for (const t of graph.todos) {
    ns.push({
      id: `todo:${t.id}`,
      kind: 'todo',
      label: trunc(t.title),
      color: GRAPH_COLORS.todo.stroke,
      fill: GRAPH_COLORS.todo.fill,
      radius: 9,
    })
    ls.push({ source: t.customerId, target: `todo:${t.id}`, kind: 'belongs' })
  }
  // 笔记节点：mentions 反查关联客户的笔记投影（数据来自 useCanvasGraph）
  for (const n of graph.notes) {
    ns.push({
      id: `note:${n.id}`,
      kind: 'note',
      to: `/notes/${n.id}`,
      label: trunc(n.title),
      color: GRAPH_COLORS.note.stroke,
      fill: GRAPH_COLORS.note.fill,
      radius: 7,
    })
    ls.push({ source: n.customerId, target: `note:${n.id}`, kind: 'belongs' })
  }
  return { nodes: ns, links: ls }
}

/**
 * 客户↔客户语义关系边（kind='relation'）
 * 去重防 A-B / B-A 重复：同一对客户只画一条无向边，该对之间所有 relation 条目的
 * category 聚合到边上（Issue #34 裁决：单对单边 + 类别聚合）；
 * labels 聚合该对之间全部语义标签（Issue #39：连线上完整呈现多条语义文字，而非仅靠颜色区分），label 为其 ' / ' 拼接
 */
function buildRelationLinks(graph: CanvasGraph): GraphLink[] {
  const byPair = new Map<
    string,
    { source: string; target: string; labels: string[]; categories: RelationCategory[] }
  >()
  for (const c of graph.customers) {
    for (const r of c.relations) {
      // 悬挂防御：指向不存在/已删除客户的条目在投影层已过滤，这里再挡一层
      if (!graph.customers.some((x) => x.id === r.targetId)) continue
      const key = [c.id, r.targetId].sort().join('~')
      const hit = byPair.get(key)
      if (hit) {
        // 已有该对客户：聚合全部语义标签（Issue #39：同对允许多条，连线文字须完整呈现）
        if (!hit.labels.includes(r.label)) hit.labels.push(r.label)
        if (r.category && !hit.categories.includes(r.category)) hit.categories.push(r.category)
      } else {
        byPair.set(key, {
          source: c.id,
          target: r.targetId,
          labels: [r.label],
          categories: r.category ? [r.category] : [],
        })
      }
    }
  }
  return [...byPair.values()].map((e) => ({
    source: e.source,
    target: e.target,
    kind: 'relation' as const,
    label: e.labels.join(' / '),
    labels: e.labels,
    categories: e.categories,
  }))
}

/**
 * 二跳桥接弱边（Issue #34）：倒排分桶 + 桶内两两连边，规避 O(n²) 全扫。
 * 只派生两类弱关联，桥接边 kind='bridge'（虚线弱视觉，见 types.bridge）：
 * - 项目桥接：客户 A 在项目 P 下有流水/待办/沟通（customerId=A & projectId=P），
 *   而项目 P 挂属客户 B（P.customerId=B）→ A—B「项目桥接」，label 注明项目名。
 * - 财务桥接：同一 ledger 下 A 有出账（expense）+ B 有入账（income）→ A—B「资金往来」。
 * 事件独立桥接不做：interactions/todos 本质已被项目桥接覆盖，避免弱边噪音。
 * 去重 & 悬挂防御：只连现存客户且两两不重复；默认稀疏、不设硬阈值。
 */
function deriveCustomerEdges(graph: CanvasGraph): GraphLink[] {
  const custIds = new Set(graph.customers.map((c) => c.id))
  const out: GraphLink[] = []
  const seen = new Set<string>()
  const addBridge = (a: string, b: string, label: string) => {
    if (!a || !b || a === b) return
    if (!custIds.has(a) || !custIds.has(b)) return // 悬挂防御：只连现存客户
    const key = [a, b].sort().join('~')
    if (seen.has(key)) return
    seen.add(key)
    out.push({ source: a, target: b, kind: 'bridge', label })
  }

  // ── 项目桥接：按项目倒排，桶成员 = 在该项目下留有实体（流水/待办/沟通）的客户 ──
  const projOwner = new Map<string, string>() // projectId -> 挂属客户 owner
  const projName = new Map<string, string>()
  for (const p of graph.projects) {
    if (p.customerId) projOwner.set(p.id, p.customerId)
    projName.set(p.id, p.name)
  }
  const projCustomers = new Map<string, Set<string>>()
  const feedProject = (customerId: string, projectId?: string) => {
    if (!customerId || !projectId) return
    if (!projCustomers.has(projectId)) projCustomers.set(projectId, new Set())
    projCustomers.get(projectId)!.add(customerId)
  }
  for (const t of graph.transactions) feedProject(t.customerId, t.projectId)
  for (const t of graph.todos) feedProject(t.customerId, t.projectId)
  for (const i of graph.interactions) feedProject(i.customerId, i.projectId)
  for (const [projId, members] of projCustomers) {
    const owner = projOwner.get(projId)
    if (!owner) continue // 项目未挂客户则无 B 端点，不成桥接
    const label = projName.get(projId) ?? ''
    for (const a of members) addBridge(a, owner, label)
  }

  // ── 财务桥接：按 ledger 倒排出账/入账双方，跨客户两两连「资金往来」 ──
  const ledgerBuckets = new Map<string, { payers: Set<string>; receivers: Set<string> }>()
  for (const t of graph.transactions) {
    if (!t.ledgerId || !t.customerId) continue
    let b = ledgerBuckets.get(t.ledgerId)
    if (!b) {
      b = { payers: new Set(), receivers: new Set() }
      ledgerBuckets.set(t.ledgerId, b)
    }
    if (t.type === 'expense') b.payers.add(t.customerId)
    else if (t.type === 'income') b.receivers.add(t.customerId)
  }
  for (const { payers, receivers } of ledgerBuckets.values()) {
    for (const payer of payers) {
      for (const receiver of receivers) addBridge(payer, receiver, '资金往来')
    }
  }
  return out
}

export function buildGraph(
  graph: CanvasGraph,
  opts: BuildGraphOptions,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const relationLinks = buildRelationLinks(graph)

  // ── customer-only 模式（Issue #34）：纯客户节点 + 分类关系边 + 桥接弱边，业务实体节点不参与 ──
  if (opts.mode === 'customer-only') {
    // 黑名单过滤（Issue #34）：hideInGraph 开启时 I7 客户不渲染（图谱是经营视图，默认屏蔽）
    const visible = opts.intimacyCfg
      ? graph.customers.filter((c) => !isBlacklistHidden(c, opts.intimacyCfg!, 'hideInGraph'))
      : graph.customers
    // 亲密度档位解析（手动最优先 → 算法兜底）：档位驱动节点大小（远近即大小，二者天然一致）
    const levelOf = new Map<string, IntimacyLevel | null>()
    if (opts.intimacyCfg) {
      for (const c of visible) {
        const input = opts.intimacyCfg.algorithm.enabled ? buildScoreInput(graph, c.id) : null
        levelOf.set(c.id, resolveIntimacyLevel(c, opts.intimacyCfg, input).level)
      }
    }
    const ns: GraphNode[] = visible.map((c, i) => {
      const lv = levelOf.get(c.id) ?? null
      const visual = lv ? INTIMACY_VISUAL[lv] : null
      return {
        id: c.id,
        kind: 'customer' as const,
        label: c.name,
        color: visual?.color ?? GRAPH_COLORS.customer.stroke,
        fill: GRAPH_COLORS.customer.fill,
        radius: visual?.radius ?? 24,
        x: opts.center.x + Math.cos(i * 2.4) * 120,
        y: opts.center.y + Math.sin(i * 2.4) * 90,
      }
    })
    const ids = new Set(ns.map((n) => n.id))
    const cats = opts.categories
    const ls = relationLinks.filter((l) => {
      // 类别筛选：边含任一所选类别才保留（无边类别的旧数据归入 other 口径）
      if (cats && cats.length > 0) {
        const edgeCats = l.categories ?? []
        const cs = edgeCats.length > 0 ? edgeCats : (['other'] as RelationCategory[])
        if (!cs.some((c) => cats.includes(c))) return false
      }
      return (
        ids.has(String(typeof l.source === 'string' ? l.source : l.source.id)) &&
        ids.has(String(typeof l.target === 'string' ? l.target : l.target.id))
      )
    })
    return { nodes: ns, links: ls }
  }

  const { nodes, links } = assemble(graph)
  // 二跳桥接弱边：全景视图默认附带；聚焦模式后续 one-hop 裁剪会自动裁掉二跳以外邻居的桥接
  const bridgeLinks = deriveCustomerEdges(graph)
  const allLinks = [...links, ...relationLinks, ...bridgeLinks]
  const allNodes = [...nodes]

  if (!opts.focusId) {
    // 全景：随机初始位置打散，避免同批节点重叠抖动
    allNodes.forEach((n, i) => {
      n.x = opts.center.x + Math.cos(i * 2.4) * 120
      n.y = opts.center.y + Math.sin(i * 2.4) * 90
    })
    return { nodes: allNodes, links: allLinks }
  }

  // ── 聚焦模式：数据裁剪（只保留焦点客户 + 一跳邻居），而非整图加载后隐藏 ──
  const focus = graph.customers.find((c) => c.id === opts.focusId)
  const keep = new Set<string>(opts.focusId ? [opts.focusId] : [])
  if (focus) {
    // 一跳：直接挂在焦点客户下的业务实体 + relations 关联客户
    for (const l of links) {
      const s = String(typeof l.source === 'string' ? l.source : l.source.id)
      const t = String(typeof l.target === 'string' ? l.target : l.target.id)
      if (s === focus.id) keep.add(t)
      if (t === focus.id) keep.add(s)
    }
    for (const r of focus.relations) keep.add(r.targetId)
  }
  const keptNodes = allNodes.filter((n) => {
    if (keep.has(n.id)) return true
    // 项目/流水/待办/笔记节点挂在被裁掉的对象下时一并裁掉；客户节点只保留焦点+关联客户
    return false
  })
  const keptIds = new Set(keptNodes.map((n) => n.id))
  const keptLinks = allLinks.filter((l) => {
    const s = String(typeof l.source === 'string' ? l.source : l.source.id)
    const t = String(typeof l.target === 'string' ? l.target : l.target.id)
    return keptIds.has(s) && keptIds.has(t)
  })

  // 焦点客户居中，邻居环形打散
  keptNodes.forEach((n, i) => {
    if (n.id === opts.focusId) {
      n.x = opts.center.x
      n.y = opts.center.y
      return
    }
    const angle = (i / Math.max(keptNodes.length, 1)) * Math.PI * 2
    n.x = opts.center.x + Math.cos(angle) * 160
    n.y = opts.center.y + Math.sin(angle) * 120
  })
  return { nodes: keptNodes, links: keptLinks }
}

/**
 * 全局画布「我」锚点选取（Issue #94）：进入画布以核心客户为中心节点。
 * 纯函数、确定性排序（同数据同结果），口径：亲密度档位（T1 最优先，I7 黑名单剔除，
 * 未配置档位按 T5 基线）→ 连接度（relations + 桥接弱边数量）→ 最近联系时间新者优先。
 * 返回 null（无可渲染客户）由调用方自行兜底。
 */
export function pickCanvasAnchor(
  graph: CanvasGraph,
  intimacyCfg?: ModuleConfigIntimacy,
): string | null {
  if (graph.customers.length === 0) return null
  const degree = new Map<string, number>()
  for (const c of graph.customers) degree.set(c.id, 0)
  for (const c of graph.customers) {
    for (const r of c.relations) {
      // 悬挂引用不计入连接度（指向已删除客户）
      if (degree.has(r.targetId)) {
        degree.set(c.id, (degree.get(c.id) ?? 0) + 1)
        degree.set(r.targetId, (degree.get(r.targetId) ?? 0) + 1)
      }
    }
  }
  const levelRank = (c: CanvasGraph['customers'][number]): number => {
    if (!intimacyCfg) return 4
    const input = intimacyCfg.algorithm.enabled ? buildScoreInput(graph, c.id) : null
    const lv = resolveIntimacyLevel(c, intimacyCfg, input).level
    return INTIMACY_LEVELS.indexOf(lv) // T1=0 … I7=6，越小越核心
  }
  const best = [...graph.customers]
    .filter((c) => !(intimacyCfg && isBlacklistHidden(c, intimacyCfg, 'hideInGraph')))
    .sort((a, b) => {
      const d = levelRank(a) - levelRank(b)
      if (d !== 0) return d
      const deg = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
      if (deg !== 0) return deg
      return b.lastContactAt - a.lastContactAt
    })
  return best[0]?.id ?? null
}

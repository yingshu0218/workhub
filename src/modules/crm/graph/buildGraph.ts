import type { CanvasGraph } from '../hooks'
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
  /** 初始打散锚点（画布中心） */
  center: { x: number; y: number }
}

const fmtMoney = (n: number) => `¥${n.toLocaleString('zh-CN')}`
const trunc = (s: string, n = 8) => (s.length > n ? `${s.slice(0, n)}…` : s)

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
    if (p.customerId && nodeIds.has(p.customerId)) ls.push({ source: p.customerId, target: `proj:${p.id}`, kind: 'belongs' })
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

/** 客户↔客户语义关系边（kind='relation'，去重防 A-B / B-A 重复） */
function buildRelationLinks(graph: CanvasGraph): GraphLink[] {
  const seen = new Set<string>()
  const out: GraphLink[] = []
  for (const c of graph.customers) {
    for (const r of c.relations) {
      // 悬挂防御：指向不存在/已删除客户的条目在投影层已过滤，这里再挡一层
      if (!graph.customers.some((x) => x.id === r.targetId)) continue
      // 去重：A→B 与 B→A 只画一条（语义为弱关系，方向不敏感）
      const key = [c.id, r.targetId].sort().join('~')
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ source: c.id, target: r.targetId, kind: 'relation', label: r.label })
    }
  }
  return out
}

export function buildGraph(graph: CanvasGraph, opts: BuildGraphOptions): { nodes: GraphNode[]; links: GraphLink[] } {
  const { nodes, links } = assemble(graph)
  const relationLinks = buildRelationLinks(graph)
  const allLinks = [...links, ...relationLinks]
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

import type { RelationCategory } from '@/db/types'
import type { SimulationNodeDatum } from 'd3-force'

/**
 * 图谱视图共享类型（graph → 图元 纯函数的输入输出形态）
 * CrmCanvasPage（全景）与聚焦图谱页同壳复用，见 graph/buildGraph.ts
 */

export interface GraphNode extends SimulationNodeDatum {
  id: string
  kind: 'customer' | 'project' | 'txn' | 'todo' | 'note'
  label: string
  color: string
  fill: string
  radius: number
  /** 双击穿透目标路由（交易/待办/笔记节点） */
  to?: string
}

export type GraphLinkKind = 'belongs' | 'relation'

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  kind: GraphLinkKind
  /** 关系边（客户↔客户）的语义标签，tooltip 展示 */
  label?: string
  /** 关系边聚合的归类维度（同一对客户所有 relation 条目的类别并集，Issue #34） */
  categories?: RelationCategory[]
}

export const GRAPH_COLORS = {
  customer: { stroke: '#004ac6', fill: '#dbe1ff', text: '#004ac6' },
  project: { stroke: '#6d43c4', fill: '#e9ddff', text: '#6d43c4' },
  income: { stroke: '#006c49', fill: '#6cf8bb', text: '#006c49' },
  expense: { stroke: '#ba1a1a', fill: '#ffdad6', text: '#ba1a1a' },
  todo: { stroke: '#943700', fill: '#ffede6', text: '#943700' },
  note: { stroke: '#4a4458', fill: '#e8def8', text: '#4a4458' },
  relation: { stroke: '#943700', text: '#943700' },
} as const

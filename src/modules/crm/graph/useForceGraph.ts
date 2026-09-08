import { useEffect, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from 'd3-force'
import type { RelationCategory } from '@/db/types'
import type { CanvasGraph } from '../hooks'
import { buildGraph, type GraphMode } from './buildGraph'
import type { GraphLink, GraphNode } from './types'

/**
 * d3-force 仿真 hook（GraphCanvas 专用，从 CrmCanvasPage 抽出）
 * 性能纪律（Issue #22 评审）：tick 回调节流到 requestAnimationFrame，
 * 且只在布局未稳定时 setState；仿真 alpha 低后停止重渲染。
 */

export interface ForceGraphOptions {
  graph: CanvasGraph
  size: { w: number; h: number }
  focusId?: string
  /** 视图模式（Issue #34）：默认 mixed */
  mode?: GraphMode
  /** 关系归类筛选（customer-only 模式生效） */
  categories?: RelationCategory[]
}

export function useForceGraph({ graph, size, focusId, mode, categories }: ForceGraphOptions) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const simRef = useRef<Simulation<GraphNode, undefined> | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (size.w === 0 || size.h === 0 || graph.customers.length === 0) return

    const built = buildGraph(graph, {
      focusId,
      mode,
      categories,
      center: { x: size.w / 2, y: size.h / 2 },
    })
    const ns = built.nodes
    const ls = built.links
    if (ns.length === 0) return

    // tick 渲染节流：合并到 requestAnimationFrame，一帧最多一次 setState（替代每 tick 全量渲染）
    let dirty = false
    const flush = () => {
      rafRef.current = null
      if (!dirty) return
      dirty = false
      setNodes([...ns])
      setLinks([...ls])
    }
    const sim = forceSimulation<GraphNode>(ns)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(ls)
          .id((d) => d.id)
          // 客户↔客户关系边给更小 distance：让有关联的客户在布局上聚拢，关系结构可读
          .distance((l) =>
            l.kind === 'relation'
              ? 60
              : (l.source as GraphNode).kind === 'customer' || (l.target as GraphNode).kind === 'customer'
                ? 90
                : 70,
          )
          .strength((l) => (l.kind === 'relation' ? 0.6 : 0.4)),
      )
      .force('charge', forceManyBody().strength(-320))
      .force('center', forceCenter(size.w / 2, size.h / 2))
      .force('collide', forceCollide<GraphNode>().radius((d) => d.radius + 14))
      .alphaDecay(0.03)
    sim.on('tick', () => {
      dirty = true
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
    })
    simRef.current = sim
    setNodes(ns)
    setLinks(ls)
    return () => {
      sim.stop()
      simRef.current = null
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [graph, size.w, size.h, focusId, mode, categories])

  return { nodes, links, setNodes, setLinks, simRef }
}

import { useEffect, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
} from 'd3-force'
import type { RelationCategory, ModuleConfigIntimacy } from '@/db/types'
import type { CanvasGraph } from '../hooks'
import { buildGraph, type GraphMode } from './buildGraph'
import { COLLIDE_PADDING, ringRadius } from './presentation'
import type { GraphLink, GraphNode } from './types'

/**
 * d3-force 仿真 hook（GraphCanvas 专用，从 CrmCanvasPage 抽出）
 * 性能纪律（Issue #22 评审）：tick 回调节流到 requestAnimationFrame，
 * 且只在布局未稳定时 setState；仿真 alpha 低后停止重渲染。
 *
 * ⚠️ 依赖数组里的每个引用都必须是**稳定引用**（2026-10-12 修复）：
 * 本 effect 一旦重跑就会 `forceSimulation` 整体重建、节点回到初始坐标，布局永远收敛不了。
 * 由此曾出过真实缺陷——`useIntimacyConfig()` 每帧返回新对象，把整张画布打成「一直抖、不收敛、
 * onGraphReady 不触发、以我为心的视图锚定失效」。传参前先确认来源被 useMemo 包裹。
 */

/** customer-only 模式：客户落回圈层（以「我」为圆心）的强度 */
const RING_STRENGTH = 0.32

export interface ForceGraphOptions {
  graph: CanvasGraph
  size: { w: number; h: number }
  focusId?: string
  /** 视图模式（Issue #34）：默认 mixed */
  mode?: GraphMode
  /** 关系归类筛选（customer-only 模式生效） */
  categories?: RelationCategory[]
  /** 亲密度配置（Issue #34）：传入启用黑名单过滤 + 亲密度圈层布局 */
  intimacyCfg?: ModuleConfigIntimacy
  /** 「我」自节点显示名（Issue #123）：customer-only 模式画布中心节点文案 */
  selfName?: string
  /** 布局稳定回调（仿真自然收敛时触发一次，供调用方做首屏适应/聚焦，Issue #34） */
  onLayoutSettled?: () => void
}

export function useForceGraph({
  graph,
  size,
  focusId,
  mode,
  categories,
  intimacyCfg,
  selfName,
  onLayoutSettled,
}: ForceGraphOptions) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const simRef = useRef<Simulation<GraphNode, undefined> | null>(null)
  const rafRef = useRef<number | null>(null)
  const onSettledRef = useRef(onLayoutSettled)
  onSettledRef.current = onLayoutSettled

  useEffect(() => {
    if (size.w === 0 || size.h === 0 || graph.customers.length === 0) return

    const built = buildGraph(graph, {
      focusId,
      mode,
      categories,
      intimacyCfg,
      selfName,
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
    const isCustomerOnly = mode === 'customer-only'
    const sim = forceSimulation<GraphNode>(ns)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(ls)
          .id((d) => d.id)
          // 客户↔客户关系边给更小 distance：让有关联的客户在布局上聚拢，关系结构可读
          .distance((l) => {
            if (l.kind === 'relation') return 60
            // 二跳桥接弱边：距离放宽，让主线结构优先、桥接不抢布局
            if (l.kind === 'bridge') return 110
            return (l.source as GraphNode).kind === 'customer' ||
              (l.target as GraphNode).kind === 'customer'
              ? 90
              : 70
          })
          .strength((l) => {
            // 强关联：实线语义关系给强束缚；桥接弱边给极低强度，近似只做「轻引力」不硬拽
            if (l.kind === 'relation') return 0.6
            if (l.kind === 'bridge') return 0.08
            return 0.4
          }),
      )
      .force('charge', forceManyBody().strength(-320))
      .force(
        'collide',
        forceCollide<GraphNode>().radius((d) => d.radius + COLLIDE_PADDING),
      )
      .alphaDecay(0.03)
      // alphaMin 提到 0.06：仿真自然收敛更快（默认 0.001 要 ~300 tick，约 5s 才稳定，
      // 首屏期间节点长漂移导致 fit 追不上「丢失焦点」；0.06 时 ~90 tick 内收敛，仍足以摊开重叠）
      .alphaMin(0.06)

    if (isCustomerOnly) {
      // 「以我为中心」= **圈层**（2026-10-14 用户裁决：仍以我为中心，但不能重叠、不能挤在一侧）。
      //
      // 演进史（每一版都是被真实观感推翻的）：
      // ① forceCenter：只搬「全节点均值」，而「我」被 fx/fy 钉住并每 tick 复位 → 平衡解要求
      //    「客户均值正好落在中心」，单客户时该解要求客户坐标 == 中心（中心节点被吃掉）。
      // ② forceX/forceY（逐点向心）：解决了重合，但它们只把每个节点往中心**拉**，
      //    客户受斥力与连线影响会整体偏到一侧 —— 实测 3 个客户全挤在「我」右边，
      //    「以我为中心」名存实亡，而且严伟强的圈几乎贴到「我」的圈上。
      // ③ forceRadial（本版）：把每个客户放到**以「我」为圆心的环**上，环半径随客户数增长；
      //    环上再由 charge 与 collide 均匀摊开 → 居中、不重叠、不偏侧，三件事同时成立。
      const customerCount = ns.filter((d) => d.kind === 'customer').length
      sim.force(
        'ring',
        forceRadial<GraphNode>(ringRadius(customerCount), size.w / 2, size.h / 2).strength(
          RING_STRENGTH,
        ),
      )
    } else {
      sim.force('center', forceCenter(size.w / 2, size.h / 2))
    }
    sim.on('end', () => {
      // 仿真自然收敛：通知调用方做首屏适应/锁定焦点（只此一次）
      onSettledRef.current?.()
    })
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
  }, [graph, size.w, size.h, focusId, mode, categories, intimacyCfg, selfName])

  return { nodes, links, setNodes, setLinks, simRef }
}

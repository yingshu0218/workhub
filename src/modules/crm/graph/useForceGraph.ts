import { useEffect, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force'
import type { RelationCategory, ModuleConfigIntimacy } from '@/db/types'
import type { CanvasGraph } from '../hooks'
import { buildGraph, type GraphMode } from './buildGraph'
import { COLLIDE_PADDING, orderByRelation, ringRadius, ringSlots } from './presentation'
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

/** customer-only 模式：客户被拉向自己环上座位的强度 */
const SLOT_STRENGTH = 0.5

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
    // customer-only 的位置由**确定性槽位**决定（presentation.ts#ringSlots），力场只做收敛与拖拽响应。
    // 环上相邻槽位的弦长就是「关系边在环上的自然距离」——拿它当 link.distance，
    // 已被排到相邻的关系两端就正好处于自然长度、不再互相拉扯
    const customerIds = ns.filter((d) => d.kind === 'customer').map((d) => d.id)
    const ringR = ringRadius(customerIds.length)
    const spacing = 2 * ringR * Math.sin(Math.PI / Math.max(customerIds.length, 2))

    const sim = forceSimulation<GraphNode>(ns)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(ls)
          .id((d) => d.id)
          // 客户↔客户关系边给更小 distance：让有关联的客户在布局上聚拢，关系结构可读
          .distance((l) => {
            if (l.kind === 'relation') return isCustomerOnly ? spacing : 60
            // 二跳桥接弱边：距离放宽，让主线结构优先、桥接不抢布局
            if (l.kind === 'bridge') return 110
            return (l.source as GraphNode).kind === 'customer' ||
              (l.target as GraphNode).kind === 'customer'
              ? 90
              : 70
          })
          .strength((l) => {
            if (l.kind === 'relation') {
              // customer-only：关系只做**极轻的粘连**。位置已由槽位定死，强拉扯会把整团人拖离
              // 座位、连带把质心带偏 —— 那正是用户截图里「我」不在正中心的原因
              return isCustomerOnly ? 0.08 : 0.6
            }
            if (l.kind === 'bridge') return 0.08
            return isCustomerOnly ? 0.1 : 0.4
          }),
      )
      .force(
        'collide',
        forceCollide<GraphNode>().radius((d) => d.radius + COLLIDE_PADDING),
      )
      .alphaDecay(0.03)
      // alphaMin 提到 0.06：仿真自然收敛更快（默认 0.001 要 ~300 tick，约 5s 才稳定，
      // 首屏期间节点长漂移导致 fit 追不上「丢失焦点」；0.06 时 ~90 tick 内收敛，仍足以摊开重叠）
      .alphaMin(0.06)

    if (isCustomerOnly) {
      // 「以我为中心」= **确定性槽位**（2026-10-14 用户裁决：中心节点必须在其它节点的**正中心**）。
      //
      // 演进史（每一版都是被真实观感推翻的，别再退回去）：
      // ① forceCenter：只搬「全节点均值」，而「我」被 fx/fy 钉住并每 tick 复位 → 平衡解要求
      //    「客户均值正好落在中心」，单客户时该解要求客户坐标 == 中心（中心节点被吃掉）。
      // ② forceX/forceY：只把每个节点往中心**拉**，客户整体偏到一侧（实测 3 个客户全在「我」右边）。
      // ③ forceRadial：环约束只管**半径**、管不了角度，关系连线一拽，三个客户就在环上抱团 ——
      //    环上位置偏了，质心自然不再等于圆心，「我」看起来又不在中心了（用户第二次截图）。
      // ④ 本版：位置由 ringSlots 均匀分角**算出来**，力场只把节点收敛到各自座位。
      //    均匀分角 ⇒ 全部客户坐标的质心恒等于圆心 ⇒ 「我」在正中心是**数学保证**，不是调参调出来的。
      //
      // 同时**去掉多体斥力**：座位已经把节点摆开（环上间距够宽），斥力只会把节点推离座位、
      // 破坏质心不变式；防重叠交给 collide（硬约束）兜底。
      const endId = (v: string | GraphNode) => (typeof v === 'string' ? v : v.id)
      const pairs = ls
        .filter((l) => l.kind === 'relation')
        .map((l) => [endId(l.source), endId(l.target)] as [string, string])
      const slotOf = new Map(
        ringSlots(
          orderByRelation(customerIds, pairs),
          { x: size.w / 2, y: size.h / 2 },
          ringR,
        ).map((s) => [s.id, s]),
      )
      sim
        .force(
          'slotX',
          forceX<GraphNode>((d) => slotOf.get(d.id)?.x ?? size.w / 2).strength(SLOT_STRENGTH),
        )
        .force(
          'slotY',
          forceY<GraphNode>((d) => slotOf.get(d.id)?.y ?? size.h / 2).strength(SLOT_STRENGTH),
        )
    } else {
      sim
        .force('charge', forceManyBody().strength(-320))
        .force('center', forceCenter(size.w / 2, size.h / 2))
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

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
import type { RelationCategory } from '@/db/types'
import type { CanvasGraph } from '../hooks'
import { buildGraph, type GraphMode } from './buildGraph'
import { COLLIDE_PADDING } from './presentation'
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

/** customer-only 模式：向心力（把客户云拉向「我」）的强度 —— 力导向三力之一，见下方块注释 */
const CENTRIPETAL_STRENGTH = 0.06
/** 关系弹簧的聚簇参数：有关系的客户对收敛到这个距离、以这个强度互拉 */
const RELATION_DISTANCE = 110
const RELATION_STRENGTH = 0.5
/** 多体斥力：节点互相推开 —— 孤立节点被推到外圈、簇与簇保持间距（Obsidian 同款三力） */
const CHARGE_STRENGTH = -320
/**
 * 同步风暴防护（2026-10-16 实测）：首次打开时同步逐条写入，graph 引用逐条变化，
 * 20 秒内仿真被重建 44 次 —— 每次都把节点打回环状初值，布局永远收敛不到聚簇态。
 * 双保险修复：① 重建时**继承上次坐标**（d3-force 官方模式：持久化 nodes，位置延续、
 * 新节点才用初值）；② graph 变化 **250ms 防抖**合并（风暴中少建 90% 的仿真）。
 */
const REBUILD_DEBOUNCE_MS = 250

export interface ForceGraphOptions {
  graph: CanvasGraph
  prepared?: {nodes:GraphNode[];links:GraphLink[]}
  size: { w: number; h: number }
  focusId?: string
  /** 视图模式（Issue #34）：默认 mixed */
  mode?: GraphMode
  /** 关系归类筛选（customer-only 模式生效） */
  categories?: RelationCategory[]
  /** 「我」自节点显示名（Issue #123）：customer-only 模式画布中心节点文案 */
  selfName?: string
  /** 布局稳定回调（仿真自然收敛时触发一次，供调用方做首屏适应/聚焦，Issue #34） */
  onLayoutSettled?: () => void
}

export function useForceGraph({
  graph,
  prepared,
  size,
  focusId,
  mode,
  categories,
  selfName,
  onLayoutSettled,
}: ForceGraphOptions) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const simRef = useRef<Simulation<GraphNode, undefined> | null>(null)
  const rafRef = useRef<number | null>(null)
  /** 上一次仿真的节点坐标（按 id）：重建时继承位置，同步风暴中布局不回跳 */
  const prevNodesRef = useRef<Map<string, { x: number; y: number; vx?: number; vy?: number }>>(new Map())
  const onSettledRef = useRef(onLayoutSettled)
  onSettledRef.current = onLayoutSettled

  useEffect(() => {
    if(prepared && !prepared.nodes.length){simRef.current?.stop();simRef.current=null;prevNodesRef.current.clear();setNodes([]);setLinks([]);return}
    if (size.w === 0 || size.h === 0 || (!prepared && graph.customers.length === 0)) return

    let disposed = false
    // 同步风暴防护：graph 逐条变化时 250ms 防抖合并重建（风暴中少建 ~90% 的仿真）
    const buildTimer = setTimeout(() => buildSimulation(), REBUILD_DEBOUNCE_MS)

    function buildSimulation() {
      if (disposed) return
      simRef.current?.stop() // 旧仿真停掉（其坐标已在 cleanup 缓存，见外层 return）
      const built = prepared ? {nodes:prepared.nodes.map(n=>({...n})),links:prepared.links.map(l=>({...l}))} : buildGraph(graph, {
        focusId,
        mode,
        categories,
        selfName,
        center: { x: size.w / 2, y: size.h / 2 },
      })
      const ns = built.nodes
      const ls = built.links
      if (ns.length === 0) {setNodes([]);setLinks([]);return}

      // 坐标继承（d3-force 官方模式）：同 id 节点延续上次位置/速度，只让**新**节点走初值——
      // 重建不再是「打回环状初值」，同步风暴中布局连续演化、收敛后聚簇稳定保留。
      for (const n of ns) {
        const prev = prevNodesRef.current.get(n.id)
        if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
          n.x = prev.x
          n.y = prev.y
          if (prev.vx != null) n.vx = prev.vx
          if (prev.vy != null) n.vy = prev.vy
        }
      }

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
              if (l.kind === 'relation') return isCustomerOnly ? RELATION_DISTANCE : 60
              // 二跳桥接弱边：距离放宽，让主线结构优先、桥接不抢布局
              if (l.kind === 'bridge') return 110
              return (l.source as GraphNode).kind === 'customer' ||
                (l.target as GraphNode).kind === 'customer'
                ? 90
                : 70
            })
            .strength((l) => {
              if (l.kind === 'relation') {
                // customer-only：关系弹簧是聚簇的主导力（Obsidian 式：有关联就相互靠近）
                return isCustomerOnly ? RELATION_STRENGTH : 0.6
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
        // 「以我为中心 + 关系聚簇」的**力导向**布局（2026-10-16 用户拍板：节点要像 Obsidian
        // 图谱一样自动向中心靠近、有关系就聚在一起，位置由算法解决）。
        //
        // 演进史（每一版都是被真实观感推翻的，别再无脑退回）：
        // ① forceCenter：平移解要求「客户均值 == 中心」，单客户时中心节点被吃掉；
        // ② forceX/forceY 强拉且无斥力对冲：客户云整体偏一侧；
        // ③ forceRadial：环约束只管半径不管角度，连线一拽就抱团；
        // ④ ringSlots 确定性槽位：解决了「我居中」，但所有客户等距一个大环 ——
        //    孤立节点占满外圈、有关系的人反而离得远（用户 2026-10-16 截图），被推翻。
        // ⑤ 本版（力导向三力平衡）：**关系弹簧**（有边就相互吸引聚簇）+ **多体斥力**（无关节点
        //    推到外圈、簇间保持间距、防重叠）+ **弱向心力**（全体向「我」收拢）。三力平衡后
        //    自然形成「关系簇在内圈、孤立客户在外圈、我钉在正中」—— Obsidian 图谱同款观感。
        //
        // 不重蹈覆辙的保证：
        // · 不用 forceCenter（平移陷阱）；向心力用 forceX/Y **弱拉**，斥力对称对冲，
        //   配合对称初始位（buildGraph 仍以 ringSlots 均匀环为初值），平衡解不会整体偏一侧；
        // · 「我」仍由 buildGraph 钉死 fx/fy = 画布中心，不参与漂移、不可拖拽（不变式保留）；
        // · 力参数全部是本文件顶部常量 —— 依赖数组引用稳定，仿真不会每帧重建（2026-10-12 教训）；
        // · 视图锚定仍按 settleTick 收敛后重做（fitView 以「我」为基准），质心微漂不影响居中观感。
        sim
          .force('charge', forceManyBody<GraphNode>().strength(CHARGE_STRENGTH))
          .force('centerX', forceX<GraphNode>(size.w / 2).strength(CENTRIPETAL_STRENGTH))
          .force('centerY', forceY<GraphNode>(size.h / 2).strength(CENTRIPETAL_STRENGTH))
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
    }

    return () => {
      disposed = true
      clearTimeout(buildTimer)
      // 卸载/依赖变化：**先把当前节点坐标缓存**（下一次 buildSimulation 继承，位置不回跳），
      // 再停仿真。注意顺序：stop 不清坐标，nodes() 仍可读。
      const cur = simRef.current?.nodes() ?? []
      if (cur.length > 0) {
        prevNodesRef.current = new Map(
          cur.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0, vx: n.vx, vy: n.vy }]),
        )
      }
      simRef.current?.stop()
      simRef.current = null
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [graph, prepared, size.w, size.h, focusId, mode, categories, selfName])

  return { nodes, links, setNodes, setLinks, simRef }
}

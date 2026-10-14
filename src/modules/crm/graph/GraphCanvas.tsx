import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRecord } from '@/queries/hooks'
import type { Customer } from '@/db/types'
import { Card, Chip, EmptyState } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import {
  INTIMACY_VISUAL,
  RELATION_CATEGORIES,
  type RelationCategory,
  type ModuleConfigIntimacy,
} from '@/db/types'
import { useIntimacyConfig } from '../intimacy'
import { IDENTITY_VIEW, usePanZoom } from '../usePanZoom'
import { useForceGraph } from './useForceGraph'
import { computeFitView } from './fitView'
import { relationEdgeInfo } from './presentation'
import { GRAPH_COLORS, type GraphLink, type GraphNode } from './types'
import CustomerInfoCard from './CustomerInfoCard'
import type { CanvasGraph } from '../hooks'

/**
 * 力导向图谱画布（GraphCanvas，Issue #22 抽公共组件）
 * 全景（/crm/canvas，无 focusId）与聚焦（/crm/:id/graph，focusId=客户）同壳复用，
 * 布局/仿真/交互契约完整保留：节点拖拽（pointer capture + fx/fy 钳制）、
 * panZoom 交错组合（节点 onPointerMove 先 panZoom 后自身）、拖拽后不穿透。
 */

export interface GraphCanvasProps {
  graph: CanvasGraph
  /** 聚焦模式：仅渲染该客户及其一跳邻居（数据裁剪见 buildGraph） */
  focusId?: string
  /** 容器高度 className/style 由调用方给（全景与聚焦页外壳不同） */
  style?: React.CSSProperties
  /** 图例区（调用方自定义 chips） */
  legend?: React.ReactNode
  /** 是否展示「重新布局」浮动按钮（原画布页 header 行为保留） */
  showReheat?: boolean
  /** 视图模式（Issue #34）：mixed=客户+业务实体；customer-only=纯客户关系网 */
  mode?: 'mixed' | 'customer-only'
  /** 首屏布局收敛后回调（Issue #34）：视图此刻已 fit 到子图，可做焦点锁定/开场动画等 */
  onGraphReady?: () => void
  /** 焦点锚定（Issue #34）：布局收敛后视图平移使该节点居中（不缩放），一进视图快速锁定焦点主体 */
  fitAnchorId?: string
  /** 亲密度配置注入（Issue #34）：缺省内部读 moduleConfigs；customer-only 模式启用圈层与黑名单过滤 */
  intimacyCfg?: ModuleConfigIntimacy
  /** 「我」显示名（Issue #123）：customer-only 模式下画布中心 self 节点的文案（当前用户名，默认阿蓝） */
  selfName?: string
}

export default function GraphCanvas({
  graph,
  focusId,
  style,
  legend,
  showReheat,
  mode = 'mixed',
  onGraphReady,
  fitAnchorId,
  selfName,
  intimacyCfg: intimacyCfgProp,
}: GraphCanvasProps) {
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const dragIdRef = useRef<string | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // 单击客户节点 → 缩略信息卡（Issue #34）：记录选中客户与节点屏幕坐标
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedScreenRef = useRef({ x: 0, y: 0 })
  const [selectedScreen, setSelectedScreen] = useState({ x: 0, y: 0 })
  // 关系归类筛选（仅 customer-only 模式展示）
  const [activeCats, setActiveCats] = useState<RelationCategory[]>([])
  // 关系边悬浮框（2026-10-14）：连线不再直接写文字（多条语义叠在一起必然互相压字），
  // 改为「移到线上」时在光标旁弹一个小框给出关联字段（语义 + 归类）
  const [edgeHover, setEdgeHover] = useState<{ link: GraphLink; x: number; y: number } | null>(null)
  // 每次仿真收敛自增：让「以我为心」的视图锚定在**数据变化后的重新布局**上也重新生效
  // （原先锚定是一次性的，新增关系 → 布局重算 → 「我」就漂出视口中心，正是用户报的观感）
  const [settleTick, setSettleTick] = useState(0)
  // 亲密度配置：调用方注入优先，缺省内部订阅（moduleConfigs 变更经 useLiveQuery 实时刷新）
  const cfgFromDb = useIntimacyConfig()
  const intimacyCfg = intimacyCfgProp ?? (mode === 'customer-only' ? cfgFromDb : undefined)
  const { nodes, links, simRef } = useForceGraph({
    graph,
    size,
    focusId,
    mode,
    categories: mode === 'customer-only' ? activeCats : undefined,
    intimacyCfg: mode === 'customer-only' ? intimacyCfg : undefined,
    selfName,
    onLayoutSettled: () => {
      setSettleTick((t) => t + 1)
      onGraphReady?.()
    },
  })
  const edgeInfo = edgeHover ? relationEdgeInfo(edgeHover.link) : null

  // customer-only 模式：仅在有关系的客户对上展示归类筛选 chips（无任何归类数据时隐藏）
  const showCatFilter =
    mode === 'customer-only' &&
    links.some((l) => l.kind === 'relation' && (l.categories?.length ?? 0) > 0)

  // 关系层数据健康：只在 customer-only（关系网主视角）生效，且**只在有问题时**才渲染浮层
  const relationTotal = graph.customers.reduce((n, c) => n + c.relations.length, 0)
  const danglingRelations = graph.danglingRelations ?? 0
  const relationHealth = {
    visible: mode === 'customer-only' && (relationTotal === 0 || danglingRelations > 0),
    total: relationTotal,
    dangling: danglingRelations,
  }

  // 卡片数据二次订阅：useRecord 拿客户全量记录，不依赖画布裁剪投影（审计口径）
  const selectedCustomer = useRecord<Customer>('customers', selectedId ?? undefined)
  // 共享视图变换 hook：wheel 缩放 + 空白处拖拽平移（与时间线鱼骨页共用）
  const panZoom = usePanZoom({ size })
  const view = panZoom.view
  const { wheelRef } = panZoom

  // 画布容器尺寸自适应（ResizeObserver）；容器 ref 复用 panZoom.wheelRef（wheel 原生监听同一元素）
  const sizeElRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sizeElRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function toSvgPoint(clientX: number, clientY: number) {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    return pt.matrixTransform(ctm.inverse())
  }

  // SVG 用户坐标 → 节点世界坐标（需逆解外层 g 的 translate+scale）
  function toWorldPoint(clientX: number, clientY: number) {
    const p = toSvgPoint(clientX, clientY)
    if (!p) return null
    return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale }
  }

  /** 关系边悬浮：记下命中的边 + 光标在容器内的位置（浮框用绝对定位贴着光标走） */
  function hoverEdgeAt(e: React.PointerEvent, link: GraphLink) {
    const r = sizeElRef.current?.getBoundingClientRect()
    if (!r) return
    setEdgeHover({ link, x: e.clientX - r.left, y: e.clientY - r.top })
  }

  function onNodePointerDown(e: React.PointerEvent, node: GraphNode) {
    e.stopPropagation()
    // 「我」是画布中心基准锚点：不可拖拽。此前它和客户一样可拖，pointerup 会把 fx/fy 置 null，
    // 中心锁定被解除、视图锚定失去基准（2026-10-12 修复）。自节点只作基准，不参与交互。
    if (node.kind === 'self') return
    e.preventDefault()
    dragIdRef.current = node.id
    pointerStartRef.current = { x: e.clientX, y: e.clientY }
    draggedRef.current = false
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    // 背景平移由 usePanZoom 的 containerProps 处理；这里只处理节点拖拽
    const id = dragIdRef.current
    if (!id) return
    const start = pointerStartRef.current
    if (start) {
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (Math.hypot(dx, dy) > 4) draggedRef.current = true
    }
    const p = toWorldPoint(e.clientX, e.clientY)
    if (!p) return
    const node = nodes.find((n) => n.id === id)
    if (!node) return
    // 拖拽范围钳制到当前可视世界区域（缩放/平移后仍不丢节点）
    const minX = -view.tx / view.scale
    const minY = -view.ty / view.scale
    const maxX = (size.w - view.tx) / view.scale
    const maxY = (size.h - view.ty) / view.scale
    node.fx = Math.max(minX + node.radius, Math.min(maxX - node.radius, p.x))
    node.fy = Math.max(minY + node.radius, Math.min(maxY - node.radius, p.y))
    simRef.current?.alphaTarget(0.25).restart()
  }

  function onPointerUp() {
    const id = dragIdRef.current
    if (!id) return
    dragIdRef.current = null
    const node = nodes.find((n) => n.id === id)
    if (node) {
      node.fx = null
      node.fy = null
    }
    simRef.current?.alphaTarget(0)
  }

  // 触摸拖拽被系统手势/来电等中断时：pointerup 不会派发，必须用 pointercancel 兜底清理 fx/fy
  const onPointerCancel = onPointerUp

  // 「适应画布」：重置缩放平移，使全部节点落在视口内并居中。
  // 数学已抽到 graph/fitView.ts（纯函数 + 单测），这里只做兜底：
  // 无坐标节点/尺寸为 0 时回到单位视图，避免停在上一帧的错位视图上。
  function fitView() {
    panZoom.setView(computeFitView(nodes, size) ?? IDENTITY_VIEW)
  }

  function reheat() {
    nodes.forEach((n) => {
      // 「我」是布局基准：重新布局只释放客户，不能解除中心锁定，否则视图锚定的基准随之失效
      if (n.kind === 'self') return
      n.fx = null
      n.fy = null
    })
    simRef.current?.alpha(0.6).restart()
  }

  // ── 自动视图校准（fit / 焦点锚定）统一调度（Issue #87）──
  // 布局收敛前 fit（首帧 + 二次校准）与收敛后焦点锚定存在时序竞争：
  // 迟到的 fitView 会在锚定之后执行，把视口重新 fit 到整个子图包围盒（含被斥力推远的
  // 邻居节点），焦点客户被挤离视口中心（截图表现：200% 缩放下焦点节点跑到左上角）。
  // 统一规则：fit 任务可取消、执行时读当帧最新坐标；焦点锚定一旦生效即取消 pending fit
  // 并阻断后续所有自动 fit，保证锚定是最后一次视图操作。
  const fitKey = `${focusId ?? 'all'}-${nodes.length}-${mode}`
  // 焦点锚定已生效标记：此后不再自动 fit（焦点客户已在视口中心，fit 反而挤走它）。
  // 记录生效时的 fitKey：仅锁同一视图状态；fitKey 变化（切模式/数据重算）自动解锁，
  // 否则 customer-only 切全景后自动 fit 被永久抑制，视图停留在旧中心（Issue #94 隐患）
  const anchorLockedKeyRef = useRef<string | null>(null)
  // pending fit 的 rAF 句柄：锚定/重调度/卸载时可取消
  const fitRafRef = useRef<number | null>(null)
  // fitView 是每次渲染重建的闭包，rAF 回调经 ref 转发，保证执行时拿到最新版本（最新坐标）
  const fitViewRef = useRef(fitView)
  fitViewRef.current = fitView

  const runFit = () => {
    fitRafRef.current = null
    if (anchorLockedKeyRef.current === fitKey) return
    fitViewRef.current()
  }
  const scheduleFit = () => {
    if (fitRafRef.current != null) cancelAnimationFrame(fitRafRef.current)
    fitRafRef.current = requestAnimationFrame(runFit)
  }
  // 卸载清理 pending fit
  useEffect(
    () => () => {
      if (fitRafRef.current != null) cancelAnimationFrame(fitRafRef.current)
    },
    [],
  )

  // 首帧自动 fit：节点有坐标后一次 fit 到当前子图（渲染期不能调 setView，推迟到下一帧）
  const fittedRef = useRef('')
  if (fittedRef.current !== fitKey && nodes.length > 0 && nodes.some((n) => n.x != null)) {
    fittedRef.current = fitKey
    scheduleFit()
  }

  // 仿真收敛「二次校准」（Issue #34）：首帧 fit 用的是初始坐标，仿真收敛时节点坐标
  // 已漂移出首帧视口（视觉上「丢失焦点」）。收敛后若节点整体越界/大幅位移，再 fit 一次
  const settledKeyRef = useRef<string | null>(null)
  if (
    fitKey !== settledKeyRef.current &&
    nodes.length > 1 &&
    nodes.every((n) => n.x != null && n.y != null)
  ) {
    const pad = 32
    const minX = Math.min(...nodes.map((n) => n.x! - n.radius))
    const maxX = Math.max(...nodes.map((n) => n.x! + n.radius))
    const minY = Math.min(...nodes.map((n) => n.y! - n.radius))
    const maxY = Math.max(...nodes.map((n) => n.y! + n.radius))
    // 视口内节点包围盒（世界坐标）
    const vx0 = -view.tx / view.scale
    const vy0 = -view.ty / view.scale
    const vx1 = (size.w - view.tx) / view.scale
    const vy1 = (size.h - view.ty) / view.scale
    const inside = minX >= vx0 - pad && maxX <= vx1 + pad && minY >= vy0 - pad && maxY <= vy1 + pad
    if (!inside) {
      settledKeyRef.current = fitKey
      scheduleFit()
    }
  }

  // 焦点锚定（Issue #34）：布局收敛后把视图中心平移到锚点节点（不改缩放），
  // 保证「一进入视图就锁定焦点主体」——聚焦页由 CustomerGraphPage 在 onGraphReady 后传入焦点 id。
  // 锚定前先取消 pending fit 并上锁，杜绝迟到 fit 在锚定后把焦点客户挤离中心（Issue #87）
  const anchoredKeyRef = useRef<string | null>(null)
  // 锚点键带上 settleTick：每次仿真收敛（含数据变化后的重新布局）都重新把锚点居中，
  // 否则锚定只在首次生效，「我」会随着重新布局漂到视口边角（2026-10-14 修复的观感问题）
  const anchorKey = fitAnchorId ? `${fitAnchorId}#${settleTick}` : ''
  useEffect(() => {
    if (!anchorKey || anchoredKeyRef.current === anchorKey) return
    const n = nodes.find((x) => x.id === anchorKey)
    if (!n || n.x == null || n.y == null || size.w === 0) return
    anchoredKeyRef.current = anchorKey
    anchorLockedKeyRef.current = fitKey
    if (fitRafRef.current != null) {
      cancelAnimationFrame(fitRafRef.current)
      fitRafRef.current = null
    }
    const scale = view.scale
    panZoom.setView({
      scale,
      tx: size.w / 2 - n.x * scale,
      ty: size.h / 2 - n.y * scale,
    })
    // 只在锚点变化时执行：view/size 依赖变化不需要重锚
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, nodes, size.w, size.h])

  // Esc 关闭缩略卡（与 Drawer 交互习惯一致）
  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  // 平移/缩放后节点屏幕坐标已变：关闭浮层（节点坐标刷新需要重新点击，避免卡片错位悬挂）
  const viewKey = `${view.tx},${view.ty},${view.scale}`
  const lastViewKey = useRef(viewKey)
  if (lastViewKey.current !== viewKey) {
    lastViewKey.current = viewKey
    if (selectedId) setSelectedId(null)
    // 悬浮框锚在屏幕坐标上：视图一动就失准，直接收掉（与缩略卡同一口径）
    if (edgeHover) setEdgeHover(null)
  }

  const empty = graph.customers.length === 0

  return (
    <Card className="overflow-hidden p-0">
      <div
        ref={(el) => {
          wheelRef.current = el
          sizeElRef.current = el
        }}
        className="relative bg-surface-container-low/40"
        style={{ touchAction: 'none', ...style }}
        {...panZoom.containerProps}
        onPointerMove={(e) => {
          panZoom.containerProps.onPointerMove(e)
          onPointerMove(e)
        }}
        onPointerUp={() => {
          panZoom.containerProps.onPointerUp()
          onPointerUp()
        }}
        onPointerCancel={() => {
          panZoom.containerProps.onPointerCancel()
          onPointerCancel()
        }}
        onClick={() => setSelectedId(null)}
      >
        {legend}
        {empty ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon="hub"
              title="还没有可绘制的客户"
              description="先在客户管理中建档，记账或建待办时关联客户，画布会自动生长"
            />
          </div>
        ) : (
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${size.w} ${size.h}`}
            className="block cursor-grab active:cursor-grabbing"
          >
            {/* 缩放平移视口：以视口中心为锚点 */}
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
              {/* 从属边（直线） */}
              <g>
                {links
                  .filter((l) => l.kind === 'belongs')
                  .map((l, i) => {
                    const s = l.source as GraphNode
                    const t = l.target as GraphNode
                    // 坐标 0 是合法位置：用 == null 判缺失，避免原点节点边闪断
                    if (s.x == null || t.x == null) return null
                    return (
                      <line
                        key={`b${i}`}
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke={s.kind === 'customer' ? '#c3c6d7' : '#e2e8f0'}
                        strokeWidth={s.kind === 'customer' ? 1.4 : 1}
                      />
                    )
                  })}
              </g>
              {/* 关系边（客户↔客户）：二次贝塞尔曲线 + 虚线 + 语义标签（对齐原型 09 关系边隐喻） */}
              <g>
                {links
                  .filter((l) => l.kind === 'relation')
                  .map((l, i) => {
                    const s = l.source as GraphNode
                    const t = l.target as GraphNode
                    if (s.x == null || t.x == null || s.y == null || t.y == null) return null
                    const mx = (s.x + t.x) / 2
                    const my = (s.y + t.y) / 2
                    // 控制点垂直偏移，形成向上的弧线（同一对客户的弧向固定）
                    const dx = t.x - s.x
                    const dy = t.y - s.y
                    const d = Math.hypot(dx, dy) || 1
                    const cx = mx + (-dy / d) * 24
                    const cy = my + (dx / d) * 24
                    // 类别着色（Issue #34）：单类别=类别色；多类别/未归类=默认关系色
                    const cats = l.categories ?? []
                    const edgeColor =
                      cats.length === 1
                        ? (RELATION_CATEGORIES.find((c) => c.id === cats[0])?.color ??
                          GRAPH_COLORS.relation.stroke)
                        : GRAPH_COLORS.relation.stroke
                    const path = `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`
                    return (
                      <g key={`r${i}`}>
                        <path
                          d={path}
                          fill="none"
                          stroke={edgeColor}
                          strokeWidth={1.5}
                          strokeDasharray="5 4"
                          opacity={0.85}
                        />
                        {/* 命中区（2026-10-14）：连线本身只有 1.5px，光标根本压不上，
                            所以叠一条**透明加粗**的同形状 path 专门接指针事件；
                            不改 pointerdown 行为（不加 stopPropagation）→ 按在线上拖拽仍是平移画布 */}
                        <path
                          d={path}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={14}
                          style={{ cursor: 'pointer' }}
                          onPointerEnter={(e) => hoverEdgeAt(e, l)}
                          onPointerMove={(e) => hoverEdgeAt(e, l)}
                          onPointerLeave={() => setEdgeHover(null)}
                        />
                      </g>
                    )
                  })}
              </g>
              {/* 桥接弱边（客户↔客户，二跳推导）：直线 + 细虚线 + 低不透明度，弱视觉权重不抢主线（Issue #34 ①） */}
              <g>
                {links
                  .filter((l) => l.kind === 'bridge')
                  .map((l, i) => {
                    const s = l.source as GraphNode
                    const t = l.target as GraphNode
                    if (s.x == null || t.x == null || s.y == null || t.y == null) return null
                    return (
                      <g key={`br${i}`} opacity={0.6}>
                        <line
                          x1={s.x}
                          y1={s.y}
                          x2={t.x}
                          y2={t.y}
                          stroke={GRAPH_COLORS.bridge.stroke}
                          strokeWidth={1}
                          strokeDasharray="2 4"
                        />
                        {l.label && (
                          <text
                            x={(s.x + t.x) / 2}
                            y={(s.y + t.y) / 2 - 6}
                            textAnchor="middle"
                            style={{ fontSize: 9, fontWeight: 500 }}
                            fill={GRAPH_COLORS.bridge.text}
                          >
                            {l.label}
                          </text>
                        )}
                      </g>
                    )
                  })}
              </g>
              {/* 节点（客户最上层） */}
              <g>
                {[...nodes]
                  .sort((a, b) => (a.kind === 'customer' ? 1 : 0) - (b.kind === 'customer' ? 1 : 0))
                  .map((n) =>
                    n.x === undefined ? null : (
                      <g
                        key={n.id}
                        transform={`translate(${n.x},${n.y})`}
                        className={
                          n.kind === 'customer'
                            ? 'cursor-pointer'
                            : n.kind === 'self'
                              ? 'cursor-default'
                              : 'cursor-grab'
                        }
                        onPointerDown={(e) => onNodePointerDown(e, n)}
                        onClick={(e) => {
                          // 阻止冒泡到画布背景（背景单击关卡），节点自身不触发背景关闭
                          e.stopPropagation()
                          // click 在 pointerup 之后派发：拖拽过的手势不触发穿透跳转，并消费标记
                          if (draggedRef.current) {
                            draggedRef.current = false
                            return
                          }
                          // 客户节点：单击弹缩略信息卡（Issue #34），「进入档案」保留原跳转；
                          // 项目节点单击仍跳转；其余节点走双击穿透（避免误触）
                          if (n.kind === 'customer') {
                            if (selectedId === n.id) {
                              setSelectedId(null)
                              return
                            }
                            // 节点世界坐标 → 屏幕坐标（视口 = world*scale + t），浮层跟随节点
                            const r = svgRef.current?.getBoundingClientRect()
                            selectedScreenRef.current = {
                              x: (r?.left ?? 0) + n.x! * view.scale + view.tx,
                              y: (r?.top ?? 0) + n.y! * view.scale + view.ty,
                            }
                            setSelectedScreen(selectedScreenRef.current)
                            setSelectedId(n.id)
                          }
                          if (n.kind === 'project')
                            navigate(`/projects/${n.id.replace('proj:', '')}`)
                        }}
                        onDoubleClick={() => {
                          if (n.to) navigate(n.to)
                        }}
                      >
                        <circle
                          r={n.radius}
                          fill={n.fill}
                          stroke={n.color}
                          strokeWidth={n.kind === 'customer' ? 1.8 : 1.3}
                        />
                        {n.kind === 'self' ? (
                          /* 「我」自节点：主色实心 + 虚线外圈，固定画布中心、不与任何节点连线。
                             名字不再画在圈内（2026-10-14 用户裁决：最中心节点不显示名字）——
                             中心那颗实心主色圆就是「我」，靠位置与形态识别，不靠文字。 */
                          <circle
                            r={n.radius + 7}
                            fill="none"
                            stroke={GRAPH_COLORS.self.stroke}
                            strokeWidth={1.6}
                            strokeDasharray="4 3"
                            opacity={0.65}
                          />
                        ) : n.kind === 'customer' ? (
                          <>
                            {(n.id === focusId || n.id === fitAnchorId) && (
                              <circle
                                r={n.radius + 7}
                                fill="none"
                                stroke={GRAPH_COLORS.customer.stroke}
                                strokeWidth={1.6}
                                strokeDasharray="4 3"
                              />
                            )}
                            {/* 客户节点名字只渲染一处（圈外完整名）：Issue #123 去掉圈内截断名，
                                消除「同一名字画两遍」；名字本身即节点身份，无需圈内重复 */}
                            <text
                              textAnchor="middle"
                              y={n.radius + 14}
                              style={{ fontSize: 11, fontWeight: 600 }}
                              fill="#0b1c30"
                            >
                              {n.label}
                            </text>
                          </>
                        ) : (
                          <text
                            textAnchor="middle"
                            dy="3.5"
                            style={{ fontSize: 8, fontWeight: 600 }}
                            fill={n.color}
                          >
                            {n.kind === 'txn'
                              ? n.label.startsWith('+')
                                ? '¥'
                                : '支'
                              : n.kind === 'project'
                                ? '⬡'
                                : n.kind === 'note'
                                  ? '✎'
                                  : '!'}
                          </text>
                        )}
                        {n.kind !== 'customer' && n.kind !== 'self' && (
                          <text
                            textAnchor="middle"
                            y={n.radius + 12}
                            style={{ fontSize: 9 }}
                            fill="#434655"
                          >
                            {n.label}
                          </text>
                        )}
                      </g>
                    ),
                  )}
              </g>
            </g>
          </svg>
        )}

        {/* 画布浮层：关系归类筛选 chips + **数据健康告警**（2026-10-14 从页面行移入画布）。
            健康告警与常驻图例不同 —— 「出问题才出现」，回答的是「为什么一条线都没有」这个具体疑问：
            ① 一条关系都没有 → 灰；② 关系指向已删除客户（投影层过滤掉、不会画线）→ 红。
            不提示的话，「确实还没加关系」与「关系全指错了」在界面上都是「没有线」，只能靠人猜。 */}
        {showCatFilter || relationHealth.visible ? (
          <div
            className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {showCatFilter &&
              RELATION_CATEGORIES.map((c) => {
                const on = activeCats.includes(c.id)
                return (
                  <button
                    key={c.id}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.8571rem] font-medium shadow-sm backdrop-blur transition-colors ${
                      on
                        ? 'border-transparent text-white'
                        : 'border-outline-variant/40 bg-surface-container-lowest/95 text-on-surface-variant hover:bg-surface-container'
                    }`}
                    style={on ? { background: c.color } : undefined}
                    onClick={() =>
                      setActiveCats((cs) =>
                        cs.includes(c.id) ? cs.filter((x) => x !== c.id) : [...cs, c.id],
                      )
                    }
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: on ? '#fff' : c.color }}
                    />
                    {c.name}
                  </button>
                )
              })}
            {showCatFilter && activeCats.length > 0 && (
              <button
                className="rounded-full px-2 py-0.5 text-[0.8571rem] text-on-surface-variant underline-offset-2 hover:underline"
                onClick={() => setActiveCats([])}
              >
                清除
              </button>
            )}
            {relationHealth.visible && relationHealth.total === 0 && (
              <span title="到任一客户的档案 →「关系」里加一条（客户名 + 语义），画布上就会连起来">
                <Chip tone="gray" icon="info">
                  还没有客户间关系
                </Chip>
              </span>
            )}
            {relationHealth.visible && relationHealth.dangling > 0 && (
              <span title="这些关系条目指向的客户已被删除或不存在，图谱不会为它们画线。到「客户档案 → 关系」里重新关联即可">
                <Chip tone="red" icon="link_off">{`${relationHealth.dangling} 条关系指向已删除客户`}</Chip>
              </span>
            )}
          </div>
        ) : null}

        {/* 健康分图例（原亲密度，Issue #108 改名，仅 customer-only 模式启用）。
            ⚠️ 2026-10-14：节点尺寸已统一，档位只由**颜色**表达 —— 图例圆点也必须等大，
            否则「点大 = 档位高」的暗示还在，等于图例在说一件已经不成立的事（假绿）。
            标题同步由「圈层」改为「档位」：圈层指环上位置/大小分层，这里只剩颜色了 */}
        {mode === 'customer-only' && intimacyCfg && (
          <div
            className="absolute right-3 top-3 z-10 flex max-w-[240px] flex-wrap items-center justify-end gap-x-2 gap-y-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="text-[0.7143rem] font-medium uppercase tracking-wide text-outline">
              健康分档位
            </span>
            {intimacyCfg.levels.map((l) => {
              const v = INTIMACY_VISUAL[l.key]
              const hidden = l.key === 'I7' && intimacyCfg.blacklist.hideInGraph
              return (
                <span
                  key={l.key}
                  className={`inline-flex items-center gap-1 text-[0.75rem] ${hidden ? 'text-outline line-through' : 'text-on-surface-variant'}`}
                  title={hidden ? '黑名单已在图谱隐藏' : l.desc}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{
                      background: v.color,
                      opacity: hidden ? 0.35 : 0.85,
                    }}
                  />
                  {l.name}
                </span>
              )
            })}
          </div>
        )}

        {/* 左下角「重新布局」：释放全部固定点并 reheat 仿真 */}
        {!empty && showReheat && (
          <div className="absolute bottom-3 left-3 z-10" onPointerDown={(e) => e.stopPropagation()}>
            <button
              className="flex h-7 items-center gap-1 surface-card/95 px-2 text-[0.8571rem] font-medium text-on-surface-variant shadow-md backdrop-blur transition-colors hover:bg-surface-container hover:text-on-surface"
              title="释放固定点并重新计算布局"
              onClick={reheat}
            >
              <Icon name="refresh" size={14} />
              重新布局
            </button>
          </div>
        )}

        {/* 右下角缩放控件卡（对齐原型 09：−/+/百分比/适应画布） */}
        {!empty && (
          <div
            className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 surface-card-xl bg-surface-container-lowest/95 px-1.5 py-1 shadow-md backdrop-blur"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[1.1429rem] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              title="缩小"
              onClick={() => panZoom.zoomTo(view.scale - 0.1)}
            >
              −
            </button>
            <span className="w-11 text-center text-[0.8571rem] font-semibold tabular-nums text-on-surface">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              title="放大"
              onClick={() => panZoom.zoomTo(view.scale + 0.1)}
            >
              <Icon name="add" size={16} />
            </button>
            <span className="mx-1 h-4 w-px bg-outline-variant/40" />
            <button
              className="flex h-7 items-center gap-1 rounded-lg px-2 text-[0.8571rem] font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              title="重置缩放平移，显示全部节点"
              onClick={fitView}
            >
              <Icon name="settings_backup_restore" size={14} />
              适应画布
            </button>
          </div>
        )}

        {/* 关系边悬浮框（2026-10-14）：连线上的文字全部收起，关联字段改在这里给全。
            贴着光标、带安全边距（不越出画布右/下边界），pointer-events-none 不挡后续命中 */}
        {edgeInfo && edgeHover && (
          <div
            className="pointer-events-none absolute z-20 max-w-[240px] rounded-lg border border-outline-variant/40 bg-surface-container-lowest/95 px-2.5 py-1.5 shadow-lg backdrop-blur"
            style={{
              left: Math.min(edgeHover.x + 14, Math.max(0, size.w - 250)),
              top: Math.min(edgeHover.y + 14, Math.max(0, size.h - 64)),
            }}
          >
            <div className="text-[0.8571rem] font-semibold text-on-surface">
              {edgeInfo.labels.join(' / ') || '（未填语义）'}
            </div>
            {edgeInfo.categories.length > 0 && (
              <div className="mt-0.5 text-[0.7857rem] text-on-surface-variant">
                归类：{edgeInfo.categories.join(' / ')}
              </div>
            )}
          </div>
        )}

        {/* 客户缩略信息卡（Issue #34）：单击节点弹出，点空白/Esc 关闭，「进入档案」跳详情 */}
        {selectedCustomer && (
          <CustomerInfoCard
            customer={selectedCustomer}
            screen={selectedScreen}
            onEnter={() => {
              navigate(`/crm/${selectedCustomer.id}`)
              setSelectedId(null)
            }}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </Card>
  )
}

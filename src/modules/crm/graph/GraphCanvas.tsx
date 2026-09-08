import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRecord } from '@/queries/hooks'
import type { Customer } from '@/db/types'
import { Avatar, Button, Card, Chip, EmptyState } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import { IDENTITY_VIEW, usePanZoom } from '../usePanZoom'
import { useForceGraph } from './useForceGraph'
import { GRAPH_COLORS, type GraphNode } from './types'
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
  /** 是否渲染业务实体节点（项目/流水/待办/笔记）与其从属边。
   *  true=默认全景（保留现状）；false=「客户关系视图」仅展示客户节点与客户↔客户边 */
  showEntities?: boolean
}

export default function GraphCanvas({ graph, focusId, style, legend, showReheat, showEntities = true }: GraphCanvasProps) {
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const dragIdRef = useRef<string | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // 客户缩略卡（Issue #34 ②）：单击客户节点弹 HTML overlay，不画进 SVG
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { nodes, links, simRef } = useForceGraph({ graph, size, focusId })

  // 客户关系视图开关：showEntities=false 只保留客户节点与客户↔客户边（relation/bridge）
  const viewNodes = showEntities ? nodes : nodes.filter((n) => n.kind === 'customer')
  const viewLinks = showEntities ? links : links.filter((l) => l.kind !== 'belongs')
  // 卡片补全量二次订阅：CanvasGraph 裁剪投影不含 lastContactAt/decisionLevel，走 useRecord
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

  function onNodePointerDown(e: React.PointerEvent, node: GraphNode) {
    e.stopPropagation()
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

  // 「适应画布」：重置缩放平移，使全部节点落在视口内并居中（fitView 收进公共组件）
  function fitView() {
    const visible = viewNodes.filter((n) => n.x != null && n.y != null)
    if (visible.length === 0 || size.w === 0 || size.h === 0) {
      panZoom.setView(IDENTITY_VIEW)
      return
    }
    const pad = 48
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of visible) {
      minX = Math.min(minX, n.x! - n.radius)
      minY = Math.min(minY, n.y! - n.radius)
      maxX = Math.max(maxX, n.x! + n.radius)
      maxY = Math.max(maxY, n.y! + n.radius)
    }
    const bw = Math.max(maxX - minX, 1)
    const bh = Math.max(maxY - minY, 1)
    const scale = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh)
    panZoom.setView({
      scale: Math.min(2, Math.max(0.5, scale)),
      tx: size.w / 2 - ((minX + maxX) / 2) * scale,
      ty: size.h / 2 - ((minY + maxY) / 2) * scale,
    })
  }

  function reheat() {
    nodes.forEach((n) => {
      n.fx = null
      n.fy = null
    })
    simRef.current?.alpha(0.6).restart()
  }

  // 聚焦模式自动 fit：布局稳定后一次 fit 到当前子图（requestAnimationFrame 等首帧坐标）
  const fittedRef = useRef('')
  const fitKey = `${focusId ?? 'all'}-${viewNodes.length}-${showEntities ? 'e' : 'c'}`
  if (fittedRef.current !== fitKey && viewNodes.length > 0 && viewNodes.some((n) => n.x != null)) {
    fittedRef.current = fitKey
    // 渲染期不能调 setView（会与 panZoom 内部状态竞争），推迟到下一帧
    requestAnimationFrame(fitView)
  }

  const empty = graph.customers.length === 0

  // 客户缩略卡锚点：取选中客户节点世界坐标 → 容器像素（= svg 用户坐标，viewBox=size 1:1）
  const selectedNode = selectedId ? viewNodes.find((n) => n.id === selectedId && n.kind === 'customer') : undefined
  let cardStyle: React.CSSProperties | undefined
  if (selectedNode && selectedNode.x != null && selectedNode.y != null) {
    // 卡片置于节点上方偏右，超出容器时反向贴近边缘（clamp）
    const px = view.tx + selectedNode.x * view.scale + 20
    const py = view.ty + selectedNode.y * view.scale - 20
    const CARD_W = 240
    const left = Math.min(Math.max(8, px), Math.max(8, size.w - CARD_W - 8))
    // 估高约 150，超出底部则翻到上方
    let top = Math.max(8, py - 150)
    if (top + 190 > size.h && size.h > 0) top = Math.max(8, view.ty + selectedNode.y * view.scale + 34)
    cardStyle = { left, top }
  }

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
          <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`} className="block cursor-grab active:cursor-grabbing">
            {/* 缩放平移视口：以视口中心为锚点 */}
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
              {/* 从属边（直线） */}
              <g>
                {viewLinks
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
                {viewLinks
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
                    return (
                      <g key={`r${i}`}>
                        <path
                          d={`M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`}
                          fill="none"
                          stroke={GRAPH_COLORS.relation.stroke}
                          strokeWidth={1.5}
                          strokeDasharray="5 4"
                          opacity={0.85}
                        />
                        <text
                          x={cx + ((cx - mx) / 24) * 10}
                          y={cy + ((cy - my) / 24) * 10}
                          textAnchor="middle"
                          style={{ fontSize: 10, fontWeight: 700 }}
                          fill={GRAPH_COLORS.relation.text}
                        >
                          {l.label}
                        </text>
                      </g>
                    )
                  })}
              </g>
              {/* 桥接弱边（客户↔客户，二跳推导）：直线 + 细虚线 + 低不透明度，弱视觉权重不抢主线（Issue #34 ①） */}
              <g>
                {viewLinks
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
                {[...viewNodes]
                  .sort((a, b) => (a.kind === 'customer' ? 1 : 0) - (b.kind === 'customer' ? 1 : 0))
                  .map((n) =>
                    n.x === undefined ? null : (
                      <g
                        key={n.id}
                        transform={`translate(${n.x},${n.y})`}
                        className={n.kind === 'customer' ? 'cursor-pointer' : 'cursor-grab'}
                        onPointerDown={(e) => onNodePointerDown(e, n)}
                        onClick={(e) => {
                          // 阻止冒泡到画布背景（背景单击关卡），节点自身不触发背景关闭
                          e.stopPropagation()
                          // click 在 pointerup 之后派发：拖拽过的手势不触发穿透跳转，并消费标记
                          if (draggedRef.current) {
                            draggedRef.current = false
                            return
                          }
                          // 客户节点单击弹缩略卡（HTML overlay，②统一弹卡不跳转）；项目节点单击仍直达项目
                          if (n.kind === 'customer') {
                            // 再次单击已选中客户 = 关闭卡片
                            setSelectedId((cur) => (cur === n.id ? null : n.id))
                          } else if (n.kind === 'project') {
                            navigate(`/projects/${n.id.replace('proj:', '')}`)
                          }
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
                        {n.kind === 'customer' ? (
                          <>
                            {n.id === focusId && (
                              <circle r={n.radius + 7} fill="none" stroke={GRAPH_COLORS.customer.stroke} strokeWidth={1.6} strokeDasharray="4 3" />
                            )}
                            <text textAnchor="middle" dy="4" style={{ fontSize: 11, fontWeight: 700 }} fill={GRAPH_COLORS.customer.text}>
                              {n.label.slice(0, 4)}
                            </text>
                            <text textAnchor="middle" y={n.radius + 14} style={{ fontSize: 11, fontWeight: 600 }} fill="#0b1c30">
                              {n.label}
                            </text>
                          </>
                        ) : (
                          <text textAnchor="middle" dy="3.5" style={{ fontSize: 8, fontWeight: 600 }} fill={n.color}>
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
                        {n.kind !== 'customer' && (
                          <text textAnchor="middle" y={n.radius + 12} style={{ fontSize: 9 }} fill="#434655">
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

        {/* 左下角「重新布局」：释放全部固定点并 reheat 仿真 */}
        {!empty && showReheat && (
          <div
            className="absolute bottom-3 left-3 z-10"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="flex h-7 items-center gap-1 rounded-lg border border-outline-variant/40 bg-surface-container-lowest/95 px-2 text-[12px] font-medium text-on-surface-variant shadow-md backdrop-blur transition-colors hover:bg-surface-container hover:text-on-surface"
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
            className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest/95 px-1.5 py-1 shadow-md backdrop-blur"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[16px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              title="缩小"
              onClick={() => panZoom.zoomTo(view.scale - 0.1)}
            >
              −
            </button>
            <span className="w-11 text-center text-[12px] font-semibold tabular-nums text-on-surface">
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
              className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              title="重置缩放平移，显示全部节点"
              onClick={fitView}
            >
              <Icon name="settings_backup_restore" size={14} />
              适应画布
            </button>
          </div>
        )}

        {/* 客户缩略卡（② 统一弹卡）：HTML overlay + 屏幕坐标，不画进 SVG；数据走 useRecord 二次订阅补全量 */}
        {selectedNode && selectedCustomer && cardStyle && (
          <div
            className="absolute z-20 w-60 rounded-xl border border-outline-variant/40 bg-surface-container-lowest/95 p-3 shadow-xl backdrop-blur"
            style={cardStyle}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              title="关闭"
              onClick={() => setSelectedId(null)}
            >
              <Icon name="close" size={15} />
            </button>
            <div className="flex items-center gap-2.5">
              <Avatar name={selectedCustomer.name} size={34} />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-bold text-on-surface">{selectedCustomer.name}</div>
                {selectedCustomer.company && (
                  <div className="truncate text-[11px] text-on-surface-variant">{selectedCustomer.company}</div>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip tone={selectedCustomer.tier === 'S' ? 'red' : selectedCustomer.tier === 'A' ? 'blue' : 'gray'}>{`Tier ${selectedCustomer.tier}`}</Chip>
              <Chip tone="gray">{selectedCustomer.decisionLevel}</Chip>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-on-surface-variant">
              <span>健康分</span>
              <span className="text-right font-semibold tabular-nums">{selectedCustomer.healthScore}</span>
              <span>最近联系</span>
              <span className="text-right font-medium tabular-nums">
                {selectedCustomer.lastContactAt ? new Date(selectedCustomer.lastContactAt).toLocaleDateString('zh-CN') : '—'}
              </span>
            </div>
            <div className="mt-3 flex gap-1.5">
              <Button size="sm" variant="tonal" icon="person" className="flex-1 justify-center" onClick={() => navigate(`/crm/${selectedCustomer.id}`)}>
                进入档案
              </Button>
              <Button size="sm" variant="ghost" icon="hub" className="flex-1 justify-center" onClick={() => navigate(`/crm/${selectedCustomer.id}/graph`)}>
                图谱
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}


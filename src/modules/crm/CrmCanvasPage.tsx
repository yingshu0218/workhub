import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force'
import { Button, Card, Chip, EmptyState, PageHeader } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import { useCanvasGraph } from './hooks'

/**
 * 关系画布（对齐原型 09-crm-canvas）
 * d3-force 力导向：节点=客户（大）/交易（中）/待办（小），边=customerId 关联
 * 拖拽用原生 pointer events（d3-force 包不含 d3-drag），拖拽中固定 fx/fy，松手释放恢复物理
 */

interface CanvasNode extends SimulationNodeDatum {
  id: string
  kind: 'customer' | 'txn' | 'todo' | 'note'
  label: string
  color: string
  fill: string
  radius: number
  /** 双击穿透目标路由（交易/待办/笔记节点） */
  to?: string
}

interface CanvasLink {
  source: string | CanvasNode
  target: string | CanvasNode
}

const COLORS = {
  customer: { stroke: '#004ac6', fill: '#dbe1ff', text: '#004ac6' },
  income: { stroke: '#006c49', fill: '#6cf8bb', text: '#006c49' },
  expense: { stroke: '#ba1a1a', fill: '#ffdad6', text: '#ba1a1a' },
  todo: { stroke: '#943700', fill: '#ffede6', text: '#943700' },
  note: { stroke: '#4a4458', fill: '#e8def8', text: '#4a4458' },
}

const fmtMoney = (n: number) => `¥${n.toLocaleString('zh-CN')}`

const SCALE_MIN = 0.5
const SCALE_MAX = 2
const clampScale = (s: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, s))

/** 视图变换：scale 缩放 + tx/ty 平移（SVG 用户坐标 → 屏幕坐标 = world * scale + t） */
interface ViewState {
  scale: number
  tx: number
  ty: number
}
const IDENTITY_VIEW: ViewState = { scale: 1, tx: 0, ty: 0 }

export default function CrmCanvasPage() {
  const graph = useCanvasGraph()
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<Simulation<CanvasNode, undefined> | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<ViewState>(IDENTITY_VIEW)
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [links, setLinks] = useState<CanvasLink[]>([])

  // 画布容器尺寸自适应（容器高 calc(100vh-14rem)）
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 数据变化（或容器尺寸首次就绪）时重建图与仿真
  useEffect(() => {
    if (size.w === 0 || size.h === 0 || graph.customers.length === 0) return
    const ns: CanvasNode[] = []
    const ls: CanvasLink[] = []
    for (const c of graph.customers) {
      ns.push({
        id: c.id,
        kind: 'customer',
        label: c.name,
        color: COLORS.customer.stroke,
        fill: COLORS.customer.fill,
        radius: 24,
      })
    }
    for (const t of graph.transactions) {
      ns.push({
        id: `txn:${t.id}`,
        kind: 'txn',
        label: `${t.type === 'income' ? '+' : '-'}${fmtMoney(t.amount)}`,
        color: t.type === 'income' ? COLORS.income.stroke : COLORS.expense.stroke,
        fill: t.type === 'income' ? COLORS.income.fill : COLORS.expense.fill,
        radius: 12,
      })
      ls.push({ source: t.customerId, target: `txn:${t.id}` })
    }
    for (const t of graph.todos) {
      ns.push({
        id: `todo:${t.id}`,
        kind: 'todo',
        label: t.title.length > 8 ? `${t.title.slice(0, 8)}…` : t.title,
        color: COLORS.todo.stroke,
        fill: COLORS.todo.fill,
        radius: 9,
      })
      ls.push({ source: t.customerId, target: `todo:${t.id}` })
    }
    // 笔记节点：mentions 反查关联客户的笔记投影（数据来自 useCanvasGraph）
    for (const n of graph.notes) {
      ns.push({
        id: `note:${n.id}`,
        kind: 'note',
        to: `/notes/${n.id}`,
        label: n.title.length > 8 ? `${n.title.slice(0, 8)}…` : n.title,
        color: COLORS.note.stroke,
        fill: COLORS.note.fill,
        radius: 7,
      })
      ls.push({ source: n.customerId, target: `note:${n.id}` })
    }
    // 随机初始位置打散，避免同批节点重叠抖动
    ns.forEach((n, i) => {
      n.x = size.w / 2 + Math.cos(i * 2.4) * 120
      n.y = size.h / 2 + Math.sin(i * 2.4) * 90
    })
    const sim = forceSimulation<CanvasNode>(ns)
      .force(
        'link',
        forceLink<CanvasNode, CanvasLink>(ls)
          .id((d) => d.id)
          .distance((l) => (l.source as CanvasNode).kind === 'customer' || (l.target as CanvasNode).kind === 'customer' ? 90 : 70)
          .strength(0.4),
      )
      .force('charge', forceManyBody().strength(-320))
      .force('center', forceCenter(size.w / 2, size.h / 2))
      .force('collide', forceCollide<CanvasNode>().radius((d) => d.radius + 14))
      .alphaDecay(0.03)
    sim.on('tick', () => {
      setNodes([...ns])
      setLinks([...ls])
    })
    simRef.current = sim
    setNodes(ns)
    setLinks(ls)
    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [graph, size.w, size.h])

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

  // ===== 缩放（以视口中心为锚点：缩放前后中心指向的世界点不动）=====
  function zoomTo(next: number) {
    const s = clampScale(next)
    setView((v) => {
      const k = s / v.scale
      return {
        scale: s,
        tx: size.w / 2 - (size.w / 2 - v.tx) * k,
        ty: size.h / 2 - (size.h / 2 - v.ty) * k,
      }
    })
  }

  // 「适应画布」：重置缩放平移，使全部节点落在视口内并居中
  function fitView() {
    const visible = nodes.filter((n) => n.x != null && n.y != null)
    if (visible.length === 0 || size.w === 0 || size.h === 0) {
      setView(IDENTITY_VIEW)
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
    const scale = clampScale(Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh))
    setView({
      scale,
      tx: size.w / 2 - ((minX + maxX) / 2) * scale,
      ty: size.h / 2 - ((minY + maxY) / 2) * scale,
    })
  }

  // 滚轮缩放：trackpad 捏合（ctrl+wheel）与普通滚轮都生效；preventDefault 阻止页面滚动
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        const s = clampScale(v.scale * Math.exp(-e.deltaY * 0.002))
        const k = s / v.scale
        return {
          scale: s,
          tx: size.w / 2 - (size.w / 2 - v.tx) * k,
          ty: size.h / 2 - (size.h / 2 - v.ty) * k,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [size.w, size.h])

  // 背景空白处按下拖拽 = 平移画布（节点 onPointerDown 已 stopPropagation，不会误入此分支）
  function onBackgroundPointerDown(e: React.PointerEvent) {
    panStartRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
  }

  function onNodePointerDown(e: React.PointerEvent, node: CanvasNode) {
    e.stopPropagation()
    e.preventDefault()
    dragIdRef.current = node.id
    pointerStartRef.current = { x: e.clientX, y: e.clientY }
    draggedRef.current = false
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    // 背景平移优先：未按住节点时拖动视口
    const pan = panStartRef.current
    if (!dragIdRef.current && pan) {
      setView((v) => ({ ...v, tx: pan.tx + (e.clientX - pan.x), ty: pan.ty + (e.clientY - pan.y) }))
      return
    }
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
    panStartRef.current = null
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

  function reheat() {
    nodes.forEach((n) => {
      n.fx = null
      n.fy = null
    })
    simRef.current?.alpha(0.6).restart()
  }

  const empty = graph.customers.length === 0

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户关系画布"
        subtitle="力导向关系图 · 拖拽节点体验物理弹簧，点击客户节点穿透至档案"
        actions={
          <>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
              返回客户列表
            </Button>
            <Button variant="tonal" icon="refresh" onClick={reheat} disabled={empty}>
              重新布局
            </Button>
          </>
        }
      />

      {/* 图例 + 节点统计 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip tone="blue" icon="person">{`客户 ${graph.customers.length}`}</Chip>
        <Chip tone="green" icon="payments">{`交易 ${graph.transactions.length}`}</Chip>
        <Chip tone="amber" icon="task_alt">{`待办 ${graph.todos.length}`}</Chip>
        <Chip tone="gray" icon="description">{`笔记 ${graph.notes.length}`}</Chip>
        <span className="ml-2 text-[11px] text-outline">
          单击客户节点跳转 · 双击交易/待办/笔记节点穿透 · 按住拖拽 · 滚轮缩放 · 空白处拖拽平移
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <div
          ref={wrapRef}
          className="relative bg-surface-container-low/40"
          style={{ height: 'calc(100vh - 14rem)', minHeight: 320, touchAction: 'none' }}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
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
              {/* 边 */}
              <g>
                {links.map((l, i) => {
                  const s = l.source as CanvasNode
                  const t = l.target as CanvasNode
                  // 坐标 0 是合法位置：用 == null 判缺失，避免原点节点边闪断
                  if (s.x == null || t.x == null) return null
                  return (
                    <line
                      key={i}
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
              {/* 节点（客户最上层） */}
              <g>
                {[...nodes]
                  .sort((a, b) => (a.kind === 'customer' ? 1 : 0) - (b.kind === 'customer' ? 1 : 0))
                  .map((n) =>
                    n.x === undefined ? null : (
                      <g
                        key={n.id}
                        transform={`translate(${n.x},${n.y})`}
                        className={n.kind === 'customer' ? 'cursor-pointer' : 'cursor-grab'}
                        onPointerDown={(e) => onNodePointerDown(e, n)}
                        onClick={() => {
                          // click 在 pointerup 之后派发：拖拽过的手势不触发穿透跳转，并消费标记
                          if (draggedRef.current) {
                            draggedRef.current = false
                            return
                          }
                          // 客户节点单击即跳转；其余节点走双击穿透（避免误触）
                          if (n.kind === 'customer') navigate(`/crm/${n.id}`)
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
                            <text textAnchor="middle" dy="4" style={{ fontSize: 11, fontWeight: 700 }} fill={COLORS.customer.text}>
                              {n.label.slice(0, 4)}
                            </text>
                            <text textAnchor="middle" y={n.radius + 14} style={{ fontSize: 11, fontWeight: 600 }} fill="#0b1c30">
                              {n.label}
                            </text>
                          </>
                        ) : (
                          <text textAnchor="middle" dy="3.5" style={{ fontSize: 8, fontWeight: 600 }} fill={n.color}>
                            {n.kind === 'txn' ? (n.label.startsWith('+') ? '¥' : '支') : n.kind === 'note' ? '✎' : '!'}
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

          {/* 右下角缩放控件卡（对齐原型 09：−/+/百分比/适应画布） */}
          {!empty && (
            <div
              className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest/95 px-1.5 py-1 shadow-md backdrop-blur"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[16px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                title="缩小"
                onClick={() => zoomTo(view.scale - 0.1)}
              >
                −
              </button>
              <span className="w-11 text-center text-[12px] font-semibold tabular-nums text-on-surface">
                {Math.round(view.scale * 100)}%
              </span>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                title="放大"
                onClick={() => zoomTo(view.scale + 0.1)}
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
        </div>
      </Card>
    </div>
  )
}

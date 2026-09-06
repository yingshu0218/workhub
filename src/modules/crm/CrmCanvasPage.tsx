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
import { useCanvasGraph } from './hooks'

/**
 * 关系画布（对齐原型 09-crm-canvas）
 * d3-force 力导向：节点=客户（大）/交易（中）/待办（小），边=customerId 关联
 * 拖拽用原生 pointer events（d3-force 包不含 d3-drag），拖拽中固定 fx/fy，松手释放恢复物理
 */

interface CanvasNode extends SimulationNodeDatum {
  id: string
  kind: 'customer' | 'txn' | 'todo'
  label: string
  color: string
  fill: string
  radius: number
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
}

const fmtMoney = (n: number) => `¥${n.toLocaleString('zh-CN')}`

export default function CrmCanvasPage() {
  const graph = useCanvasGraph()
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<Simulation<CanvasNode, undefined> | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
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

  function onNodePointerDown(e: React.PointerEvent, node: CanvasNode) {
    e.stopPropagation()
    e.preventDefault()
    dragIdRef.current = node.id
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    const id = dragIdRef.current
    if (!id) return
    const p = toSvgPoint(e.clientX, e.clientY)
    if (!p) return
    const node = nodes.find((n) => n.id === id)
    if (!node) return
    node.fx = Math.max(node.radius, Math.min(size.w - node.radius, p.x))
    node.fy = Math.max(node.radius, Math.min(size.h - node.radius, p.y))
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
        <span className="ml-2 text-[11px] text-outline">按住节点拖拽 · 松手后物理布局自动恢复</span>
      </div>

      <Card className="overflow-hidden p-0">
        <div
          ref={wrapRef}
          className="relative bg-surface-container-low/40"
          style={{ height: 'calc(100vh - 14rem)', minHeight: 320 }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
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
              {/* 边 */}
              <g>
                {links.map((l, i) => {
                  const s = l.source as CanvasNode
                  const t = l.target as CanvasNode
                  if (!s.x || !t.x) return null
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
                          if (n.kind === 'customer' && !dragIdRef.current) navigate(`/crm/${n.id}`)
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
                            {n.kind === 'txn' ? (n.label.startsWith('+') ? '¥' : '支') : '!'}
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
            </svg>
          )}
        </div>
      </Card>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import dayjs from 'dayjs'
import { useNavigate, useParams } from 'react-router-dom'
import { useRecord } from '@/queries/hooks'
import type { Customer } from '@/db/types'
import { Button, Card, EmptyState, PageHeader } from '@/design-system/ui'
import { usePanZoom, IDENTITY_VIEW } from '@/shared/usePanZoom'
import CustomerFormDrawer from './CustomerFormDrawer'
import { healthColor } from './shared'
import {
  TIMELINE_FILTERS,
  filterTimeline,
  fmtMoney,
  fmtTimelineTime,
  type TimelineEvent,
  type TimelineFilter,
  useCustomerTimeline,
} from './timeline'

/**
 * 客户时间线鱼骨视图（Issue #11 需求 2，P2）
 * 路由 /crm/:id/timeline：聚焦单个客户的持续跟踪，鱼骨图呈现。
 * 鱼头（右）= 客户当前状态卡；主轴 = 建档至今的水平时间轴；
 * 上骨刺 = 正向事件（收入/完成待办/手写沟通），下骨刺 = 支出流水。
 * 数据源复用 useCustomerTimeline 投影 hook，与详情页展示永远一致。
 * 渲染沿用 CrmCanvasPage 的纯 SVG + 自研 view 变换模式（usePanZoom），零新依赖。
 */

const COLORS = {
  income: { stroke: '#006c49', fill: '#6cf8bb' },
  expense: { stroke: '#ba1a1a', fill: '#ffdad6' },
  todo: { stroke: '#943700', fill: '#ffede6' },
  interaction: { stroke: '#004ac6', fill: '#dbe1ff' },
}

/** 骨刺方向：上骨 = 正向事件，下骨 = 支出；手写沟通放上方近轴短刺 */
function boneSide(e: TimelineEvent): 'up' | 'down' {
  if (e.kind === 'transaction' && e.direction === 'expense') return 'down'
  return 'up'
}

export default function CustomerTimelinePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const customer = useRecord<Customer>('customers', id)
  const timeline = useCustomerTimeline(id)
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [editing, setEditing] = useState(false)

  const { wrapRef, size, view, setView, zoomTo, panStart, panMove, panEnd, panCancel } = usePanZoom()

  const visible = useMemo(() => filterTimeline(timeline, filter), [timeline, filter])

  // 主轴世界坐标：左端 = 建档时间，右端 = max(现在, 最新事件)
  const axis = useMemo(() => {
    const start = customer?.createdAt ?? Date.now()
    const latest = visible.length > 0 ? visible[0].at : start
    return { start, end: Math.max(Date.now(), latest) }
  }, [customer, visible])

  // 时间 → 世界 x 坐标（主轴固定 80px 边距 + 1000px 长，由 panZoom 负责缩放平移适配视口）
  const AXIS_X0 = 80
  const AXIS_X1 = 1080
  const toX = (at: number) => {
    const span = Math.max(axis.end - axis.start, 1)
    return AXIS_X0 + ((at - axis.start) / span) * (AXIS_X1 - AXIS_X0)
  }

  if (!customer) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <PageHeader title="客户时间线" actions={<Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>返回列表</Button>} />
        <Card className="p-6">
          <EmptyState icon="person_off" title="客户不存在或已删除" description="可能已被移除，返回列表查看其他客户" />
        </Card>
      </div>
    )
  }

  const hc = healthColor(customer.healthScore)

  // 世界坐标下的鱼骨几何：主轴 y=0，向上为负、向下为正（屏幕 y 向下）
  const SPINE_Y = 0
  const HEAD_X = AXIS_X1 + 90 // 鱼头中心
  const TAIL_X = AXIS_X0 - 90 // 鱼尾尖

  // 骨刺长度分层：同侧多条刺错开，避免标签互相遮挡
  const boneUp: TimelineEvent[] = []
  const boneDown: TimelineEvent[] = []
  for (const e of visible) (boneSide(e) === 'up' ? boneUp : boneDown).push(e)

  const spike = (e: TimelineEvent, i: number, side: 'up' | 'down') => {
    const x = toX(e.at)
    const dir = side === 'up' ? -1 : 1
    const len = 64 + (i % 3) * 30
    const tipY = SPINE_Y + dir * len
    return { e, x, tipY, dir }
  }
  const spikesUp = boneUp.map((e, i) => spike(e, i, 'up'))
  const spikesDown = boneDown.map((e, i) => spike(e, i, 'down'))

  const empty = timeline.length === 0

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户时间线"
        subtitle="鱼骨视图聚焦单个客户的持续跟踪 · 上骨正向事件 / 下骨支出 · 滚轮缩放、拖拽平移"
        actions={
          <>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate(`/crm/${id}`)}>
              返回档案
            </Button>
            <Button icon="edit" onClick={() => setEditing(true)}>
              编辑档案
            </Button>
          </>
        }
      />

      {/* 图例 + 过滤 chips（与详情页同一套 TimelineFilter） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TIMELINE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
              filter === f.key
                ? 'border-primary bg-primary-fixed font-semibold text-primary'
                : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-2 text-[11px] text-outline">
          悬停骨刺查看详情 · 点击跳转对应记录 · 滚轮缩放 · 空白处拖拽平移
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <div
          ref={wrapRef}
          className="relative bg-surface-container-low/40"
          style={{ height: 'calc(100vh - 14rem)', minHeight: 360, touchAction: 'none' }}
          onPointerDown={panStart}
          onPointerMove={(e) => panMove(e)}
          onPointerUp={panEnd}
          onPointerCancel={panCancel}
        >
          {empty ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon="timeline"
                title="还没有可绘制的事件"
                description="手写沟通日志、记账关联客户、关联待办都会自动投影到这条时间线上"
              />
            </div>
          ) : (
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${size.w} ${size.h}`}
              className="block cursor-grab active:cursor-grabbing"
            >
              {/* 缩放平移视口（初始 translate 让鱼骨整体垂直居中） */}
              <g transform={`translate(${view.tx},${view.ty + size.h / 2}) scale(${view.scale})`}>
                {/* ===== 主轴（脊椎）===== */}
                <line
                  x1={TAIL_X}
                  y1={SPINE_Y}
                  x2={AXIS_X1}
                  y2={SPINE_Y}
                  stroke="#0b1c30"
                  strokeWidth={3}
                  strokeLinecap="round"
                />

                {/* ===== 鱼尾（建档起点）===== */}
                <path
                  d={`M ${AXIS_X0} ${SPINE_Y} L ${TAIL_X} ${SPINE_Y - 26} L ${TAIL_X + 40} ${SPINE_Y} L ${TAIL_X} ${SPINE_Y + 26} Z`}
                  fill="#dbe1ff"
                  stroke="#004ac6"
                  strokeWidth={1.5}
                />
                <text x={TAIL_X + 6} y={SPINE_Y - 34} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600 }} fill="#004ac6">
                  建档 {fmtTimelineTime(axis.start).slice(0, 10)}
                </text>

                {/* ===== 鱼头（当前状态）===== */}
                <g>
                  <ellipse cx={HEAD_X} cy={SPINE_Y} rx={72} ry={54} fill="#dbe1ff" stroke="#004ac6" strokeWidth={1.8} />
                  <text x={HEAD_X} y={SPINE_Y - 22} textAnchor="middle" style={{ fontSize: 14, fontWeight: 700 }} fill="#0b1c30">
                    {customer.name.slice(0, 6)}
                  </text>
                  <text x={HEAD_X} y={SPINE_Y - 2} textAnchor="middle" style={{ fontSize: 11 }} fill="#434655">
                    {customer.stage}
                  </text>
                  <text x={HEAD_X} y={SPINE_Y + 16} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700 }} fill={hc}>
                    健康 {customer.healthScore}
                  </text>
                  <text x={HEAD_X} y={SPINE_Y + 34} textAnchor="middle" style={{ fontSize: 10 }} fill="#434655">
                    {customer.tier === '潜在' ? '潜在客户' : `${customer.tier} 层`}
                  </text>
                </g>

                {/* ===== 主轴刻度（按跨度取 6 档）===== */}
                {Array.from({ length: 7 }, (_, i) => {
                  const t = axis.start + ((axis.end - axis.start) * i) / 6
                  const x = toX(t)
                  return (
                    <g key={i}>
                      <line x1={x} y1={SPINE_Y - 5} x2={x} y2={SPINE_Y + 5} stroke="#434655" strokeWidth={1} />
                      <text x={x} y={SPINE_Y + 22} textAnchor="middle" style={{ fontSize: 10 }} fill="#434655">
                        {fmtTick(t)}
                      </text>
                    </g>
                  )
                })}

                {/* ===== 骨刺：上骨（正向）===== */}
                {spikesUp.map(({ e, x, tipY }) => (
                  <Spike key={e.id} e={e} x={x} tipY={tipY} />
                ))}
                {/* ===== 骨刺：下骨（支出）===== */}
                {spikesDown.map(({ e, x, tipY }) => (
                  <Spike key={e.id} e={e} x={x} tipY={tipY} />
                ))}
              </g>
            </svg>
          )}

          {/* 右下角缩放控件（与画布一致） */}
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
                title="重置缩放平移"
                onClick={() => setView(IDENTITY_VIEW)}
              >
                <Icon name="settings_backup_restore" size={14} />
                复位
              </button>
            </div>
          )}
        </div>
      </Card>

      <CustomerFormDrawer open={editing} customer={customer} onClose={() => setEditing(false)} />
    </div>
  )
}

/** 主轴刻度格式：跨度内相邻刻度间隔决定精度 */
function fmtTick(at: number): string {
  return dayjs(at).format('YYYY-MM-DD')
}

/** 单根骨刺：斜刺 + 末端事件节点 + hover 浮层 + 点击跳转 */
function Spike({ e, x, tipY }: { e: TimelineEvent; x: number; tipY: number }) {
  const navigate = useNavigate()
  const up = tipY < 0
  const color = spikeColor(e)
  const fill = spikeFill(e)

  const label =
    e.kind === 'transaction'
      ? `${e.direction === 'income' ? '+' : '-'}${fmtMoney(e.amount)}`
      : e.kind === 'todo'
        ? `${e.event === 'done' ? '✓ ' : ''}${e.title.slice(0, 10)}`
        : e.type

  const target =
    e.kind === 'transaction' ? '/finance' : e.kind === 'todo' ? '/todo' : undefined

  return (
    <g
      className="cursor-pointer"
      onClick={(ev) => {
        ev.stopPropagation()
        if (target) navigate(target)
      }}
    >
      {/* 斜刺 */}
      <line x1={x} y1={0} x2={x + 14} y2={tipY} stroke={color} strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />
      {/* 事件节点 */}
      <circle cx={x + 14} cy={tipY} r={5} fill={fill} stroke={color} strokeWidth={1.4} />
      {/* 标签 */}
      <text
        x={x + 14}
        y={tipY + (up ? -10 : 16)}
        textAnchor="middle"
        style={{ fontSize: 10, fontWeight: 600 }}
        fill={color}
      >
        {label}
      </text>
      {/* hover 浮层：rect + 双行文本（SVG 原生 title 之外的自绘实现，保证样式统一） */}
      <g className="opacity-0 transition-opacity hover:opacity-100">
        <rect
          x={x + 14 - 90}
          y={up ? tipY - 58 : tipY + 24}
          width={180}
          height={34}
          rx={8}
          fill="#0b1c30"
          opacity={0.92}
        />
        <text
          x={x + 14}
          y={up ? tipY - 44 : tipY + 38}
          textAnchor="middle"
          style={{ fontSize: 10, fontWeight: 600 }}
          fill="#ffffff"
        >
          {spikeTitle(e).slice(0, 26)}
        </text>
        <text
          x={x + 14}
          y={up ? tipY - 31 : tipY + 51}
          textAnchor="middle"
          style={{ fontSize: 9 }}
          fill="#dbe1ff"
        >
          {fmtTimelineTime(e.at)}
        </text>
      </g>
    </g>
  )
}

function spikeColor(e: TimelineEvent): string {
  if (e.kind === 'transaction') return e.direction === 'income' ? COLORS.income.stroke : COLORS.expense.stroke
  if (e.kind === 'todo') return COLORS.todo.stroke
  return COLORS.interaction.stroke
}

function spikeFill(e: TimelineEvent): string {
  if (e.kind === 'transaction') return e.direction === 'income' ? COLORS.income.fill : COLORS.expense.fill
  if (e.kind === 'todo') return COLORS.todo.fill
  return COLORS.interaction.fill
}

function spikeTitle(e: TimelineEvent): string {
  if (e.kind === 'transaction') return e.summary
  if (e.kind === 'todo') return `${e.event === 'done' ? '完成待办' : '新增待办'} · ${e.title}`
  return `【${e.type}】${e.content}`
}

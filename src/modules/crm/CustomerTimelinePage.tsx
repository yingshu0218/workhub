import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRecord } from '@/queries/hooks'
import type { Customer, Interaction } from '@/db/types'
import { Button, Card, Chip, EmptyState, PageHeader } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import dayjs from 'dayjs'
import {
  TIMELINE_FILTERS,
  filterTimeline,
  type TimelineFilter,
  useCustomerTimeline,
} from './timeline'
import {
  boneTarget,
  HEAD_H as HEAD_H_SHARED,
  HEAD_W as HEAD_W_SHARED,
  layoutSingleBones,
  SPINE_Y as SPINE_Y_SHARED,
  type Bone,
} from './timelineLayout'
import { IDENTITY_VIEW, usePanZoom } from './usePanZoom'

/**
 * 客户时间线鱼骨视图（Issue #11 需求 2，对齐原型「鱼骨图」隐喻）
 *
 * 结构：鱼头（右）= 客户当前状态卡（tier 徽章 + 健康分档位），
 *       主轴 = 建档至今的水平时间轴，骨刺向上下分叉：
 *       上骨刺 = 收入流水 / 完成待办（正向），下骨刺 = 支出流水 / 逾期待办、新增待办、沟通（负向）
 * 数据源单源消费 useCustomerTimeline（与详情页共用同一投影，保证口径一致）。
 * 复用共享 usePanZoom：wheel 缩放 + 空白处拖拽平移（与关系画布一致），纯 SVG 零新依赖。
 */

/** 沟通日志类型 → 图标（与详情页手写日志样式一致） */
const TYPE_ICONS: Record<Interaction['type'], string> = {
  电话: 'call',
  会议: 'groups',
  邮件: 'mail',
  拜访: 'directions_walk',
  跟进: 'trending_up',
  小结: 'summarize',
  其他: 'more_horiz',
}

/** 世界坐标布局常量（水平从左到右按时间递增，鱼头在最右） */
// 世界坐标布局常量：从 timelineLayout 纯函数模块导入（与全部视图共用形态）
const SPINE_Y = SPINE_Y_SHARED
const HEAD_W = HEAD_W_SHARED
const HEAD_H = HEAD_H_SHARED
const SPINE_STROKE = '#004ac6'
const SPINE_W = 5

export default function CustomerTimelinePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const customer = useRecord<Customer>('customers', id)
  const timeline = useCustomerTimeline(id)

  const [filter, setFilter] = useState<TimelineFilter>('all')
  const visible = filterTimeline(timeline, filter)
  const counts = {
    interaction: timeline.filter((e) => e.kind === 'interaction').length,
    transaction: timeline.filter((e) => e.kind === 'transaction').length,
    todo: timeline.filter((e) => e.kind === 'todo').length,
  }

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<Bone | null>(null)
  // 拖拽保护：从骨刺上按住平移画布后松手，click 不触发穿透跳转（与关系画布 draggedRef 同口径）
  const draggedRef = useRef(false)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  // 骨刺 g 的 onPointerDown 已 stopPropagation，背景任意位置按下即平移
  const panZoom = usePanZoom({ size })
  const view = panZoom.view
  const { wheelRef } = panZoom

  // 容器尺寸自适应；ref 复用 panZoom.wheelRef（wheel 原生监听与 ResizeObserver 同一元素）
  useEffect(() => {
    const el = wheelRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [wheelRef])


  /** 世界布局：时间升序排到主轴（左 → 右），上下交替错开骨刺避免重叠（纯函数在 timelineLayout） */
  const layout = useMemo(() => {
    if (!customer || visible.length === 0) return null
    const { bones, maxX } = layoutSingleBones(visible)
    const world = { minX: 0, maxX, minY: -190, maxY: 190 }
    return { bones, world }
  }, [customer, visible])

  function fitView() {
    if (!layout || size.w === 0 || size.h === 0) {
      panZoom.setView(IDENTITY_VIEW)
      return
    }
    const pad = 40
    const bw = Math.max(layout.world.maxX - layout.world.minX, 1)
    const bh = Math.max(layout.world.maxY - layout.world.minY, 1)
    const scale = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh)
    const cx = (layout.world.minX + layout.world.maxX) / 2
    const cy = (layout.world.minY + layout.world.maxY) / 2
    panZoom.setView({
      scale: Math.min(2, Math.max(0.5, scale)),
      tx: size.w / 2 - cx * scale,
      ty: size.h / 2 - cy * scale,
    })
  }

  if (!customer) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          title="客户时间线"
          actions={
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
              返回列表
            </Button>
          }
        />
        <Card className="p-6">
          <EmptyState
            icon="person_off"
            title="客户不存在或已删除"
            description="可能已被移除，返回列表查看其他客户"
          />
        </Card>
      </div>
    )
  }

  const spineX1 = 40
  const spineX2 = layout ? layout.world.maxX - HEAD_W - 8 : 600
  const headX = layout ? layout.world.maxX - HEAD_W : 640

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="客户时间线"
        subtitle={`${customer.name} · 建档至今的沟通、财务与事件全息鱼骨视图，单源投影与详情页一致`}
        actions={
          <>
            <Button
              variant="ghost"
              icon="arrow_back"
              onClick={() => navigate(`/crm/${customer.id}`)}
            >
              返回档案
            </Button>
            <Button variant="tonal" icon="timeline" onClick={() => navigate('/crm/timeline-all')}>
              查看全部时间线 →
            </Button>
            <Button
              variant="ghost"
              icon="settings_backup_restore"
              onClick={fitView}
              disabled={!layout}
            >
              适应画布
            </Button>
          </>
        }
      />

      {/* 过滤 chips：与详情页「深度跟进与沟通日志」同一组常量 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TIMELINE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-2.5 py-0.5 text-[0.7857rem] transition-colors ${
              filter === f.key
                ? 'border-primary bg-primary-fixed font-semibold text-primary'
                : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {f.label}
            {f.key !== 'all' ? ` ${counts[f.key as keyof typeof counts]}` : ''}
          </button>
        ))}
        <span className="ml-2 text-[0.7857rem] text-outline">
          滚轮缩放 · 空白处拖拽平移 · 点击骨刺穿透对应记录
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <div
          ref={wheelRef}
          className="relative bg-surface-container-low/40"
          style={{ height: 'calc(100vh - 16rem)', minHeight: 380, touchAction: 'none' }}
          {...panZoom.containerProps}
        >
          {!layout ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon="timeline"
                title="暂无时间线数据"
                description="该客户还没有沟通日志、关联流水或待办事件；先在详情页「快速记一笔」开始跟进"
              />
            </div>
          ) : (
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${size.w} ${size.h}`}
              className="block cursor-grab active:cursor-grabbing"
            >
              <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
                {/* 主轴：建档至今 */}
                <line
                  x1={spineX1}
                  y1={SPINE_Y}
                  x2={spineX2}
                  y2={SPINE_Y}
                  stroke={SPINE_STROKE}
                  strokeWidth={SPINE_W}
                  strokeLinecap="round"
                />
                {/* 主轴起止刻度 */}
                <text
                  x={spineX1}
                  y={SPINE_Y + 22}
                  style={{ fontSize: 11, fontWeight: 600 }}
                  fill="#434655"
                >
                  建档 {dayjs(customer.createdAt).format('YYYY-MM-DD')}
                </text>
                <text
                  x={spineX2}
                  y={SPINE_Y - 14}
                  textAnchor="end"
                  style={{ fontSize: 11, fontWeight: 600 }}
                  fill="#434655"
                >
                  至今
                </text>

                {/* 骨刺 */}
                {layout.bones.map((b) => {
                  const target = boneTarget(b.event)
                  return (
                    <g
                      key={b.event.id}
                      className={target ? 'cursor-pointer' : ''}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        draggedRef.current = false
                        pointerStartRef.current = { x: e.clientX, y: e.clientY }
                      }}
                      onPointerMove={(e) => {
                        const start = pointerStartRef.current
                        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
                          draggedRef.current = true
                        }
                      }}
                      onPointerUp={() => {
                        pointerStartRef.current = null
                      }}
                      onPointerCancel={() => {
                        pointerStartRef.current = null
                      }}
                      onClick={() => {
                        if (draggedRef.current) {
                          draggedRef.current = false
                          return
                        }
                        if (target) navigate(target)
                      }}
                      onMouseEnter={() => setHover(b)}
                      onMouseLeave={() => setHover((h) => (h === b ? null : h))}
                    >
                      <line
                        x1={b.x}
                        y1={SPINE_Y}
                        x2={b.x + 18}
                        y2={b.tipY}
                        stroke={b.color}
                        strokeWidth={hover === b ? 2.4 : 1.6}
                      />
                      {/* 端点短横 + 节点圆 */}
                      <line
                        x1={b.x + 18}
                        y1={b.tipY}
                        x2={b.x + 40}
                        y2={b.tipY}
                        stroke={b.color}
                        strokeWidth={hover === b ? 2.4 : 1.6}
                      />
                      <circle
                        cx={b.x}
                        cy={SPINE_Y}
                        r={5}
                        fill={b.fill}
                        stroke={b.color}
                        strokeWidth={1.4}
                      />
                      {/* 端点标签（金额/类型） */}
                      <text
                        x={b.x + 44}
                        y={b.tipY + (b.up ? 0 : 10)}
                        style={{ fontSize: 11, fontWeight: 700 }}
                        fill={b.color}
                      >
                        {b.label}
                      </text>
                    </g>
                  )
                })}

                {/* 鱼头：客户当前状态卡（局部坐标 0..HEAD_W × 0..HEAD_H，鱼嘴贴主轴） */}
                <g transform={`translate(${headX},${SPINE_Y - HEAD_H / 2})`}>
                  {/* 鱼形轮廓：左上/左下尖角指向鱼嘴（衔接主轴），右侧圆钝 */}
                  <path
                    d={`M0,${HEAD_H / 2} L20,0 L${HEAD_W},0 L${HEAD_W},${HEAD_H} L20,${HEAD_H} Z`}
                    transform={`translate(0,${-HEAD_H / 2})`}
                    fill="#dbe1ff"
                    stroke="#004ac6"
                    strokeWidth={1.8}
                  />
                  {/* 头像圆 + 姓名 + 阶段 */}
                  <circle
                    cx={34}
                    cy={HEAD_H / 2 - 34}
                    r={15}
                    fill="#dbe1ff"
                    stroke="#004ac6"
                    strokeWidth={1.4}
                  />
                  <text
                    x={34}
                    y={HEAD_H / 2 - 29}
                    textAnchor="middle"
                    style={{ fontSize: 13, fontWeight: 700 }}
                    fill="#004ac6"
                  >
                    {customer.name.slice(0, 1)}
                  </text>
                  <text
                    x={58}
                    y={HEAD_H / 2 - 38}
                    style={{ fontSize: 13, fontWeight: 700 }}
                    fill="#0b1c30"
                  >
                    {customer.name.slice(0, 6)}
                  </text>
                  {/* tier 徽章 */}
                  <g transform={`translate(20,${HEAD_H / 2 - 10})`}>
                    <rect rx={9} width={52} height={18} fill={tierFill(customer.tier)} />
                    <text
                      x={26}
                      y={13}
                      textAnchor="middle"
                      style={{ fontSize: 10, fontWeight: 700 }}
                      fill="#fff"
                    >
                      {customer.tier === '潜在' ? '潜在' : `${customer.tier} 层`}
                    </text>
                  </g>
                  {/* 健康分档位（原健康指数环移除，Issue #108）：显示手动档位或「未设置」 */}
                  <g transform={`translate(${HEAD_W - 66},${HEAD_H / 2 - 40})`}>
                    <rect rx={9} width={56} height={18} fill={customer.intimacy?.level ? '#dbe1ff' : '#eceef4'} />
                    <text
                      x={28}
                      y={13}
                      textAnchor="middle"
                      style={{ fontSize: 10, fontWeight: 700 }}
                      fill={customer.intimacy?.level ? '#004ac6' : '#434655'}
                    >
                      {customer.intimacy?.level ?? '未设置'}
                    </text>
                  </g>
                  <text x={20} y={HEAD_H - 26} style={{ fontSize: 9 }} fill="#434655">
                    {customer.company ? customer.company.slice(0, 12) : '独立顾问'}
                  </text>
                  <text x={20} y={HEAD_H - 12} style={{ fontSize: 9 }} fill="#434655">
                    最近联系 {fmtLastContact(customer.lastContactAt)}
                  </text>
                </g>
              </g>
            </svg>
          )}

          {/* hover 浮层摘要 */}
          {hover && (
            <div
              className="pointer-events-none absolute z-10 max-w-[280px] surface-card-xl bg-surface-container-lowest/95 px-3 py-2 shadow-md backdrop-blur"
              style={{ left: 16, bottom: 16 }}
            >
              <div className="flex items-center gap-1.5">
                <Chip
                  tone={
                    hover.event.kind === 'transaction'
                      ? hover.event.direction === 'income'
                        ? 'green'
                        : 'red'
                      : hover.event.kind === 'todo'
                        ? hover.event.status === 'done'
                          ? 'green'
                          : 'amber'
                        : 'blue'
                  }
                  icon={
                    hover.event.kind === 'interaction' ? TYPE_ICONS[hover.event.type] : undefined
                  }
                >
                  {hover.label}
                </Chip>
                {hover.event.kind === 'todo' && (
                  <Chip
                    tone={
                      hover.event.priority === 'P1'
                        ? 'red'
                        : hover.event.priority === 'P2'
                          ? 'amber'
                          : 'gray'
                    }
                  >
                    {hover.event.priority}
                  </Chip>
                )}
                {hover.event.kind === 'transaction' && hover.event.status === '待对账' && (
                  <Chip tone="gray">待对账</Chip>
                )}
              </div>
              <div className="mt-1 text-[0.8571rem] leading-relaxed text-on-surface">{hover.sub}</div>
              {boneTarget(hover.event) && (
                <div className="mt-1 flex items-center gap-1 text-[0.7857rem] text-primary">
                  <Icon name="arrow_back" size={12} className="rotate-180" />
                  点击骨刺穿透
                </div>
              )}
            </div>
          )}

          {/* 右下角缩放控件（与画布页一致） */}
          {layout && (
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
                title="重置缩放平移，显示全部鱼骨"
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

function tierFill(tier: 'S' | 'A' | 'B' | '潜在'): string {
  switch (tier) {
    case 'S':
      return '#ba1a1a'
    case 'A':
      return '#943700'
    case '潜在':
      return '#004ac6'
    default:
      return '#4a4458'
  }
}

function fmtLastContact(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days <= 0) return '今天'
  if (days < 30) return `${days} 天前`
  return dayjs(ts).format('YYYY-MM-DD')
}


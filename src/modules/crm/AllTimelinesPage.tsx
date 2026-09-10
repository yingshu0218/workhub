import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import type { Customer } from '@/db/types'
import { Button, Card, Chip, EmptyState, PageHeader } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import dayjs from 'dayjs'
import { TIMELINE_FILTERS, filterTimeline, type TimelineFilter, useAllTimelines } from './timeline'
import { SPINE_Y, boneTarget, laneColor, layoutLanedBones, type Bone } from './timelineLayout'
import { IDENTITY_VIEW, usePanZoom } from './usePanZoom'

/**
 * 全部客户时间线鱼骨（/crm/timeline-all，Issue #22 需求 ④）
 * 单源消费 useAllTimelines（与单客户鱼骨共用同一套三源合并代码，口径不漂移）；
 * 布局：共享时间轴主轴 + 按客户分带（lane），骨刺标注客户名（分带主题色）；
 * 点骨刺穿透对应记录；支持按客户筛选；页头可返回 CRM 列表
 */

export default function AllTimelinesPage() {
  const navigate = useNavigate()
  const customers = useCollection<Customer>('customers')
  const allEvents = useAllTimelines()

  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [customerFilter, setCustomerFilter] = useState<string>('all')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<Bone | null>(null)
  // 拖拽保护（与单客户鱼骨同口径）：拖拽平移后松手不触发穿透
  const draggedRef = useRef(false)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const panZoom = usePanZoom({ size })
  const view = panZoom.view
  const { wheelRef } = panZoom

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

  const active = customers.filter((c) => !c.deleted)
  const customerById = useMemo(() => new Map(active.map((c) => [c.id, c])), [active])

  // 有事件的客户才占分带（稳定排序：按客户名）
  const eventCustomers = useMemo(() => {
    const ids = new Set(allEvents.map((e) => e.customerId))
    return active.filter((c) => ids.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [allEvents, active])

  const laneMap = useMemo(() => new Map(eventCustomers.map((c, i) => [c.id, i])), [eventCustomers])

  const visible = useMemo(() => {
    let evs = filterTimeline(allEvents, filter)
    if (customerFilter !== 'all') evs = evs.filter((e) => e.customerId === customerFilter)
    return evs
  }, [allEvents, filter, customerFilter])

  // 筛选下只保留命中的客户分带，重新压缩 lane
  const shownCustomers = useMemo(
    () =>
      customerFilter === 'all'
        ? eventCustomers
        : eventCustomers.filter((c) => c.id === customerFilter),
    [eventCustomers, customerFilter],
  )
  const shownLaneMap = useMemo(
    () => new Map(shownCustomers.map((c, i) => [c.id, i])),
    [shownCustomers],
  )

  const layout = useMemo(() => {
    if (visible.length === 0 || shownCustomers.length === 0) return null
    return layoutLanedBones(
      visible,
      shownCustomers.map((c) => c.id),
      shownLaneMap,
    )
  }, [visible, shownCustomers, shownLaneMap])

  function fitView() {
    if (!layout || size.w === 0 || size.h === 0) {
      panZoom.setView(IDENTITY_VIEW)
      return
    }
    const pad = 40
    const bw = Math.max(layout.maxX - 0, 1)
    const bh = Math.max(layout.maxY - layout.minY, 1)
    const scale = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh)
    const cx = layout.maxX / 2
    const cy = (layout.minY + layout.maxY) / 2
    panZoom.setView({
      scale: Math.min(2, Math.max(0.5, scale)),
      tx: size.w / 2 - cx * scale,
      ty: size.h / 2 - cy * scale,
    })
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="全部客户时间线"
        subtitle="所有客户的沟通、财务与事件按时间统一排骨刺，按客户分带展示；与单客户鱼骨同一投影口径"
        actions={
          <>
            <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/crm')}>
              返回列表
            </Button>
            <Button
              variant="tonal"
              icon="settings_backup_restore"
              onClick={fitView}
              disabled={!layout}
            >
              适应画布
            </Button>
          </>
        }
      />

      {/* 过滤 chips：与单客户鱼骨同一组常量 + 客户筛选 */}
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
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-outline-variant/40" />
        <button
          onClick={() => setCustomerFilter('all')}
          className={`rounded-full border px-2.5 py-0.5 text-[0.7857rem] transition-colors ${
            customerFilter === 'all'
              ? 'border-primary bg-primary-fixed font-semibold text-primary'
              : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
          }`}
        >
          全部客户
        </button>
        {eventCustomers.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setCustomerFilter(customerFilter === c.id ? 'all' : c.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.7857rem] transition-colors ${
              customerFilter === c.id
                ? 'border-primary bg-primary-fixed font-semibold text-primary'
                : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: laneColor(laneMap.get(c.id) ?? i) }}
            />
            {c.name}
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
                description="还没有任何客户的沟通日志、关联流水或待办事件；先进入客户详情页「快速记一笔」"
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
                {/* 共享主轴 */}
                <line
                  x1={40}
                  y1={SPINE_Y}
                  x2={layout.maxX - 20}
                  y2={SPINE_Y}
                  stroke="#004ac6"
                  strokeWidth={5}
                  strokeLinecap="round"
                />
                <text
                  x={40}
                  y={SPINE_Y - 14}
                  style={{ fontSize: 11, fontWeight: 600 }}
                  fill="#434655"
                >
                  {visible.length > 0
                    ? dayjs(Math.min(...visible.map((e) => e.at))).format('YYYY-MM-DD')
                    : ''}
                </text>
                <text
                  x={layout.maxX - 20}
                  y={SPINE_Y - 14}
                  textAnchor="end"
                  style={{ fontSize: 11, fontWeight: 600 }}
                  fill="#434655"
                >
                  {visible.length > 0
                    ? dayjs(Math.max(...visible.map((e) => e.at))).format('YYYY-MM-DD')
                    : '至今'}
                </text>

                {/* 客户分带底色 + 带名 */}
                {shownCustomers.map((c, i) => {
                  const laneY = i * 96
                  return (
                    <g key={c.id}>
                      <rect
                        x={0}
                        y={laneY - 34}
                        width={layout.maxX}
                        height={96}
                        fill={laneColor(i)}
                        opacity={0.045}
                        rx={10}
                      />
                      <text
                        x={46}
                        y={laneY + 52}
                        style={{ fontSize: 11, fontWeight: 700 }}
                        fill={laneColor(i)}
                      >
                        {c.name}
                      </text>
                      <line
                        x1={0}
                        y1={laneY + 14}
                        x2={layout.maxX}
                        y2={laneY + 14}
                        stroke={laneColor(i)}
                        strokeWidth={1.2}
                        strokeDasharray="2 5"
                        opacity={0.5}
                      />
                    </g>
                  )
                })}

                {/* 骨刺（分带内锚定带中心线） */}
                {layout.bones.map((b) => {
                  const target = boneTarget(b.event)
                  const cid = b.event.customerId ?? ''
                  const laneY = (shownLaneMap.get(cid) ?? 0) * 96
                  const baseY = SPINE_Y + laneY + 14
                  const customer = customerById.get(cid)
                  return (
                    <g
                      key={`${cid}-${b.event.id}`}
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
                        y1={baseY}
                        x2={b.x + 14}
                        y2={baseY + (b.up ? -b.len : b.len)}
                        stroke={b.color}
                        strokeWidth={hover === b ? 2.4 : 1.5}
                      />
                      <line
                        x1={b.x + 14}
                        y1={baseY + (b.up ? -b.len : b.len)}
                        x2={b.x + 34}
                        y2={baseY + (b.up ? -b.len : b.len)}
                        stroke={b.color}
                        strokeWidth={hover === b ? 2.4 : 1.5}
                      />
                      <circle
                        cx={b.x}
                        cy={baseY}
                        r={4.5}
                        fill={b.fill}
                        stroke={b.color}
                        strokeWidth={1.3}
                      />
                      <text
                        x={b.x + 38}
                        y={baseY + (b.up ? -b.len : b.len) + 4}
                        style={{ fontSize: 10.5, fontWeight: 700 }}
                        fill={b.color}
                      >
                        {b.label}
                      </text>
                      {/* 骨刺旁客户名标注 */}
                      <text
                        x={b.x + 38}
                        y={baseY + (b.up ? -b.len : b.len) + 15}
                        style={{ fontSize: 9 }}
                        fill={customer ? laneColor(shownLaneMap.get(cid) ?? 0) : '#434655'}
                      >
                        {customer?.name ?? ''}
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
          )}

          {/* hover 浮层摘要（与单客户鱼骨同构） */}
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
                >
                  {hover.label}
                </Chip>
                {hover.event.customerId && customerById.get(hover.event.customerId) && (
                  <Chip tone="gray" icon="person">
                    {customerById.get(hover.event.customerId)!.name}
                  </Chip>
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

          {/* 右下角缩放控件（与单客户鱼骨一致） */}
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
                title="重置缩放平移"
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

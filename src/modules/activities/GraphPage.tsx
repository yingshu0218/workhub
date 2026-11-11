import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import EntityPicker from './EntityPicker'
import { usePersonalQuery, type Value } from '@/queries/personal'
import { Button, Card, PageHeader, inputCls } from '@/design-system/ui'
import { useForceGraph } from '@/modules/crm/graph/useForceGraph'
import { CANVAS_THEMES, useCanvasTheme, type CanvasThemePref } from '@/modules/crm/graph/themes'
import { usePanZoom } from '@/modules/crm/usePanZoom'
import { computeFitView } from '@/modules/crm/graph/fitView'
import type { GraphNode, GraphLink } from '@/modules/crm/graph/types'
import type { CanvasGraph } from '@/modules/crm/hooks'
import { moneyLabel, recordPath } from '@/shared/records'
const EMPTY: CanvasGraph = {
  customers: [],
  projects: [],
  transactions: [],
  todos: [],
  notes: [],
  interactions: [],
  projectStatuses: {},
}
const SEMANTIC: Record<string, string> = {
  explicit_relationship: '明确关系',
  event_participation: '事件参与',
  financial_association: '财务关联',
  commitment_source: '承诺来源',
  membership: '集合归属',
  record_association: '记录关联',
}
export default function GraphPage() {
  const { id: legacyId } = useParams(),
    [params, setParams] = useSearchParams(),
    table = params.get('table') || (legacyId ? 'customers' : 'activities'),
    id = params.get('id') || legacyId || ''
  const [eventSearch, setEventSearch] = useState('')
  const recent = usePersonalQuery(
    'search_activities',
    { q: eventSearch, sourceType: 'activity', limit: 10 },
    table === 'activities',
  )
  const candidates: Value[] = (recent.data?.items || []).map((r) => r.record as Value)
  const input: Value = { table, id, depth: table === 'projects' ? 2 : 1 }
  for (const key of ['from', 'to']) if (params.get(key)) input[key] = params.get(key)
  const query = usePersonalQuery('query_graph', input, !!id),
    [selected, setSelected] = useState<Value>()
  const visibleNodes = (query.data?.items || []).filter(
    (n) => table !== 'customers' || n.table === 'customers',
  )
  const nodeKeys = new Set(visibleNodes.map((n) => String(n.key))),
    edgeRows = ((query.data?.edges || []) as Value[]).filter(
      (e) =>
        nodeKeys.has(String(e.from)) &&
        nodeKeys.has(String(e.to)) &&
        (table !== 'customers' || e.semantic === 'explicit_relationship'),
    )
  function change(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key === 'table') next.delete('id')
    setSelected(undefined)
    setParams(next)
  }
  useEffect(() => setSelected(undefined), [query.data])
  const { theme, pref, setPref } = useCanvasTheme()
  const prepared = useMemo(() => {
    const source = (query.data?.items || []).filter(
        (n) => table !== 'customers' || n.table === 'customers',
      ),
      seen = new Set<string>()
    const nodes: GraphNode[] = source
      .filter((n) => {
        const key = String(n.key)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 100)
      .map((n) => {
        const kind: GraphNode['kind'] =
          n.table === 'activities'
            ? 'activity'
            : n.table === 'customers'
              ? 'customer'
              : n.table === 'projects'
                ? 'project'
                : n.table === 'transactions'
                  ? 'txn'
                  : n.table === 'todos'
                    ? 'todo'
                    : 'note'
        const slot =
          kind === 'activity'
            ? 'project'
            : kind === 'txn'
              ? n.type === 'income'
                ? 'income'
                : 'expense'
              : kind
        return {
          id: String(n.key),
          kind,
          label:
            (n.table === 'transactions' ? moneyLabel(n.amountMinor, n.currency) + ' ' : '') +
            String(n.title || n.name || n.summary || n.id),
          to: String(n.path || recordPath(String(n.table), n.id)),
          slot,
          color: '',
          fill: '',
          radius: kind === 'activity' ? 21 : kind === 'customer' ? 18 : 13,
        }
      })
    const links: GraphLink[] = ((query.data?.edges || []) as Value[])
      .filter(
        (e) =>
          seen.has(String(e.from)) &&
          seen.has(String(e.to)) &&
          (table !== 'customers' || e.semantic === 'explicit_relationship'),
      )
      .slice(0, 200)
      .map((e) => ({
        source: String(e.from),
        target: String(e.to),
        kind: e.semantic === 'explicit_relationship' ? 'relation' : 'belongs',
        label: String(e.label || SEMANTIC[String(e.semantic)] || '关联'),
      }))
    return { nodes, links }
  }, [query.data, table])
  const [size, setSize] = useState({ w: 900, h: 480 }),
    wrap = useRef<HTMLDivElement | null>(null)
  const pan = usePanZoom({ size })
  const { nodes, links, simRef } = useForceGraph({
    graph: EMPTY,
    prepared,
    size,
    focusId: table + ':' + id,
  })
  useEffect(() => {
    if (!wrap.current) return
    const observer = new ResizeObserver((entries) =>
      setSize({ w: Math.round(entries[0].contentRect.width), h: 480 }),
    )
    observer.observe(wrap.current)
    return () => observer.disconnect()
  }, [])
  const drag = useRef<{
    node: GraphNode
    x: number
    y: number
    startX: number
    startY: number
    moved: boolean
  }>()
  const fit = () => pan.setView(computeFitView(nodes, size) || { scale: 1, tx: 0, ty: 0 })
  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <PageHeader
        title="事实图谱"
        actions={
          <Button variant="ghost" onClick={query.reload}>
            刷新
          </Button>
        }
      />
      <Card className="grid gap-3 p-4 sm:grid-cols-4">
        <label>
          模式
          <select
            className={inputCls}
            value={table}
            onChange={(e) => change('table', e.target.value)}
          >
            <option value="customers">联系人关系</option>
            <option value="activities">事件关联</option>
            <option value="projects">事项进展</option>
            {!['customers', 'projects', 'activities'].includes(table) ? (
              <option value={table}>关联对象</option>
            ) : null}
          </select>
        </label>
        {table === 'customers' || table === 'projects' ? (
          <EntityPicker
            table={table}
            label="聚焦对象"
            value={id}
            onChange={(v) => change('id', v)}
          />
        ) : (
          <label>
            聚焦事件
            <input
              className={inputCls}
              value={eventSearch}
              placeholder="按主题搜索事件"
              onChange={(e) => setEventSearch(e.target.value)}
            />
            <select
              aria-label="选择事件"
              className={inputCls}
              value={id}
              onChange={(e) => change('id', e.target.value)}
            >
              <option value="">选择事件</option>
              {id && !candidates.some((n) => n.id === id) ? (
                <option value={id}>
                  {String(query.data?.items.find((n) => n.id === id)?.title || '当前事件')}
                </option>
              ) : null}
              {candidates.map((n) => (
                <option key={String(n.id)} value={String(n.id)}>
                  {String(n.title)}
                </option>
              ))}
            </select>
          </label>
        )}
        {['from', 'to'].map((key, i) => (
          <label key={key}>
            {i ? '结束日期' : '开始日期'}
            <input
              className={inputCls}
              type="date"
              value={params.get(key) || ''}
              onChange={(e) => change(key, e.target.value)}
            />
          </label>
        ))}
      </Card>
      <p className="text-sm text-outline">
        聚焦{table === 'projects' ? '两跳' : '一跳'} ·
        最多100节点、200边。共同参与事件不表示长期关系。
      </p>
      {query.error ? <p role="alert">{query.error}</p> : null}
      {!id ? <p>请选择联系人、事件或事项；也可从时间线和记录详情打开同一对象。</p> : null}
      {query.data?.truncated ? (
        <p role="status">范围已截断，请聚焦下列节点或缩小日期范围。</p>
      ) : null}
      <Card className="overflow-hidden">
        <div
          ref={(el) => {
            wrap.current = el
            pan.wheelRef.current = el
          }}
          {...pan.containerProps}
          style={{ height: 480, touchAction: 'none', background: theme.bg }}
        >
          <svg
            viewBox={`0 0 ${size.w} ${size.h}`}
            width="100%"
            height="100%"
            aria-label="事实关系图"
          >
            <g transform={`translate(${pan.view.tx},${pan.view.ty}) scale(${pan.view.scale})`}>
              {(query.data ? links : []).map((edge, i) => {
                const a = edge.source as GraphNode,
                  b = edge.target as GraphNode
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={theme.relation.stroke}
                    strokeDasharray={edge.kind === 'relation' ? '5 4' : undefined}
                    strokeWidth={2}
                    onClick={() => setSelected(edgeRows[i])}
                  >
                    <title>{edge.label}</title>
                  </line>
                )
              })}
              {(query.data ? nodes : []).map((node) => (
                <g
                  key={node.id}
                  transform={`translate(${node.x || 0},${node.y || 0})`}
                  role="button"
                  tabIndex={0}
                  aria-label={node.label}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      setSelected(visibleNodes.find((n) => n.key === node.id))
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    drag.current = {
                      node,
                      x: e.clientX,
                      y: e.clientY,
                      startX: e.clientX,
                      startY: e.clientY,
                      moved: false,
                    }
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current
                    if (!d) return
                    d.moved ||= Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4
                    d.node.fx = (node.x || 0) + (e.clientX - d.x) / pan.view.scale
                    d.node.fy = (node.y || 0) + (e.clientY - d.y) / pan.view.scale
                    d.x = e.clientX
                    d.y = e.clientY
                    simRef.current?.alpha(0.4).restart()
                  }}
                  onPointerUp={() => {
                    if (drag.current) {
                      drag.current.node.fx = null
                      drag.current.node.fy = null
                    }
                  }}
                  onPointerCancel={() => {
                    if (drag.current) {
                      drag.current.node.fx = null
                      drag.current.node.fy = null
                      drag.current = undefined
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!drag.current?.moved)
                      setSelected(visibleNodes.find((n) => n.key === node.id))
                    drag.current = undefined
                  }}
                >
                  <circle
                    r={node.radius}
                    fill={
                      'fill' in theme[node.slot]
                        ? (theme[node.slot] as { fill: string }).fill
                        : 'transparent'
                    }
                    stroke={theme[node.slot].stroke}
                  />
                  <text
                    textAnchor="middle"
                    y={node.radius + 16}
                    fill={theme.label}
                    style={{ fontSize: 12 }}
                  >
                    {node.label.slice(0, 22)}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>
        <div className="flex flex-wrap gap-3 p-3">
          <label>
            画布配色
            <select
              className={inputCls}
              value={pref}
              onChange={(e) => setPref(e.target.value as CanvasThemePref)}
            >
              <option value="auto">跟随外观</option>
              {Object.values(CANVAS_THEMES).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" onClick={fit}>
            适应画布
          </Button>
          <Button variant="ghost" onClick={() => pan.zoomTo(pan.view.scale * 1.2)}>
            放大
          </Button>
          <Button variant="ghost" onClick={() => pan.zoomTo(pan.view.scale / 1.2)}>
            缩小
          </Button>
        </div>
      </Card>
      {query.data && !nodes.length ? <p>该范围没有可绘制的事实关系。</p> : null}
      {query.data && selected ? (
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">
            {String(
              selected.label ||
                selected.name ||
                selected.title ||
                SEMANTIC[String(selected.semantic)] ||
                '关联证据',
            )}
          </h2>
          {selected.table ? (
            <>
              <Link className="text-primary" to={String(selected.path || '/timeline')}>
                打开对象
              </Link>
              {selected.table === 'activities' ? (
                <Link
                  className="ml-4 text-primary"
                  to={'/timeline?focus=' + encodeURIComponent(String(selected.id))}
                >
                  在时间线定位
                </Link>
              ) : null}
              {selected.amountMinor !== undefined ? (
                <p>{moneyLabel(selected.amountMinor, selected.currency)}</p>
              ) : null}
            </>
          ) : (
            <>
              <p>{SEMANTIC[String(selected.semantic)]}</p>
              {(selected.evidence as Value)?.path ? (
                <Link className="text-primary" to={String((selected.evidence as Value).path)}>
                  查看来源事件与依据
                </Link>
              ) : (
                <p>历史录入或未记录来源，不能据此推断其他关系。</p>
              )}
            </>
          )}
        </Card>
      ) : null}
      <details open>
        <summary className="cursor-pointer font-semibold">节点与关系列表（键盘可用）</summary>
        <ul className="grid gap-2 py-3 sm:grid-cols-2">
          {visibleNodes.map((node) => (
            <li key={String(node.key)}>
              <button
                className="text-primary"
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.set('table', String(node.table))
                  next.set('id', String(node.id))
                  setParams(next)
                }}
              >
                {String(node.title || node.name || node.summary || node.id)}
              </button>{' '}
              ·{' '}
              <Link className="underline" to={String(node.path || '/timeline')}>
                详情
              </Link>
            </li>
          ))}
        </ul>
        <ul className="space-y-2">
          {edgeRows.map((edge) => (
            <li key={String(edge.id)}>
              <button className="text-primary" onClick={() => setSelected(edge)}>
                {String(edge.label || SEMANTIC[String(edge.semantic)])} · {String(edge.from)} →{' '}
                {String(edge.to)}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import dayjs from 'dayjs'
import { Icon } from '@/design-system/Icon'
import { Button } from '@/design-system/ui'
import { useCollection } from '@/queries/hooks'
import { useIntimacyConfig } from '@/modules/crm/intimacy'
import { useCustomerScoreRows } from '@/modules/crm/hooks'
import { resolveHealthScoreDisplay } from '@/modules/crm/healthScore'
import { todoStatusLabel } from '@/modules/todo/domain'
import type { Customer, Ledger, Project, Todo } from '@/db/types'

/**
 * 实体悬浮摘要卡（Issue #140）：
 * 从笔记页 NoteEditorPage 的 hoverCard（Issue #50 点击弹卡）抽出为共享原子件，
 * 笔记与记账（多关联芯片 hover）共用同一份摘要口径，避免两套逻辑漂移。
 *
 * 交互（Issue #140 需求）：鼠标 hover 触发（150ms 延时防扫过误弹），移出/Esc/点外部关闭；
 * 摘要内容一律走 React 文本节点渲染（用户自由文本不得进 HTML，禁 dangerouslySetInnerHTML）。
 *
 * 定位：绝对定位于触发元素的父容器（跟随 anchor 坐标），由调用方传 anchor {x, y}。
 */

export type EntityHoverType = 'customer' | 'todo' | 'ledger' | 'project'

export interface EntityAnchor {
  /** 弹卡锚点（通常为触发元素的 getBoundingClientRect 右下角） */
  x: number
  y: number
}

/** hover 状态：触发者 id（type+eid）+ 锚点；同 id 重复 hover 不重置弹卡 */
export interface EntityHoverState {
  type: EntityHoverType
  eid: string
  label: string
  anchor: EntityAnchor
}

/** hover 触发 Hook：150ms 延时开启、离开即关（供 EntityLinkField 与笔记侧复用） */
export function useEntityHover(onOpen: (state: EntityHoverState) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  function onEnter(state: EntityHoverState) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onOpen(state), 150)
  }
  function onLeave() {
    clearTimeout(timer.current)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return { onEnter, onLeave }
}

/** Esc / 点外部关闭（打开期间挂 document 监听） */
function useDismiss(open: boolean, close: () => void, cardRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, cardRef])
}

function CardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-[0.7857rem] text-outline">{label}</span>
      <span className="min-w-0 truncate text-right text-[0.8571rem] text-on-surface">{value}</span>
    </div>
  )
}

function EntityMissing({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[0.8571rem] text-outline">
      <Icon name="person_off" size={14} />
      原{name}已删除或不存在
    </div>
  )
}

const TYPE_NAME: Record<EntityHoverType, string> = {
  customer: '客户',
  todo: '待办',
  ledger: '账本',
  project: '项目',
}

/**
 * 实体悬浮摘要卡。
 * 数据由组件内自取（useCollection liveQuery，与页面同源），调用方只给 {type, eid, anchor}。
 * 摘要字段口径与笔记 MentionEntitySummary 一致：客户=公司/职位/健康分，待办=状态/优先级/截止，
 * 账本=币种/期初/封账，项目=状态/挂靠客户。
 */
export function EntityHoverCard({
  state,
  onClose,
  onOpenDetail,
}: {
  state: EntityHoverState
  onClose: () => void
  /** 「打开详情」跳转回调（缺省不显示跳转按钮） */
  onOpenDetail?: (type: EntityHoverType, eid: string) => void
}) {
  const customers = useCollection<Customer>('customers')
  const todos = useCollection<Todo>('todos')
  const ledgers = useCollection<Ledger>('ledgers')
  const projects = useCollection<Project>('projects')
  const intimacyCfg = useIntimacyConfig()
  const scoreRows = useCustomerScoreRows(
    state.type === 'customer' ? [state.eid] : [],
  )
  const cardRef = useRef<HTMLDivElement>(null)
  useDismiss(true, onClose, cardRef)

  const customer = state.type === 'customer' ? customers.find((c) => c.id === state.eid) : undefined
  const todo = state.type === 'todo' ? todos.find((t) => t.id === state.eid) : undefined
  const ledger = state.type === 'ledger' ? ledgers.find((l) => l.id === state.eid) : undefined
  const project = state.type === 'project' ? projects.find((p) => p.id === state.eid) : undefined
  const found = customer ?? todo ?? ledger ?? project

  // 锚点收口视口内（卡片 288px 宽，右侧越界翻转到锚点左侧）
  const flip = state.anchor.x + 300 > (typeof window !== 'undefined' ? window.innerWidth : 1280)
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(state.anchor.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 220),
    left: flip ? Math.max(8, state.anchor.x - 300) : state.anchor.x,
    width: 288,
  }

  return (
    <div
      ref={cardRef}
      className="z-[80] rounded-xl surface-card-xl p-4 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
      style={style}
      data-testid="entity-hover-card"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[0.9286rem] font-medium">
            {state.label || `（无标题${TYPE_NAME[state.type]}）`}
          </span>
        </div>
        <button
          className="shrink-0 rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
          title="关闭"
          onClick={onClose}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="mb-3 border-t border-outline-variant/40 pt-2">
        {state.type === 'customer' &&
          (() => {
            if (!customer) return <EntityMissing name="客户" />
            const health = resolveHealthScoreDisplay(customer, intimacyCfg, scoreRows[customer.id] ?? null)
            return (
              <>
                <CardRow label="公司" value={customer.company || '—'} />
                <CardRow label="职位" value={customer.title || '—'} />
                <CardRow label="健康分" value={health.label} />
              </>
            )
          })()}
        {state.type === 'todo' &&
          (todo ? (
            <>
              <CardRow label="状态" value={todoStatusLabel(todo)} />
              <CardRow label="优先级" value={todo.priority} />
              <CardRow
                label="截止"
                value={todo.dueAt ? dayjs(todo.dueAt).format('YYYY-MM-DD') : '无'}
              />
            </>
          ) : (
            <EntityMissing name="待办" />
          ))}
        {state.type === 'ledger' &&
          (ledger ? (
            <>
              <CardRow label="币种" value={ledger.currency} />
              <CardRow label="期初余额" value={String(ledger.openingBalance)} />
              <CardRow label="封账周期" value={ledger.closingCycle} />
            </>
          ) : (
            <EntityMissing name="账本" />
          ))}
        {state.type === 'project' &&
          (project ? (
            <>
              <CardRow
                label="状态"
                value={
                  project.status === 'archived'
                    ? '已归档'
                    : project.status === 'paused'
                      ? '已搁置'
                      : '进行中'
                }
              />
              {project.customerId && (
                <CardRow
                  label="挂靠客户"
                  value={customers.find((c) => c.id === project.customerId)?.name ?? '—'}
                />
              )}
            </>
          ) : (
            <EntityMissing name="项目" />
          ))}
        {!found && state.type === 'customer' && !customer && <EntityMissing name="客户" />}
      </div>
      {found && onOpenDetail && (
        <Button
          size="sm"
          icon="open_in_new"
          className="w-full"
          onClick={() => {
            onClose()
            onOpenDetail(state.type, state.eid)
          }}
        >
          打开详情
        </Button>
      )}
    </div>
  )
}

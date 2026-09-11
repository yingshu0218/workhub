import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dayjs from 'dayjs'
import { Icon } from '@/design-system/Icon'
import { Button } from '@/design-system/ui'
import { useCollection } from '@/queries/hooks'
import { useNavigate } from 'react-router-dom'
import { useProjects } from '@/modules/projects/hooks'
import { todoStatusLabel } from '@/modules/todo/domain'
import { todoPriorityFullLabel } from '@/modules/todo/priority'
import { useIntimacyConfig } from '@/modules/crm/intimacy'
import { useCustomerScoreRows } from '@/modules/crm/hooks'
import { resolveHealthScoreDisplay } from '@/modules/crm/healthScore'
import type { Customer, Ledger, Todo } from '@/db/types'

/**
 * 实体悬浮摘要卡（Issue #140，从笔记编辑页 Issue #50 的 `MentionEntitySummary` + hoverCard 抽出）
 *
 * 抽成共享原子件的动因：笔记模块的悬浮卡是 NoteEditorPage 内部的 useState 实现
 * （点击触发、点外/Esc 关闭，右上方固定定位）。记账表单「关联芯片 hover 悬浮显示」
 * 需要同一套摘要口径 —— 若各写一份，客户/待办/项目的摘要字段迟早漂移
 * （健康分口径尤其危险：Issue #108 已收口为 `resolveHealthScoreDisplay` 单一来源）。
 *
 * 交互（Issue #140 需求原文「鼠标移动到芯片标签上会悬浮显示」）：
 * - **hover 触发**，带 `HOVER_DELAY_MS` 延时防误触（鼠标扫过不弹）；
 * - 卡片自身可 hover 停留（移入延时关闭窗口，便于点卡片里的「打开详情」）；
 * - Esc / 点击卡片外部关闭；卡片渲染在 portal（z-[80]，高于 Modal z-50/55 与候选项浮层 z-70）。
 *
 * 安全：摘要内容全部走 React 文本节点（`{value}`），**不使用** dangerouslySetInnerHTML ——
 * 客户「最近互动」等字段来自用户自由文本，HTML 注入面必须为零。
 */

/** 悬浮触发延时（防扫过误触，与需求「鼠标移动上去」的手感对齐） */
export const HOVER_DELAY_MS = 150
/** 移出后的关闭延时（留出鼠标从芯片移到卡片上的时间） */
const CLOSE_DELAY_MS = 220

export type HoverEntityType = 'customer' | 'todo' | 'ledger' | 'project'

export interface HoverTarget {
  type: HoverEntityType
  /** 实体 id（弱引用可能失效，届时渲染「已失效」占位） */
  id: string
}

const TYPE_LABEL: Record<HoverEntityType, string> = {
  customer: '客户',
  todo: '待办',
  ledger: '账本',
  project: '项目',
}

const JUMP_TARGET: Record<HoverEntityType, (id: string) => string> = {
  customer: (id) => `/crm/${id}`,
  todo: () => '/todo',
  ledger: () => '/finance',
  project: (id) => `/projects/${id}`,
}

/** 悬浮卡内的一行「标签 · 值」 */
function CardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-[0.7857rem] text-outline">{label}</span>
      <span className="min-w-0 truncate text-right text-[0.8571rem] text-on-surface">{value}</span>
    </div>
  )
}

/** 实体已删/不存在（弱引用解绑后仍可能被历史数据引用到） */
function EntityMissing({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[0.8571rem] text-outline">
      <Icon name="person_off" size={14} />原{name}已删除或不存在
    </div>
  )
}

/**
 * 实体摘要内容（按类型分支）：数据缺失显示「已失效」占位。
 * 数据源用 useCollection（Dexie liveQuery），实体在其他页被改/删时卡片内容自动刷新。
 */
export function EntitySummary({ type, id }: HoverTarget) {
  const customers = useCollection<Customer>('customers')
  const todos = useCollection<Todo>('todos')
  const ledgers = useCollection<Ledger>('ledgers')
  const projects = useProjects()
  const intimacyCfg = useIntimacyConfig()
  // 健康分算法兜底入参：只算未手动设置档位的客户（与列表/详情/笔记悬浮卡口径一致，Issue #108）
  const scoreRows = useCustomerScoreRows(
    type === 'customer' && !customers.find((c) => c.id === id)?.intimacy?.level ? [id] : [],
  )

  if (type === 'customer') {
    const c = customers.find((x) => x.id === id)
    if (!c) return <EntityMissing name="客户" />
    const health = resolveHealthScoreDisplay(c, intimacyCfg, scoreRows[c.id] ?? null)
    return (
      <>
        <CardRow label="公司" value={c.company || '—'} />
        <CardRow label="职位" value={c.title || '—'} />
        <CardRow label="健康分" value={health.label} />
      </>
    )
  }
  if (type === 'todo') {
    const t = todos.find((x) => x.id === id)
    if (!t) return <EntityMissing name="待办" />
    return (
      <>
        <CardRow label="状态" value={todoStatusLabel(t)} />
        <CardRow label="优先级" value={todoPriorityFullLabel(t.priority)} />
        <CardRow label="截止" value={t.dueAt ? dayjs(t.dueAt).format('YYYY-MM-DD') : '无'} />
      </>
    )
  }
  if (type === 'ledger') {
    const l = ledgers.find((x) => x.id === id)
    if (!l) return <EntityMissing name="账本" />
    return (
      <>
        <CardRow label="币种" value={l.currency} />
        <CardRow label="期初余额" value={String(l.openingBalance)} />
        <CardRow label="封账周期" value={l.closingCycle} />
      </>
    )
  }
  const pj = projects.find((x) => x.id === id)
  if (!pj) return <EntityMissing name="项目" />
  return (
    <>
      <CardRow
        label="状态"
        value={pj.status === 'archived' ? '已归档' : pj.status === 'paused' ? '已搁置' : '进行中'}
      />
      {pj.customerId && (
        <CardRow label="挂靠客户" value={customers.find((c) => c.id === pj.customerId)?.name ?? '—'} />
      )}
    </>
  )
}

/**
 * 悬浮摘要卡（受控）：由 `useEntityHover` 驱动，调用方只管把 target 传进来。
 * 卡片自带「打开详情」跳转；内容区滚动上限 60vh，长摘要不撑破视口。
 */
export function EntityHoverCard({
  target,
  label,
  anchorRect,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: {
  target: HoverTarget
  /** 芯片展示文案（卡片标题），如「深蓝科技 · 张三」 */
  label: string
  /** 锚点位置（芯片 getBoundingClientRect），用于把卡片定位到芯片下方 */
  anchorRect: DOMRect | null
  onClose: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // 点外部 / Esc 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 定位：芯片下方 6px，右/下越界时收敛回视口内（卡片宽 288 = w-72）
  const CARD_W = 288
  const style: React.CSSProperties = anchorRect
    ? {
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - CARD_W - 8)),
        top: Math.min(anchorRect.bottom + 6, window.innerHeight - 16),
      }
    : { left: 16, top: 16 }

  return createPortal(
    <div
      ref={cardRef}
      className="fixed z-[80] w-72 surface-card-xl p-4 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // 卡片内点击不冒泡到 document（避免触发父级 Modal 的遮罩关闭）
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`${TYPE_LABEL[target.type]}摘要`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="truncate text-[0.9286rem] font-medium" title={label}>
          {label}
        </span>
        <button
          className="shrink-0 rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
          title="关闭"
          onClick={onClose}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="mb-3 max-h-[60vh] overflow-y-auto border-t border-outline-variant/40 pt-2">
        <EntitySummary type={target.type} id={target.id} />
      </div>
      <Button
        size="sm"
        icon="open_in_new"
        className="w-full"
        onClick={() => {
          onClose()
          navigate(JUMP_TARGET[target.type](target.id))
        }}
      >
        打开详情
      </Button>
    </div>,
    document.body,
  )
}

/**
 * 悬浮卡状态机（供 EntityLinkField 等复用）：
 * hover 进 → 延时打开；hover 出 → 延时关闭（窗口内移入卡片可取消关闭）。
 * 返回 target/label/anchorRect 与一组事件处理器，调用方只做挂载。
 */
export function useEntityHover() {
  const [hover, setHover] = useState<{ target: HoverTarget; label: string; rect: DOMRect } | null>(
    null,
  )
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimers() {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }

  useEffect(() => clearTimers, [])

  /** 芯片 hover 进入：延时开后弹卡（防鼠标扫过误弹） */
  function enter(target: HoverTarget, label: string, el: HTMLElement) {
    clearTimers()
    openTimer.current = setTimeout(() => {
      setHover({ target, label, rect: el.getBoundingClientRect() })
    }, HOVER_DELAY_MS)
  }

  /** 芯片 hover 移出：延时关闭；移入卡片会在窗口内取消 */
  function leave() {
    clearTimers()
    closeTimer.current = setTimeout(() => setHover(null), CLOSE_DELAY_MS)
  }

  /** 卡片自身 hover 进入：取消关闭计时（让用户能点「打开详情」） */
  function keepOpen() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  function close() {
    clearTimers()
    setHover(null)
  }

  return { hover, enter, leave, keepOpen, close }
}

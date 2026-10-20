import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/design-system/Icon'
import { inputCls } from '@/design-system/ui'
import { usePresence } from '@/shared/usePresence'

/**
 * 模糊匹配基建已提升至 `@/shared/search`（Issue #33 agentOps P1 第 1 步：消除 shared ↔ design-system 反向依赖）。
 * 此处 re-export 保持既有 5 个使用方（含 design-system 内部消费）零改动。
 */
export { fuzzyMatch, fuzzySort, archivedLast } from '@/shared/search'
import { archivedLast, fuzzySort } from '@/shared/search'
import { fuzzyMatch as _fuzzyMatch } from '@/shared/search'

export interface MatchOption {
  id: string
  /** 主文案（客户：公司 · 姓名；待办：标题） */
  label: string
  /** 次要文案（待办优先级、「已归档」「已完成」等标注） */
  sub?: string
  /** 图标名（须存在于 assets/icons，缺省客户 person / 待办 task_alt） */
  icon?: string
  /** 归档/沉底标记：标记项在排序结果中沉底（sub 建议传「已归档」） */
  archived?: boolean
  /** 业务扩展位：候选携带原始实体，供 onChangeMeta 回传（如笔记 @项目联动 Tab） */
  project?: import('@/db/types').Project
}

/**
 * 可输入模糊匹配下拉（实体关联字段共用）：
 * 手动输入即时过滤（子串 + 子序列），无输入展开全量候选；键盘 ↑↓ 选择、Enter 确认、Esc 关闭；
 * 点选候选项后清空输入框并显示已选回显条（可清除、可点击重新展开候选）；
 * 「不关联」选项置于列表首位；候选可传 archived 标记实现沉底 + sub 标注。
 */
export function MatchCombobox({
  value,
  options,
  placeholder,
  emptyText,
  onChange,
  onChangeMeta,
  hiddenIds,
}: {
  value: string
  options: MatchOption[]
  placeholder: string
  emptyText: string
  onChange: (id: string) => void
  /** 选中/清除时回传命中的候选原文（用于联动组件外状态，如笔记 @提及浮层切到项目 Tab） */
  onChangeMeta?: (option: MatchOption | undefined) => void
  /**
   * 从**候选**中排除的 id 集合（黑名单「单据选择器排除」等）。
   * 已选项不受影响：`selected` 仍从完整 `options` 里取，回显条照常显示
   * —— 配置文案明确「关联区始终保留，不丢数据」，过滤候选不能连已建立的关联一起抹掉。
   */
  hiddenIds?: ReadonlySet<string>
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.id === value)
  // 候选排除（hiddenIds）只作用于「可选项」，不影响上面的 selected 回显
  const matched = options.filter((o) => _fuzzyMatch(o.label, query) && !hiddenIds?.has(o.id))
  // 归档沉底：先按匹配质量排序，再按 archived 沉底（稳定，两种顺序都保留）
  const filtered = archivedLast(fuzzySort(matched, (o) => o.label, query))
  // 「不关联」恒在首位（仅无已选时展示）
  const listItems: MatchOption[] = selected ? filtered : [{ id: '', label: '不关联' }, ...filtered]
  const safeIdx = Math.min(activeIdx, Math.max(0, listItems.length - 1))

  // 点外关闭（Issue #151）：浮层 portal 到 body，**不在** `boxRef` 子树内，
  // 所以「内部/外部」不能再用 `boxRef.contains()` 判定 —— 改用 `data-dropdown-root`
  // 语义标记：触发器与浮层都打上它，被点节点祖先链上带这个标记即算「下拉内部」。
  // 监听挂在 window 冒泡阶段（而非具体节点）：事件必然经过 window，
  // 且浮层与触发器分处两棵 DOM 子树时仍然只跑一份判定。
  useEffect(() => {
    if (!open) return
    const isInside = (target: Node | null) =>
      target instanceof Element ? !!target.closest('[data-dropdown-root]') : false
    const onDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  function commit(id: string) {
    onChange(id)
    onChangeMeta?.(id ? options.find((o) => o.id === id) : undefined)
    setQuery('')
    setOpen(false)
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      setActiveIdx(Math.min(safeIdx + 1, listItems.length - 1))
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      setActiveIdx(Math.max(safeIdx - 1, 0))
      e.preventDefault()
    } else if (e.key === 'Enter') {
      const item = listItems[safeIdx]
      if (item) commit(item.id)
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} data-dropdown-root className="relative">
      {/* 已选回显条：可清除，点击主体重新展开候选 */}
      {selected ? (
        <div className="flex items-center justify-between surface-card-low px-3 py-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-[0.9286rem]"
            title="点击重新选择"
            onClick={() => {
              setOpen(true)
              setActiveIdx(0)
            }}
          >
            <Icon name={selected.icon ?? 'person'} size={16} className="shrink-0 text-primary" />
            <span className="truncate font-medium">{selected.label}</span>
            {selected.sub && (
              <span className="shrink-0 text-[0.7857rem] text-outline">{selected.sub}</span>
            )}
          </button>
          <button
            className="shrink-0 rounded p-0.5 text-outline transition-colors hover:bg-surface-hover-high hover:text-on-surface"
            title="清除关联"
            onClick={() => commit('')}
          >
            <Icon name="close" size={16} />
          </button>
          {/* 浮层由 DropdownPortal 内部管 presence：这里不再用 {open && …} 包一层，
              否则关闭时整棵子树会被父级同步摘掉、出场动画没机会播。 */}
          <DropdownPortal open={open} anchorRef={boxRef} onClose={() => setOpen(false)}>
            {listItems.length === 0 ? (
              <div className="px-3 py-2 text-[0.8571rem] text-outline">{emptyText}</div>
            ) : (
              listItems.map((o, i) => (
                <button
                  key={o.id || '__none__'}
                  onClick={() => commit(o.id)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
                    i === safeIdx ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-hover'
                  }`}
                >
                  <Icon
                    name={o.id ? (o.icon ?? 'person') : 'person_off'}
                    size={15}
                    className="shrink-0 text-outline"
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.sub && (
                    <span className="shrink-0 text-[0.7857rem] text-outline">{o.sub}</span>
                  )}
                </button>
              ))
            )}
          </DropdownPortal>
        </div>
      ) : (
        <input
          className={inputCls}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActiveIdx(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
        />
      )}
      {!selected && (
        <DropdownPortal open={open} anchorRef={boxRef} onClose={() => setOpen(false)}>
          {listItems.length === 0 ? (
            <div className="px-3 py-2 text-[0.8571rem] text-outline">{emptyText}</div>
          ) : (
            listItems.map((o, i) => (
              <button
                key={o.id || '__none__'}
                onClick={() => commit(o.id)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
                  i === safeIdx ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-hover'
                }`}
              >
                <Icon
                  name={o.id ? (o.icon ?? 'person') : 'person_off'}
                  size={15}
                  className="shrink-0 text-outline"
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.sub && <span className="shrink-0 text-[0.7857rem] text-outline">{o.sub}</span>}
              </button>
            ))
          )}
        </DropdownPortal>
      )}
    </div>
  )
}

/**
 * 候选浮层 portal 容器：渲染到 body 并对齐触发框，避免被居中弹窗的 overflow 裁切；
 * 层级 z-[70] 高于 Modal（z-50 / z-[55]）与 ConfirmDialog（z-[60]）。
 * 浮层内点击不冒泡到 document，防止误触 Modal 遮罩关闭。
 *
 * ⚠️ 不要再给浮层加 `mousedown` / `pointerdown` 的 `stopPropagation`（Issue #151 的 bug 根因）：
 * 点外关闭挂在 window 的 `mousedown` 上，而浮层自己是 portal 到 body 的独立子树。
 * 一旦浮层把这些事件吃掉，窗口级监听就收不到「点在了外部」这个事实，
 * `setOpen(false)` 永不执行 → 表现为**下拉菜单收不回去**。
 * 浮层只保留 `click` 阻断，用于防止点选冒泡到 Modal 遮罩把整张表单关掉。
 *
 * 出场动画与其它弹层同法：把 `open` 收进来、自己用 presence 管挂载时机。
 * 调用方**不要**再套 `{open && …}`——父级同步卸载会让出场动画没机会播。
 */
function DropdownPortal({
  open,
  anchorRef,
  onClose,
  children,
}: {
  open: boolean
  anchorRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  // 视口下方空间不足时向上翻转弹出（审计：触发框贴近视口底部时固定向下会溢出）
  const [flipUp, setFlipUp] = useState(false)
  const { present, phase, ref: presenceRef } = usePresence(open, 150)
  const closing = phase === 'out'
  const rect = useAnchorRect(anchorRef, present, setFlipUp)

  if (!present || !rect) return null
  return createPortal(
    <div
      ref={presenceRef}
      data-dropdown-root
      className={`fixed z-[70] max-h-56 overflow-y-auto surface-card py-1 shadow-lg ${
        closing ? 'anim-panel-out' : 'anim-pop'
      }`}
      style={
        flipUp
          ? {
              left: rect.left,
              bottom: window.innerHeight - rect.top + 4,
              width: rect.width,
              // 缩放轴跟着弹出方向走：向上弹以底边为轴，否则会「从错误的一侧长出来」
              transformOrigin: 'bottom center',
            }
          : {
              left: rect.left,
              top: rect.bottom + 4,
              width: rect.width,
              transformOrigin: 'top center',
            }
      }
      // 只阻断 click：防止浮层内点选冒泡到 Modal 遮罩把整个弹窗关掉。
      // 不再阻断 mousedown / pointerdown —— 见上方注释（阻断它们会让点外关闭失效）。
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {children}
    </div>,
    document.body,
  )
}

/**
 * 量锚点矩形（浮层位置完全由锚点推导，不需要读浮层自身 DOM —— 那是 portal 子树）。
 * 只在浮层「存在」期间监听滚动/尺寸变化，收起时自动摘掉监听。
 */
function useAnchorRect(
  anchorRef: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  setFlipUp: (v: boolean) => void,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    if (!active) {
      setRect(null)
      return
    }
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect() ?? null
      setRect(r)
      if (r) {
        const spaceBelow = window.innerHeight - r.bottom
        const dropHeight = Math.min(224, Math.max(36, spaceBelow)) // max-h-56 ≈ 224px
        setFlipUp(spaceBelow < dropHeight && r.top > spaceBelow)
      }
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorRef, active, setFlipUp])

  return rect
}

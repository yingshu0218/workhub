import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/design-system/Icon'
import { inputCls } from '@/design-system/ui'
import { EntityHoverCard, useEntityHover, type HoverEntityType } from '@/design-system/EntityHoverCard'
import { archivedLast, fuzzyMatch, fuzzySort } from '@/shared/search'
import type { MatchOption } from '@/design-system/MatchCombobox'
import type { CSSProperties } from 'react'

/**
 * 实体关联多值芯片输入（Issue #140）
 *
 * 形态：`MatchCombobox` 的联想能力 + `ChipTagInput` 的芯片手感，产出**带实体 id 的芯片数组**。
 * 与纯文本标签的关键差别：每个芯片背后必须是真实实体 id（弱引用），否则悬浮卡查不到对象、
 * 只能退回「已失效」占位 —— 所以这里禁掉自由文本固化（`ChipTagInput` 那套回车成标签的能力
 * 不适用），只能从候选中选。
 *
 * 交互：
 * - 输入即时模糊过滤（子串 + 子序列），↑↓ 选择、Enter 确认、Esc 关候选；
 * - 选中 → 固化一枚芯片并清空输入，输入框保留以便连续多选；
 * - 芯片 × → 解绑；退格（输入为空）→ 删末个芯片；
 * - **芯片 hover 150ms → 悬浮摘要卡**（Issue #140 需求原文），卡片可停留、点外/Esc 关闭。
 *
 * 层级：候选项浮层与悬浮卡都用 portal（z-70 / z-80），不会被抽屉 Modal 的 overflow 裁切。
 */

/** 候选浮层样式与 MatchCombobox.DropdownPortal 同口径（此组件不弹"不关联"项，故独立实现） */
function DropdownPortal({
  rect,
  onClose,
  children,
}: {
  rect: DOMRect
  onClose: () => void
  children: React.ReactNode
}) {
  const spaceBelow = window.innerHeight - rect.bottom
  const flipUp = spaceBelow < 224 && rect.top > spaceBelow
  return createPortal(
    <div
      className="fixed z-[70] max-h-56 overflow-y-auto surface-card py-1 shadow-lg"
      style={
        flipUp
          ? { left: rect.left, bottom: window.innerHeight - rect.top + 4, width: rect.width }
          : { left: rect.left, top: rect.bottom + 4, width: rect.width }
      }
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {children}
    </div>,
    document.body,
  )
}

/** 芯片底色：按实体 id hash 恒定同色（同 ChipTagInput 口径，同一客户永远是同一色） */
function chipStyle(key: string): CSSProperties {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return { background: `hsl(${hue} 85% 92%)`, color: `hsl(${hue} 70% 28%)` }
}

export default function EntityLinkField({
  value,
  options,
  type,
  icon = 'person',
  placeholder,
  emptyText,
  onChange,
}: {
  /** 已关联实体 id 数组 */
  value: string[]
  /** 候选集（须带实体的展示标签与归档沉底标记） */
  options: MatchOption[]
  /** 悬浮摘要卡类型（customer / todo / ledger / project） */
  type: HoverEntityType
  /** 芯片前导图标 */
  icon?: string
  placeholder: string
  emptyText: string
  /** 增删回调（已去重；解绑即从数组移除） */
  onChange: (next: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hover = useEntityHover()

  const selected = value.map((id) => options.find((o) => o.id === id)).filter((o): o is MatchOption => !!o)
  // 仅列出未关联的候选（已关联的不再出现在下拉里，避免重复选）
  const candidates = options.filter((o) => !value.includes(o.id))
  const matched = candidates.filter((o) => fuzzyMatch(o.label, query))
  const filtered = archivedLast(fuzzySort(matched, (o) => o.label, query))
  const safeIdx = Math.min(activeIdx, Math.max(0, filtered.length - 1))

  function openList() {
    const r = boxRef.current?.getBoundingClientRect() ?? null
    setRect(r)
    setOpen(true)
    setActiveIdx(0)
  }

  function closeList() {
    setOpen(false)
    setQuery('')
  }

  function pick(option: MatchOption | undefined) {
    if (!option) return
    if (!value.includes(option.id)) onChange([...value, option.id])
    setQuery('')
    setActiveIdx(0)
    setOpen(true) // 保留候选展开：多选场景下连续添加更顺手
    inputRef.current?.focus()
  }

  function remove(id: string) {
    onChange(value.filter((x) => x !== id))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!open) openList()
      else pick(filtered[safeIdx])
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openList()
      else setActiveIdx(Math.min(safeIdx + 1, Math.max(0, filtered.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(Math.max(safeIdx - 1, 0))
      return
    }
    if (e.key === 'Escape') {
      closeList()
      return
    }
    // 退格删末个芯片（与 ChipTagInput 同款手感）
    if (e.key === 'Backspace' && !query && value.length > 0) {
      remove(value[value.length - 1])
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div
        className={`${inputCls} flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5`}
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((o) => (
          <span
            key={o.id}
            className="flex max-w-full items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium"
            style={chipStyle(o.id)}
            // Issue #140：鼠标移入芯片 → 延时弹悬浮摘要卡
            onMouseEnter={(e) => hover.enter({ type, id: o.id }, o.label, e.currentTarget)}
            onMouseLeave={hover.leave}
          >
            <Icon name={o.icon ?? icon} size={13} />
            <span className="max-w-[12rem] truncate" title={o.label}>
              {o.label}
            </span>
            <button
              className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
              title="解绑"
              onClick={(e) => {
                e.stopPropagation()
                remove(o.id)
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="min-w-[120px] flex-1 bg-transparent text-[0.9286rem] outline-none"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!open) openList()
            setActiveIdx(0)
          }}
          onFocus={openList}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>

      {open && rect && (
        <DropdownPortal rect={rect} onClose={closeList}>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[0.8571rem] text-outline">
                {candidates.length === 0 && !query ? emptyText : '没有匹配的候选'}
              </div>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => pick(o)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
                    i === safeIdx ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-container'
                  }`}
                >
                  <Icon name={o.icon ?? icon} size={15} className="shrink-0 text-outline" />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.sub && (
                    <span className="shrink-0 text-[0.7857rem] text-outline">{o.sub}</span>
                  )}
                </button>
              ))
            )}
        </DropdownPortal>
      )}

      {hover.hover && (
        <EntityHoverCard
          target={hover.hover.target}
          label={hover.hover.label}
          anchorRect={hover.hover.rect}
          onClose={hover.close}
          onMouseEnter={hover.keepOpen}
          onMouseLeave={hover.leave}
        />
      )}
    </div>
  )
}


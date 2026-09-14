import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/design-system/Icon'
import { inputCls } from '@/design-system/ui'

/**
 * 渠道下拉（Issue #151）
 *
 * 为什么不用原生 `<select>` + 为什么**不能**用 `MatchCombobox`：
 * - 原生 select 的展开态由操作系统绘制，应用皮肤（pixel/cartoon/glass…）管不到，
 *   且展开后点击外部**不会触发** `mousedown`（只触发 `click`），与下方「点外关闭统一走
 *   `mousedown`」的既有纪律不一致；
 * - `MatchCombobox` 会把无值时显示成「不关联」，语义是「解除关联」而不是「未填写」，
 *   用在渠道字段上会被误读；且它是可输入控件，渠道是**固定枚举单选**，不需要联想。
 *
 * 所以这里是一个**受控单选浮层**：触发器按钮 + portal 候选面板，形态与 MatchCombobox
 * 的候选浮层同口径（portal 到 body、`fixed z-[70]`、视口下方空间不足向上翻转），
 * 但值可以为空（空 = 「未指定」），并且带显式关闭路径。
 */
export interface ChannelOption {
  /** 选项值（空串保留给「未指定」由组件内部注入，业务侧不必传） */
  value: string
  label: string
  icon?: string
}

/** 未选中任何渠道时的展示文案（可选字段的空态） */
export const CHANNEL_EMPTY_LABEL = '未指定'

export default function ChannelSelect({
  value,
  options,
  onChange,
  label = '结算渠道',
  placeholder = CHANNEL_EMPTY_LABEL,
}: {
  /** 当前值；空串 = 未指定 */
  value: string
  options: readonly ChannelOption[]
  onChange: (next: string) => void
  /** 触发器 aria-label / title 文案 */
  label?: string
  /** 空值时的占位文案 */
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  // 点外部关闭（与 MatchCombobox / EntityLinkField 同一套判定，Issue #151）：
  // 浮层 portal 到 body、不在 boxRef 子树内，故用 `data-dropdown-root` 语义标记认「内部」；
  // 监听挂 window 冒泡阶段，浮层自身不阻断 `mousedown`（否则关闭路径收不到事件）。
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

  // Esc 关闭：走 window 捕获并在本层消费，避免冒泡给 Modal 的 useEscapeLayer 顺手关掉整个表单
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  function pick(next: string) {
    onChange(next)
    setOpen(false)
  }

  return (
    <div ref={boxRef} data-dropdown-root className="relative">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`${inputCls} flex items-center justify-between gap-2 text-left`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className={`truncate ${selected ? '' : 'text-on-surface-variant'}`}>
          {selected?.label ?? placeholder}
        </span>
        <Icon name="keyboard_arrow_down" size={18} className="shrink-0 text-outline" />
      </button>

      {open && (
        <DropdownPortal anchorRef={boxRef} onClose={() => setOpen(false)}>
          {/* 「未指定」恒在首位：可选字段必须能显式清空已选值 */}
          <button
            type="button"
            role="option"
            aria-selected={!selected}
            onClick={() => pick('')}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
              !selected ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-container'
            }`}
          >
            <Icon name="do_not_disturb_on" size={15} className="shrink-0 text-outline" />
            {/* ⚠️ 标签**不要**再硬编码颜色：这一行是「选中行」，父按钮已按选中态给了
                `bg-primary-fixed text-primary`；此前这里写死 `text-outline` 会把父级的
                primary 覆盖掉，实测对比度由 6.0:1 掉到 3.92:1（浅）/ 6.12:1 掉到 3.25:1（暗），**低于 AA 4.5**。
                去掉后与下方各渠道选项行写法一致（不自带颜色、继承按钮态）。 */}
            <span className="min-w-0 flex-1 truncate">{placeholder}</span>
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => pick(o.value)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] transition-colors ${
                o.value === value ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-container'
              }`}
            >
              <Icon
                name={o.icon ?? 'account_balance_wallet'}
                size={15}
                className="shrink-0 text-outline"
              />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </button>
          ))}
        </DropdownPortal>
      )}
    </div>
  )
}

/**
 * 候选浮层容器：portal 到 body（不被 Modal 的 overflow 裁切），z-[70] 与 MatchCombobox /
 * EntityLinkField 的候选浮层同层；下方空间不足时向上翻转。
 *
 * ⚠️ 不要再给浮层加 `mousedown` / `pointerdown` 的 `stopPropagation`（Issue #151 的 bug 根因）：
 * 点外关闭挂在 window 的 `mousedown` 上，浮层却 portal 成独立子树；浮层一旦吃掉这些事件，
 * 判定就收不到「点了外部」这个事实，`setOpen(false)` 永不执行 → 下拉收不回去。
 * 浮层只保留 `click` 阻断，防止点选冒泡到 Modal 遮罩把整张表单关掉。
 */
function DropdownPortal({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [flipUp, setFlipUp] = useState(false)

  // 只量**锚点**即可：portal 挂到 body 后浮层位置完全由锚点推导，
  // 不需要读浮层自身的 DOM（那是 portal 子树，首帧尚未挂载）。
  useLayoutEffect(() => {
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect() ?? null
      setRect(r)
      if (r) {
        const spaceBelow = window.innerHeight - r.bottom
        const dropHeight = Math.min(224, Math.max(36, spaceBelow))
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
  }, [anchorRef])

  if (!rect) return null
  return createPortal(
    <div
      role="listbox"
      // `data-dropdown-root`：与触发器共用一个「下拉根」语义标记（见点外关闭注释）
      data-dropdown-root
      className="fixed z-[70] max-h-56 overflow-y-auto surface-card py-1 shadow-lg"
      style={
        flipUp
          ? { left: rect.left, bottom: window.innerHeight - rect.top + 4, width: rect.width }
          : { left: rect.left, top: rect.bottom + 4, width: rect.width }
      }
      // 只阻断 click（防误触 Modal 遮罩）；阻断 mousedown/pointerdown 会让点外关闭失效
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {children}
    </div>,
    document.body,
  )
}

import type { CSSProperties, ReactNode } from 'react'

/**
 * 胶囊筛选 chip（审计第三批 D 组 · 2026-11-01）。
 *
 * 收口前本仓有 4 处各写一份、且**已经漂移**的胶囊 chip：
 * ① `modules/crm/CrmPage.tsx` 的 `filterChip` / `filterChipIdle` 常量；
 * ② `modules/crm/AllTimelinesPage.tsx` 内联 3 份（时间线过滤 / 全部客户 / 各客户）；
 * ③ `modules/finance/FinancePage.tsx` 的 `LedgerChip`；
 * ④ `modules/crm/CustomerDetailPage.tsx` 的时间线过滤。
 * （同一文件里的明细 Tab 曾被一并换成 chip，复核后确认「页签 ≠ chip」，
 * 已还原为无边框纯文字页签 —— 页签与筛选项语义不同，不要往回并。）
 *
 * 外形只保留**两种 variant**，二者不是审美差异而是语义差异：
 * - `outline`（默认）：`rounded-full` + 1px 描边 + 选中态主色浅底。用于「筛选项」，
 *   尺寸两档：
 *   - `md`（默认）`px-3 py-1.5` + 0.9286rem —— 对应 CrmPage 档位 chip；
 *   - `sm` `px-2.5 py-0.5` + 0.7857rem —— 对应时间线筛选这类**成排出现**的密集 chip，
 *     尺寸原样保留，避免把两行 chip 撑成三行。
 * - `filled`：**无边框实心填充**（active `bg-primary text-on-primary`，idle
 *   `bg-surface-container-high`），尺寸固定 `px-3 py-1` + 0.8571rem —— 这是 finance
 *   账本 chip 的**原始设计**，合并时曾被改成描边胶囊（属「为去重而改外观」），
 *   2026-11-01 复核后以 variant 形式原样还原。
 *
 * ⚠️ `filled` 不参与 `size` 分档：它的尺寸就是账本行那一套原始值，混用会让
 * 「回退视觉」再次失真。要新尺寸请先确认是设计决定而非顺手。
 *
 * ⚠️ 调用方若有「按档位动态上色」的需求（如 CrmPage 的健康分档位 chip），
 * 用 `style` 传入内联色值 —— 内联样式优先级高于类，故选中态的三个 color 类会被覆盖，
 * 不必为此再造一份实现。
 */
const SIZES = {
  md: 'px-3 py-1.5 text-[0.9286rem]',
  sm: 'px-2.5 py-0.5 text-[0.7857rem]',
} as const

/** `filled` 的尺寸写死：它就是账本行的原始值，不接受 `size` 覆盖 */
const FILLED_SIZE = 'px-3 py-1 text-[0.8571rem] font-medium transition-colors'

export function FilterChip({
  active,
  onClick,
  children,
  size = 'md',
  variant = 'outline',
  className = '',
  style,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  size?: keyof typeof SIZES
  /** `outline`（筛选项）| `filled`（账本行实心 chip，尺寸固定） */
  variant?: 'outline' | 'filled'
  /** 附加布局类（如横滑行的 `inline-flex items-center gap-1`） */
  className?: string
  /** 内联样式（动态档位色） */
  style?: CSSProperties
}) {
  const baseCls =
    variant === 'filled' ? FILLED_SIZE : `border ${SIZES[size]} transition-colors`
  const stateCls =
    variant === 'filled'
      ? active
        ? 'bg-primary text-on-primary'
        : 'bg-surface-container-high text-on-surface-variant'
      : active
        ? 'border-primary bg-primary-fixed font-medium text-primary'
        : 'border-outline-variant/60 text-on-surface-variant hover:text-on-surface'

  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={`shrink-0 whitespace-nowrap rounded-full ${baseCls} ${stateCls} ${className}`}
    >
      {children}
    </button>
  )
}

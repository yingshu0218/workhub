import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { usePresence } from '@/shared/usePresence'

/** 基础组件库（对齐 DESIGN.md：白卡/8px 圆角/1px 边框/柔和阴影/胶囊 Chip） */

/** Esc 关闭栈：多层弹层叠放时按 Esc 只关最上层（Issue #107 审计：原实现三层齐落） */
type EscapeLayer = { kind: 'modal' | 'dialog'; close: () => void }
const escapeStack: EscapeLayer[] = []

/**
 * 弹层挂载时入栈、卸载时出栈；keydown 按下时仅栈顶层响应 Esc。
 * 叠放场景（如凭证详情 Drawer z-50 → 流水编辑 Modal z-[55] → 确认框 z-[60]）逐层关闭。
 */
export function useEscapeLayer(open: boolean, onClose: () => void, kind: EscapeLayer['kind'] = 'modal') {
  useEffect(() => {
    if (!open) return
    const layer: EscapeLayer = { kind, close: onClose }
    escapeStack.push(layer)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (escapeStack[escapeStack.length - 1] === layer) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      const i = escapeStack.indexOf(layer)
      if (i >= 0) escapeStack.splice(i, 1)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, kind])
}

export function Drawer({
  open,
  title,
  onClose,
  children,
  width = 420,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEscapeLayer(open, onClose)

  // 出场动画靠 presence：关闭后保持挂载一小段。时长与 .anim-drawer-out 的基时对齐。
  const { present, phase, ref } = usePresence(open, 200)
  const closing = phase === 'out'

  if (!present) return null
  return (
    <div className="fixed inset-0 z-50" ref={ref}>
      <div
        className={`absolute inset-0 bg-black/25 ${closing ? 'anim-overlay-out' : 'anim-overlay-in'}`}
        onClick={onClose}
      />
      <div
        className={`absolute right-0 top-0 flex h-full flex-col bg-surface-container-lowest shadow-[-8px_0_24px_rgba(0,0,0,0.10)] ${
          closing ? 'anim-drawer-out' : 'anim-drawer-in'
        }`}
        style={{ width }}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant/40 px-5">
          <h2 className="text-[1.0714rem] font-semibold">{title}</h2>
          <button className="text-outline hover:text-on-surface" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

/** 居中弹窗（Issue #107）：桌面居中留边、窄屏全屏，皮肤穿透 surface-card-dialog */
export function Modal({
  open,
  title,
  onClose,
  children,
  size = 'lg',
  elevated,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** md = max-w-2xl（短表单）| lg = max-w-4xl（客户/流水）| xl = max-w-5xl（预留） */
  size?: 'md' | 'lg' | 'xl'
  /** 弹窗内再开弹窗时传 true，抬到 ConfirmDialog 之下的更高层 */
  elevated?: boolean
}) {
  useEscapeLayer(open, onClose)

  // 出场动画靠 presence（关闭后保持挂载播完出场再卸载）；基时 200ms 与 .anim-panel-out 对齐
  const { present, phase, ref } = usePresence(open, 200)
  const closing = phase === 'out'

  if (!present) return null
  // 断点统一用 md(768) 而非原来的 sm(640)：全站桌面/移动分界定在 768，
  // 否则 640~768 这一段会同时命中两套规则、结果取决于 CSS 生成顺序。
  const sizes = { md: 'md:max-w-2xl', lg: 'md:max-w-4xl', xl: 'md:max-w-5xl' }[size]
  return (
    <div
      ref={ref}
      className={`modal-overlay fixed inset-0 flex items-center justify-center p-0 md:p-6 ${
        elevated ? 'z-[55]' : 'z-50'
      }`}
    >
      <div
        className={`absolute inset-0 bg-black/25 ${closing ? 'anim-overlay-out' : 'anim-overlay-in'}`}
        onClick={onClose}
      />
      {/* 形态由 styles/index.css 的 .modal-overlay / .modal-panel 表达：
          <768px = 贴底抽屉（只圆上两角、最高 85dvh）；≥768px = 居中对话框。
          这里不写 h-full / rounded-* 工具类——会被无层级的 .surface-card-dialog 盖掉。

          动效同理：面板统一挂 .anim-panel-*，由 index.css 的窄屏媒体查询把它换成
          「底部滑入」的 keyframes —— 与上面形态的做法一致，组件里不做断点判断。 */}
      <div
        className={`modal-panel relative flex w-full flex-col overflow-hidden surface-card-dialog md:h-auto md:max-h-[90vh] ${
          closing ? 'anim-panel-out' : 'anim-panel-in'
        } ${sizes}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant/40 px-5">
          <h2 className="text-[1.0714rem] font-semibold">{title}</h2>
          <button className="text-outline hover:text-on-surface" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">{label}</div>
      {children}
    </label>
  )
}

/**
 * 打开弹窗时聚焦首个输入框且不滚动页面（替代裸 autoFocus —— 后者会因浏览器默认
 * focus 行为把被遮罩层后面滚动容器拉到可视区，表现为「一打开表单页面就跳滚」）。
 *
 * 必须传 `active`（通常为弹层 open）：表单组件常驻挂载、靠 open 控制显隐，
 * 若只在挂载时聚焦一次，首帧输入框尚未渲染、之后打开弹窗也不会重跑，焦点会静默丢失。
 * rAF 延迟一帧，确保打开态首次渲染的 DOM 已就绪。
 */
export function useAutoFocus<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(raf)
  }, [active])
  return ref
}

export const inputCls = 'input'

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  onClick,
  className = '',
  disabled,
  type,
}: {
  children?: ReactNode
  variant?: 'primary' | 'ghost' | 'tonal' | 'danger'
  size?: 'sm' | 'md'
  icon?: string
  /** 事件参数可选（Issue #162：列表行点击进入详情后，行内按钮需要 stopPropagation） */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
  disabled?: boolean
  /**
   * 表单提交必须显式传 `submit`。刻意**不设默认值**：`<button>` 缺省在表单内就是 submit，
   * 若这里默认成 button，会把现有依赖默认行为的表单静默改坏。
   */
  type?: 'button' | 'submit' | 'reset'
}) {
  const base =
    // ⚠️ 刻意**不写** `transition-colors`：`.press` 是无层级声明，它的 transition
    // 会整条压掉 layer 内的 Tailwind 过渡类 → 写了也是死代码、还会误导下一个人。
    // 颜色过渡已由 `.press` 自己承担（transform 与颜色属性并列，见 styles/index.css）。
    'press inline-flex items-center gap-1.5 rounded-lg font-medium disabled:opacity-50 disabled:pointer-events-none'
  const sizes = size === 'sm' ? 'h-8 px-3 text-[0.9286rem]' : 'h-9 px-4'
  const variants = {
    primary: 'bg-primary text-on-primary hover:bg-primary-container',
    ghost: 'border border-primary text-primary hover:bg-primary-fixed/50',
    tonal: 'bg-surface-container-high text-primary hover:bg-primary-fixed',
    danger: 'bg-danger text-on-primary hover:opacity-90',
  }[variant]
  return (
    <button
      className={`${base} ${sizes} ${variants} ${className}`}
      onClick={onClick}
      disabled={disabled}
      type={type}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  )
}

export function Card({
  children,
  className = '',
  hover,
  onClick,
  style,
}: {
  children: ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
  /** 内联样式（可选）：列表错峰入场需要 `animationDelay`，见 shared/stagger */
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`card ${hover ? 'card-hover cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      style={style}
    >
      {children}
    </div>
  )
}

/**
 * 统计卡（审计第三批 C 组 · 2026-11-01）。
 *
 * 合并自两处曾独立演化的实现：`modules/crm/CrmListParts.tsx` 的 `StatCard`
 * 与 `modules/finance/FinancePage.tsx` 的 `SummaryCard`。除「金额窄屏降一档字号」
 * 与 `min-w-0 overflow-hidden` 外，两者逐类等价（同为 `card p-4` + 同款
 * label/icon/value/sub 骨架），故以 finance 版为底（它是超集）提到这里共用。
 *
 * - 值字号 1.2857rem → md:1.5714rem：窄屏换「一行放得下」，而不是换行撑破容器。
 * - `min-w-0`：栅格项默认 `min-width: auto`，金额不断行会把列顶宽 → 窄屏横向溢出；
 *   `overflow-hidden`：真撑不下时裁掉，也不许外溢到相邻卡或页面滚动区。
 */
export function StatCard({
  label,
  icon,
  iconCls,
  value,
  sub,
  valueCls = '',
}: {
  label: string
  icon: string
  iconCls: string
  /** 计数或已格式化金额（如「¥120,000」） */
  value: number | string
  sub?: string
  /** 值的前景色等附加类（如 `text-success` / `text-danger`） */
  valueCls?: string
}) {
  return (
    <Card className="min-w-0 overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <span className="text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
          {label}
        </span>
        <Icon
          name={icon}
          className={`flex h-8 w-8 items-center justify-center rounded-xl ${iconCls}`}
          size={18}
        />
      </div>
      <div
        className={`mt-1 whitespace-nowrap text-[1.2857rem] font-bold tracking-tight md:text-[1.5714rem] ${valueCls}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.7857rem] text-outline">{sub}</div>}
    </Card>
  )
}

const chipTones = {
  blue: 'bg-primary-fixed text-primary',
  green: 'bg-success-container/60 text-success',
  amber: 'bg-warning-container text-warning',
  red: 'bg-danger-container text-danger',
  gray: 'bg-surface-container-high text-on-surface-variant',
} as const

export function Chip({
  children,
  tone = 'gray',
  icon,
}: {
  children: ReactNode
  tone?: keyof typeof chipTones
  icon?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium ${chipTones[tone]}`}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  )
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.slice(0, 1)
  const hues = [216, 160, 28, 340, 260]
  const hue = hues[name.charCodeAt(0) % hues.length]
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `hsl(${hue} 70% 45%)`,
      }}
    >
      {initials}
    </div>
  )
}

export function EmptyState({
  icon = 'construction',
  title,
  description,
}: {
  icon?: string
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <Icon name={icon} className="text-[2.8571rem] text-outline" />
      <div className="text-[1.0714rem] font-medium">{title}</div>
      {description && (
        <div className="max-w-xs text-[0.9286rem] text-on-surface-variant">{description}</div>
      )}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[1.5714rem] font-bold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[0.9286rem] text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** 应用风格确认弹窗（替代浏览器原生 confirm） */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEscapeLayer(open, onCancel, 'dialog')
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Enter' && onConfirm()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onConfirm])

  const { present, phase, ref } = usePresence(open, 150)
  const closing = phase === 'out'

  if (!present) return null
  return (
    <div ref={ref} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/25 ${closing ? 'anim-overlay-out' : 'anim-overlay-in'}`}
        onClick={onCancel}
      />
      <div
        className={`relative w-full max-w-sm rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-[0_8px_32px_rgba(0,0,0,0.16)] ${
          closing ? 'anim-panel-out' : 'anim-panel-in'
        }`}
      >
        <h3 className="text-[1.0714rem] font-semibold">{title}</h3>
        {message && (
          <div className="mt-2 text-[0.9286rem] leading-relaxed text-on-surface-variant">
            {message}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 应用风格输入弹窗（替代浏览器原生 prompt），支持单行文本输入 */
export function PromptDialog({
  open,
  title,
  message,
  label,
  defaultValue = '',
  placeholder,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: ReactNode
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(defaultValue)

  // 每次打开时重置为默认值
  useEffect(() => {
    if (open) setValue(defaultValue)
  }, [open, defaultValue])

  useEscapeLayer(open, onCancel, 'dialog')

  const { present, phase, ref } = usePresence(open, 150)
  const closing = phase === 'out'

  if (!present) return null
  const submit = () => onConfirm(value.trim())
  return (
    <div ref={ref} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/25 ${closing ? 'anim-overlay-out' : 'anim-overlay-in'}`}
        onClick={onCancel}
      />
      <div
        className={`relative w-full max-w-sm rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-[0_8px_32px_rgba(0,0,0,0.16)] ${
          closing ? 'anim-panel-out' : 'anim-panel-in'
        }`}
      >
        <h3 className="text-[1.0714rem] font-semibold">{title}</h3>
        {message && (
          <div className="mt-2 text-[0.9286rem] leading-relaxed text-on-surface-variant">
            {message}
          </div>
        )}
        <div className="mt-4">
          {label && (
            <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
              {label}
            </div>
          )}
          <input
            className={inputCls}
            value={value}
            placeholder={placeholder}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button onClick={submit}>{confirmText}</Button>
        </div>
      </div>
    </div>
  )
}

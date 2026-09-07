import { type ReactNode, useEffect } from 'react'
import { Icon } from './Icon'

/** 基础组件库（对齐 DESIGN.md：白卡/8px 圆角/1px 边框/柔和阴影/胶囊 Chip） */

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
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div
        className="absolute right-0 top-0 flex h-full flex-col bg-surface-container-lowest shadow-[-8px_0_24px_rgba(0,0,0,0.10)]"
        style={{ width }}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant/40 px-5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
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
      <div className="mb-1.5 text-[12px] font-medium text-on-surface-variant">{label}</div>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13.5px] outline-none transition-shadow focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.15)]'


export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  onClick,
  className = '',
  disabled,
}: {
  children?: ReactNode
  variant?: 'primary' | 'ghost' | 'tonal' | 'danger'
  size?: 'sm' | 'md'
  icon?: string
  onClick?: () => void
  className?: string
  disabled?: boolean
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none'
  const sizes = size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4'
  const variants = {
    primary: 'bg-primary text-on-primary hover:bg-primary-container',
    ghost: 'border border-primary text-primary hover:bg-primary-fixed/50',
    tonal: 'bg-surface-container-high text-primary hover:bg-primary-fixed',
    danger: 'bg-danger text-on-primary hover:opacity-90',
  }[variant]
  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} onClick={onClick} disabled={disabled}>
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
}: {
  children: ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={`card ${hover ? 'card-hover cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
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
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${chipTones[tone]}`}
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
      <Icon name={icon} className="text-[40px] text-outline" />
      <div className="text-[15px] font-medium">{title}</div>
      {description && <div className="max-w-xs text-[13px] text-on-surface-variant">{description}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

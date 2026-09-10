/**
 * 功能配置页通用片段（Issue #86）
 * Section = 单个配置域卡片（图标 + 标题 + 说明 + 内容）；Toggle = 应用风格开关。
 * 供各模块配置面板复用：模块内只写配置逻辑，不重复造容器。
 */
import { Icon } from '@/design-system/Icon'
import { Card } from '@/design-system/ui'

export function Section({
  icon,
  title,
  desc,
  children,
}: {
  icon: string
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
          <Icon name={icon} size={18} />
        </div>
        <div className="flex-1">
          <h3 className="text-[1.0357rem] font-semibold">{title}</h3>
          <p className="mt-0.5 text-[0.8214rem] text-on-surface-variant">{desc}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-primary' : 'bg-outline-variant'
      }`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

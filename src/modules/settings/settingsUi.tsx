import { Icon } from '@/design-system/Icon'
import { Card } from '@/design-system/ui'
import type { SkinStyleId } from '@/shared/theme'

/**
 * 设置页共享基础件（**自 SettingsPage.tsx 拆出** · 审计 C-7/C-10 · 2026-10-21）
 *
 * 抽出理由：`SettingsPage.tsx` 曾 1648 行、8 个 tab 内联，本文件承担其中的
 * 「可复用容器」角色（SkinThumb / Section / Toggle / Segmented + 两个纯工具函数），
 * 使 tab 段可以被拆成独立文件而不各自复制这些容器。
 *
 * ⚠️ **Toggle 的实现口径**（收口 C-10 的一处真实漂移）：
 * 本仓原先有两份 Toggle —— 这里一份（`left-0.5 / left-[22px]`）与
 * `modules/moduleConfig/parts.tsx` 一份（`translate-x`）。后者已按 DESIGN.md 规则 1
 * 改为位移（`left` 每帧触发 layout，`translate` 只走合成层）。
 * 本文件**采用 translate 版本**，两份实现据此统一（视觉等价：44px 容器 − 20px 滑块 = 24px 行程）。
 *
 * ⚠️ **Segmented 未与 finance 版合并**：`modules/finance/FinancePage.tsx` 另有同名组件，
 * 但两者**视觉与签名都不同**（本版 `nav-item` 风格 + 泛型 `format`；finance 版
 * `bg-surface-container` 风格 + `{key,label}`）。合并会改变视觉，属**有回归风险的改动**，
 * 故本轮只记录差异、不做合并（避免「为去重而改外观」）。
 */

export function SkinThumb({ id }: { id: SkinStyleId }) {
  switch (id) {
    case 'pixel':
      return (
        <div className="flex flex-col items-center gap-1">
          <div
            className="h-6 w-12 border-2 border-on-surface bg-primary"
            style={{ borderRadius: 0, boxShadow: '3px 3px 0 0 var(--color-on-surface)' }}
          />
          <div className="h-1.5 w-8 bg-outline-variant" style={{ borderRadius: 0 }} />
        </div>
      )
    case 'cartoon':
      return (
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="h-6 w-12 rounded-lg border-2 border-outline bg-primary"
            style={{ boxShadow: '0 3px 6px rgba(0,0,0,0.15)' }}
          />
          <div className="h-1.5 w-8 rounded-full bg-outline-variant" />
        </div>
      )
    case 'cyber':
      return (
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="flex h-6 w-12 items-center justify-center border border-primary text-[0.6429rem] font-semibold tracking-widest text-primary"
            style={{
              clipPath:
                'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
              boxShadow: '0 0 8px 0 color-mix(in srgb, var(--color-primary) 40%, transparent)',
            }}
          >
            HUD
          </div>
          <div
            className="h-1.5 w-8"
            style={{
              background:
                'repeating-linear-gradient(90deg, var(--color-outline-variant) 0 2px, transparent 2px 5px)',
            }}
          />
        </div>
      )
    case 'glass':
      return (
        <div className="relative flex flex-col items-center gap-1.5">
          <div
            className="flex h-6 w-12 items-center justify-center rounded-2xl border border-white/60 bg-white/40 backdrop-blur-sm"
            style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
          >
            <span className="text-[0.6429rem] font-semibold text-on-surface-variant">Glass</span>
          </div>
          <span className="absolute -top-0.5 right-3 text-[0.7143rem] text-primary">✦</span>
          <span className="absolute -bottom-1 left-3 text-[0.5714rem] text-primary/70">✦</span>
          <div className="h-1.5 w-8 rounded-full bg-outline-variant" />
        </div>
      )
    default:
      return (
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="h-6 w-12 rounded-lg border border-outline-variant/60 bg-surface-container-lowest"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
          />
          <div className="h-1.5 w-8 rounded-full bg-outline-variant" />
        </div>
      )
  }
}

/**
 * 下载实现已收口到 `@/shared/download`（P2 #42）。
 * 原实现在此同步调用 `URL.revokeObjectURL`，Safari 下会在浏览器真正读到 Blob 之前
 * 就把对象 URL 释放掉 —— 表现为「点了导出没反应 / 文件 0 字节」，且只在换浏览器时暴露。
 */

/** CSV 序列化：含逗号/引号/换行的字段引号包裹转义，\uFEFF BOM 兼容 Excel 直开 */

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
}

/** Blob → base64 dataUrl（附件导出用：Blob 不可 JSON 序列化） */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function Section({
  icon,
  title,
  desc,
  badge,
  children,
}: {
  icon: string
  title: string
  desc?: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
          <Icon name={icon} size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[1.0357rem] font-semibold">{title}</h3>
            {badge && (
              <span className="rounded bg-success-container/60 px-1.5 py-0.5 text-[0.7143rem] font-medium text-success">
                {badge}
              </span>
            )}
          </div>
          {desc && <p className="mt-0.5 text-[0.8214rem] text-on-surface-variant">{desc}</p>}
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
      {/* 开关滑块：用 translate-x 而非 left 做位移 —— left 每帧触发 layout，translate 只走合成层
          （DESIGN.md 规则 1）。视觉等价：容器 w-11(44px) − 滑块 w-5(20px) = 24px 行程。
          此实现与 modules/moduleConfig/parts.tsx 统一（本轮收口 C-10 的漂移）。 */}
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-[calc(var(--motion-duration-base)*var(--motion-duration-scale))] ${
          checked ? 'translate-x-[24px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  format: (v: T) => string
}) {
  return (
    <div className="inline-flex nav-item !bg-transparent p-0.5">
      {options.map((opt) => (
        <button
          key={String(opt)}
          className={`rounded-md px-3 py-1.5 text-[0.8929rem] transition-colors ${
            opt === value
              ? 'bg-primary font-medium text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-hover'
          }`}
          onClick={() => onChange(opt)}
        >
          {format(opt)}
        </button>
      ))}
    </div>
  )
}

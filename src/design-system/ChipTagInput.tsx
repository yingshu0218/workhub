import { useState } from 'react'
import { inputCls } from './ui'
import type { CSSProperties } from 'react'

/**
 * 芯片标签手动输入（Issue #130 二次需求）：
 * 「输入 → 回车/逗号确认 → 固化成一枚可删芯片」的内联编辑控件。
 *
 * 抽成共享原子件的动因：客户档案的「标签」与「客户关系」都要这套交互，
 * 且**不能弹层** —— 两者都嵌在抽屉表单里，再开 Modal 会把表单输入状态顶掉、
 * 关闭后与表单不同步（用户反馈「换下拉后关系就丢了」的观感来源之一）。
 *
 * 语义与「其他表单里的标签类型」（笔记标签行 / 记账业务标签）保持同款：
 * 回车或逗号提交、支持一次性粘贴多个（中英文逗号都切）、退格删末个、
 * 失焦自动固化、按标签名 hash 恒定同色。
 */

/** 标签名 → 固定色相（与笔记模块 tagStyle 同口径：同一标签恒定同色） */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** 彩色芯片样式（同一文本恒定同色，供客户标签/关系语义共用） */
export function chipTagStyle(tag: string): CSSProperties {
  const h = hashStr(tag) % 360
  return {
    background: `hsl(${h} 85% 92%)`,
    color: `hsl(${h} 70% 28%)`,
  }
}

/** 输入串 → 归一化标签数组（中英文逗号切分 → trim → 去首 # → 去空 → 去重） */
export function parseTagInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，]/)
        .map((s) => s.trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ]
}

export default function ChipTagInput({
  value,
  onChange,
  placeholder,
  commitOnBlur = true,
  maxCount,
  onOverflow,
  renderValue,
}: {
  /** 已固化标签 */
  value: string[]
  /** 增删回调（已归一化、已去重） */
  onChange: (next: string[]) => void
  placeholder?: string
  /** 失焦时把未提交的输入固化（表单场景默认开，避免「输了没回车就点保存」丢标签） */
  commitOnBlur?: boolean
  /** 上限（超出由 onOverflow 提示，不静默丢弃） */
  maxCount?: number
  onOverflow?: () => void
  /** 自定义芯片内容（关系语义用「客户名 · 语义」展示） */
  renderValue?: (tag: string) => React.ReactNode
}) {
  const [draft, setDraft] = useState('')

  function commit(raw?: string) {
    const text = (raw ?? draft).trim()
    if (!text) {
      setDraft('')
      return
    }
    const parts = parseTagInput(text)
    setDraft('')
    if (parts.length === 0) return
    const next = [...value]
    for (const p of parts) {
      if (next.includes(p)) continue
      if (maxCount !== undefined && next.length >= maxCount) {
        onOverflow?.()
        break
      }
      next.push(p)
    }
    if (next.length !== value.length) onChange(next)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
      return
    }
    // 退格：输入框为空时删末个标签（与笔记/记账同款手感）
    if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div
      className={`${inputCls} flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5`}
      onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}
    >
      {value.map((t) => (
        <span
          key={t}
          className="flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium"
          style={chipTagStyle(t)}
        >
          {renderValue ? renderValue(t) : `#${t}`}
          <button
            className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
            title="移除"
            onClick={() => onChange(value.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-[120px] flex-1 bg-transparent text-[0.9286rem] outline-none"
        value={draft}
        onChange={(e) => {
          const v = e.target.value
          // 逗号即提交（支持连续粘贴多个标签）
          if (/[,，]/.test(v)) commit(v)
          else setDraft(v)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => commitOnBlur && commit()}
        placeholder={value.length === 0 ? placeholder : ''}
      />
    </div>
  )
}

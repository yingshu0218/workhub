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
 * 按标签名 hash 恒定同色。
 * **空白不作为分隔符**（见 CHIP_SEPARATORS 注释）：含空格的标签/客户名不能被拆散。
 *
 * ⚠️ 提交时机（Issue #130 第三次回归根因）：
 * 本控件**只在输入变更（onChange / 回车）时固化**，不挂在 `onBlur` 上。
 * 失焦固化听起来自然，但它依赖「浏览器真的把焦点从输入框移走」：
 * 打开抽屉时焦点被 `useAutoFocus` 抢到姓名框，用户直接去点「客户联想」芯片或「添加关系」，
 * 焦点根本没落在过输入框 → 不会有 blur → 输入被静默丢弃，观感与「保存不生效」完全一致。
 * 改为「敲下分隔符那一刻就固化」，提交不再依赖任何焦点事件；保存路径另外显式结算草稿
 * （见 CustomerFormDrawer 的 flush）。
 */

/**
 * 标签分隔符集合：**仅中英文逗号**（一次粘贴多个标签的拆分口径，单一来源）。
 *
 * ⚠️ 为什么不把空白算作分隔符：客户名 / 公司名 / 标签普遍含空格
 * （「深蓝 科技」「VIP Client」「重要 客户」）。若按空白切分，这类输入会被**静默拆散**：
 * 标签被拆成两枚；关联客户名被拆成两段后 `resolveTarget` 命中不了，
 * 报「未找到客户『深蓝』」，关系反而加不进去 —— 与本控件要修的「保存不生效」同源。
 * 故固化触发只剩回车与逗号：回车由 onKeyDown 提交整段，逗号由 onChange 当场固化。
 */
export const CHIP_SEPARATORS = /[,，]/

/** 末位是分隔符 → 该分隔符之前的片段视为「已确认」（在 change 里当场固化，不等失焦） */
function endsWithSeparator(v: string): boolean {
  return v.length > 0 && CHIP_SEPARATORS.test(v[v.length - 1])
}

/** 输入串 → 归一化标签数组（按逗号切分 → trim → 去首 # → 去空 → 去重） */
export function parseTagInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(CHIP_SEPARATORS)
        .map((s) => s.trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ]
}

/**
 * 受控输入的「当场固化」结算：末位逗号之前的全部片段立即提交，其余留在草稿里。
 * 返回 null 表示无需固化（草稿照原样收下，由保存路径结算）。
 */
export function committedInputValue(raw: string): { committed: string[]; draft: string } | null {
  if (!endsWithSeparator(raw)) return null
  const parts = raw.split(CHIP_SEPARATORS)
  const last = parts.pop() ?? ''
  const committed = parseTagInput(parts.join(','))
  if (committed.length === 0) {
    // 只有分隔符（如误敲逗号）：清掉分隔符，不留噪音
    return { committed: [], draft: last }
  }
  return { committed, draft: last }
}

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

export default function ChipTagInput({
  value,
  onChange,
  placeholder,
  maxCount,
  onOverflow,
  renderValue,
  onDraftChange,
}: {
  /** 已固化标签 */
  value: string[]
  /** 增删回调（已归一化、已去重） */
  onChange: (next: string[]) => void
  placeholder?: string
  /** 上限（超出由 onOverflow 提示，不静默丢弃） */
  maxCount?: number
  onOverflow?: () => void
  /** 自定义芯片内容（关系语义用「客户名 · 语义」展示） */
  renderValue?: (tag: string) => React.ReactNode
  /**
   * 未固化的草稿文本上报（供表单「保存时结算草稿」用，见 CustomerFormDrawer.settleDrafts）。
   * 控件自身不做失焦固化，草稿的最终归属由调用方的保存路径决定。
   */
  onDraftChange?: (draft: string) => void
}) {
  const [draft, setDraft] = useState('')

  function updateDraft(next: string) {
    setDraft(next)
    onDraftChange?.(next)
  }

  /** 追加若干标签（去重 + 上限，超出走 onOverflow 提示不静默丢） */
  function append(parts: string[], base: string[] = value): string[] {
    const next = [...base]
    for (const p of parts) {
      if (next.includes(p)) continue
      if (maxCount !== undefined && next.length >= maxCount) {
        onOverflow?.()
        break
      }
      next.push(p)
    }
    return next
  }

  /** 显式提交草稿（回车路径） */
  function commit(raw?: string) {
    const text = (raw ?? draft).trim()
    updateDraft('')
    if (!text) return
    const parts = parseTagInput(text)
    if (parts.length === 0) return
    const next = append(parts)
    if (next !== value) onChange(next)
  }

  /** 输入变更：末位分隔符 → 当场固化，不依赖失焦 */
  function onInputChange(raw: string) {
    const settled = committedInputValue(raw)
    if (!settled) {
      updateDraft(raw)
      return
    }
    updateDraft(settled.draft)
    if (settled.committed.length === 0) return
    const next = append(settled.committed)
    if (next !== value) onChange(next)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
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
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={value.length === 0 ? placeholder : ''}
      />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { inputCls } from '@/design-system/ui'

/** 模糊匹配：全部子序列命中即算匹配（如「深科」命中「深蓝科技」），优先级：前缀 > 子串 > 子序列 */
export function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return true
  const idx = t.indexOf(q)
  if (idx >= 0) return true
  // 子序列回退
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i >= q.length) return true
  }
  return false
}

/** 按匹配质量排序：子串命中在前，同质量按原顺序 */
export function fuzzySort<T>(items: T[], labelOf: (item: T) => string, query: string): T[] {
  const q = query.toLowerCase().trim()
  if (!q) return items
  return [...items]
    .map((item, i) => ({ item, i, score: labelOf(item).toLowerCase().indexOf(q) }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        if (a.score < 0) return 1
        if (b.score < 0) return -1
        return a.score - b.score
      }
      return a.i - b.i
    })
    .map((x) => x.item)
}

/** 候选项按归档状态沉底（归档项排最后，同状态保持原顺序），供「已归档」类候选统一使用 */
export function archivedLast<T extends { archived?: boolean }>(items: T[]): T[] {
  return [...items.filter((i) => !i.archived), ...items.filter((i) => i.archived)]
}

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
}: {
  value: string
  options: MatchOption[]
  placeholder: string
  emptyText: string
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.id === value)
  const matched = options.filter((o) => fuzzyMatch(o.label, query))
  // 归档沉底：先按匹配质量排序，再按 archived 沉底（稳定，两种顺序都保留）
  const filtered = archivedLast(fuzzySort(matched, (o) => o.label, query))
  // 「不关联」恒在首位（仅无已选时展示）
  const listItems: MatchOption[] = selected ? filtered : [{ id: '', label: '不关联' }, ...filtered]
  const safeIdx = Math.min(activeIdx, Math.max(0, listItems.length - 1))

  // 点外部关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function commit(id: string) {
    onChange(id)
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
    <div ref={boxRef} className="relative">
      {/* 已选回显条：可清除，点击主体重新展开候选 */}
      {selected ? (
        <div className="flex items-center justify-between rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]"
            title="点击重新选择"
            onClick={() => {
              setOpen(true)
              setActiveIdx(0)
            }}
          >
            <Icon name={selected.icon ?? 'person'} size={16} className="shrink-0 text-primary" />
            <span className="truncate font-medium">{selected.label}</span>
            {selected.sub && (
              <span className="shrink-0 text-[11px] text-outline">{selected.sub}</span>
            )}
          </button>
          <button
            className="shrink-0 rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
            title="清除关联"
            onClick={() => commit('')}
          >
            <Icon name="close" size={16} />
          </button>
          {open && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container-lowest py-1 shadow-lg">
              {listItems.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-outline">{emptyText}</div>
              ) : (
                listItems.map((o, i) => (
                  <button
                    key={o.id || '__none__'}
                    onClick={() => commit(o.id)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
                      i === safeIdx ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-container'
                    }`}
                  >
                    <Icon
                      name={o.id ? (o.icon ?? 'person') : 'person_off'}
                      size={15}
                      className="shrink-0 text-outline"
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.sub && <span className="shrink-0 text-[11px] text-outline">{o.sub}</span>}
                  </button>
                ))
              )}
            </div>
          )}
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
      {open && !selected && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container-lowest py-1 shadow-lg">
          {listItems.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-outline">{emptyText}</div>
          ) : (
            listItems.map((o, i) => (
              <button
                key={o.id || '__none__'}
                onClick={() => commit(o.id)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
                  i === safeIdx ? 'bg-primary-fixed text-primary' : 'hover:bg-surface-container'
                }`}
              >
                <Icon
                  name={o.id ? (o.icon ?? 'person') : 'person_off'}
                  size={15}
                  className="shrink-0 text-outline"
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.sub && <span className="shrink-0 text-[11px] text-outline">{o.sub}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

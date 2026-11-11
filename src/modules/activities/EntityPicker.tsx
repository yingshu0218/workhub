import { useState } from 'react'
import { usePersonalQuery, type Value } from '@/queries/personal'
import { inputCls } from '@/design-system/ui'
export default function EntityPicker({
  table,
  value,
  onChange,
  label,
}: {
  table: 'customers' | 'projects'
  value: string
  onChange: (id: string) => void
  label: string
}) {
  const [text, setText] = useState('')
  const search = usePersonalQuery(
    table === 'customers' ? 'resolve_contacts' : 'resolve_topics',
    { query: text },
    !!text.trim(),
  )
  const selected = usePersonalQuery(
    table === 'customers' ? 'resolve_contacts' : 'resolve_topics',
    { id: value },
    !!value,
  )
  const choices = (search.data?.candidates || []) as Value[],
    current = (selected.data?.candidates as Value[] | undefined)?.[0]
  return (
    <div className="space-y-1">
      <label className="block text-sm">
        {label}
        <input
          aria-label={label + '搜索'}
          className={inputCls}
          value={text}
          placeholder={current ? String(current.preferredName || current.name) : '按名称或别名搜索'}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {value ? (
        <button className="text-sm text-primary" onClick={() => onChange('')}>
          {String(current?.preferredName || current?.name || '已选择')} · 清除
        </button>
      ) : null}
      {search.error ? <p role="alert">{search.error}</p> : null}
      {text ? (
        <ul className="max-h-40 overflow-auto">
          {choices.map((c) => (
            <li key={String(c.id)}>
              <button
                className="w-full rounded p-2 text-left hover:bg-surface-hover"
                onClick={() => {
                  onChange(String(c.id))
                  setText('')
                }}
              >
                {String(c.preferredName || c.name)}
                {c.company ? ' · ' + String(c.company) : ''}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

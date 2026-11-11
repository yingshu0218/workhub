import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePersonalQuery, type Value } from '@/queries/personal'
import { isServerFirstWeb } from '@/platform/env'
import { db } from '@/db/db'
import { useCollection, useQuery } from '@/queries/hooks'
import { isImeComposing } from '@/shared/ime'
import { inputCls } from '@/design-system/ui'
import { filterBlacklisted, useIntimacyConfig } from '@/modules/crm/intimacy'
import type { Customer } from '@/db/types'
import type { Note } from '@/db/types'
import { recordPath } from '@/shared/records'
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 关闭时连查询组件都不挂载，避免背景订阅活动和整表建立索引。
  return open ? <SearchPanel onClose={onClose} /> : null
}
function SearchPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(''),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(0),
    input = useRef<HTMLInputElement>(null),
    navigate = useNavigate()
  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text)
      setActive(0)
    }, 180)
    return () => clearTimeout(timer)
  }, [text])
  const online = isServerFirstWeb()
  const local =
    useQuery(async () => {
      if (online || !query.trim()) return []
      const result: Value[] = []
      for (const table of [
        'activities',
        'customers',
        'projects',
        'todos',
        'transactions',
      ] as const) {
        const rows = await db
          .table(table)
          .filter(
            (r) =>
              !r.deleted &&
              String(r.title || r.name || r.summary || '')
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .limit(8)
          .toArray()
        result.push(
          ...rows.map((r) => ({
            id: r.id,
            title: r.title || r.name || r.summary,
            path: recordPath(table, r.id),
          })),
        )
      }
      return result
    }, [query, online]) || []
  const events = usePersonalQuery(
      'search_activities',
      { q: query, limit: 8 },
      !!query.trim() && online,
    ),
    contacts = usePersonalQuery('resolve_contacts', { query }, !!query.trim() && online),
    topics = usePersonalQuery('resolve_topics', { query }, !!query.trim() && online)
  const tasks = usePersonalQuery('query_tasks', { q: query, limit: 8 }, !!query.trim() && online),
    finance = usePersonalQuery('query_finance', { q: query, limit: 8 }, !!query.trim() && online)
  const notes = useCollection<Note>('notes', ['id', 'title', 'tags'])
  const intimacy = useIntimacyConfig(),
    people = useCollection<Customer>('customers', ['id', 'intimacy'])
  const visible = filterBlacklisted(people, intimacy, 'hideInSearch'),
    hidden = new Set(people.filter((c) => !visible.some((v) => v.id === c.id)).map((c) => c.id))
  const results: Value[] = [
    ...local.filter((r) => !hidden.has(String(r.id))),
    ...(tasks.data?.items || []),
    ...(finance.data?.items || []),
    ...((contacts.data?.candidates as Value[]) || [])
      .filter((r) => !hidden.has(String(r.id)))
      .map((r) => ({ ...r, path: recordPath('customers', r.id) })),
    ...((topics.data?.candidates as Value[]) || []).map((r) => ({
      ...r,
      path: recordPath('projects', r.id),
    })),
    ...(events.data?.items || []).map((r) => r.record as Value),
    ...notes
      .filter((n) => query && n.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8)
      .map((n) => ({ ...n, path: recordPath('notes', n.id) })),
  ]
  const index = Math.min(active, Math.max(0, results.length - 1))
  function go(path: string) {
    onClose()
    navigate(path)
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        className="w-[640px] max-w-[92vw] space-y-3 rounded-2xl bg-surface-container-lowest p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (isImeComposing(e.nativeEvent)) return
          if (e.key === 'Escape') onClose()
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((n) => (n + 1) % Math.max(1, results.length))
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((n) => (n - 1 + results.length) % Math.max(1, results.length))
          }
          if (e.key === 'Enter' && results[index]) go(String(results[index].path))
        }}
      >
        <div className="flex gap-3">
          <input
            ref={input}
            className={inputCls}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="全局搜索任务、联系人或笔记…"
            aria-label="搜索"
          />
          <button onClick={onClose}>关闭</button>
        </div>
        {events.error || contacts.error || topics.error ? (
          <p role="alert">{events.error || contacts.error || topics.error}</p>
        ) : null}
        <ul className="max-h-[45vh] overflow-auto">
          {results.map((row, i) => (
            <li key={String(row.path) + i}>
              <button
                className={
                  'w-full rounded-lg p-3 text-left ' +
                  (index === i ? 'bg-primary-fixed' : 'hover:bg-surface-hover')
                }
                onClick={() => go(String(row.path))}
              >
                {String(row.title || row.preferredName || row.name || row.summary)}
              </button>
            </li>
          ))}
        </ul>
        {query && !results.length ? <p>没有匹配结果</p> : null}
        <nav className="flex flex-wrap gap-4 text-primary">
          {[
            ['/', '记录事件'],
            ['/todo?new=1', '新建待办'],
            ['/finance?new=1', '记收支'],
            ['/notes', '笔记'],
          ].map(([to, label]) => (
            <Link key={to} to={to} onClick={onClose}>
              {label}
            </Link>
          ))}
        </nav>
      </section>
    </div>
  )
}

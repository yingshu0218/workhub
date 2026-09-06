import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import { buildSearchIndex, searchAll } from '@/shared/search'
import type { SearchItem } from '@/shared/search'
import type { Customer, Todo, Transaction, Note, Habit } from '@/db/types'
import { noteRepo, newId } from '@/repositories'

/**
 * ⌘K 全局命令面板（对齐原型 11-global-search）
 * 输入即搜 / ↑↓ 选择 / Enter 跳转 / Esc 关闭；底部快捷指令区（灵感闪现/记一笔/新建笔记）
 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [creatingNote, setCreatingNote] = useState(false)

  const customers = useCollection<Customer>('customers')
  const todos = useCollection<Todo>('todos')
  const transactions = useCollection<Transaction>('transactions')
  const notes = useCollection<Note>('notes')
  const habits = useCollection<Habit>('habits')

  const groups = useMemo(
    () =>
      searchAll(
        buildSearchIndex({ customers, todos, transactions, notes, habits }),
        query,
      ),
    [customers, todos, transactions, notes, habits, query],
  )
  const flat: (SearchItem & { icon: string })[] = useMemo(
    () => groups.flatMap((g) => g.items.map((it) => ({ ...it, icon: g.icon }))),
    [groups],
  )

  // 打开时重置并聚焦
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      // 等面板挂载后聚焦
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => setActive(0), [query])

  const go = (item: SearchItem) => {
    onClose()
    navigate(item.path)
  }

  const createNote = async () => {
    if (creatingNote) return
    setCreatingNote(true)
    try {
      const id = newId('note')
      await noteRepo.put({
        id,
        title: '未命名笔记',
        markdown: '',
        tags: [],
        backlinks: [],
        mentions: [],
        createdAt: Date.now(),
      })
      onClose()
      navigate(`/notes/${id}`)
    } finally {
      setCreatingNote(false)
    }
  }

  const quickActions = [
    { icon: 'bolt', label: '灵感闪现', desc: '随机抽取待办 / 核心人脉', kbd: '⌘R', run: () => { onClose(); navigate('/inspiration') } },
    { icon: 'post_add', label: '记一笔', desc: '录入应收/应付资金往来凭据', kbd: '⌘N', run: () => { onClose(); navigate('/finance') } },
    { icon: 'edit_note', label: '新建笔记', desc: '双向链接与思维白板', kbd: '⌘⇧N', run: () => void createNote() },
  ]

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 输入法组合中不处理（戒点④：IME isComposing）
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flat[active]
      if (item) go(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!open) return null
  let cursor = -1

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-[640px] max-w-[92vw] overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索输入 */}
        <div className="flex h-14 items-center gap-3 border-b border-outline-variant/40 px-5">
          <span className="material-symbols-rounded text-primary">search</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="全局搜索任务、客户或笔记…"
            className="h-full flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-outline"
          />
          <button className="text-outline hover:text-on-surface" onClick={onClose}>
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        {/* 结果分组 */}
        <div className="max-h-[46vh] overflow-y-auto px-2 py-2">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-outline">
              没有匹配「{query}」的结果
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.type} className="mb-1">
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-outline">
                  {g.label} <span className="ml-0.5 text-[10px] font-normal">{g.items.length}</span>
                </div>
                {g.items.map((it) => {
                  cursor += 1
                  const idx = cursor
                  return (
                    <button
                      key={`${it.type}-${it.id}`}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        idx === active ? 'bg-primary-fixed' : 'hover:bg-surface-container'
                      }`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(it)}
                    >
                      <span className={`material-symbols-rounded text-[18px] ${idx === active ? 'text-primary' : 'text-outline'}`}>
                        {g.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{it.title}</span>
                        {it.subtitle && (
                          <span className="block truncate text-[11.5px] text-on-surface-variant">{it.subtitle}</span>
                        )}
                      </span>
                      {idx === active && (
                        <kbd className="shrink-0 rounded bg-surface-container-high px-1.5 text-[10px] text-outline">↵</kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* 快捷指令区 */}
        <div className="border-t border-outline-variant/40 bg-surface-container-low/60 px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-outline">快捷指令 / Quick Actions</span>
            <span className="text-[10px] text-outline">寻鸽快速通道</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {quickActions.map((a) => (
              <button
                key={a.label}
                className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-3 py-2.5 text-left transition-colors hover:border-primary/60"
                onClick={a.run}
              >
                <div className="flex items-center justify-between">
                  <span className="material-symbols-rounded text-[18px] text-primary">{a.icon}</span>
                  <kbd className="rounded bg-surface-container-high px-1 text-[10px] text-outline">{a.kbd}</kbd>
                </div>
                <div className="mt-1.5 text-[12.5px] font-semibold">{a.label}</div>
                <div className="truncate text-[10.5px] text-outline">{a.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

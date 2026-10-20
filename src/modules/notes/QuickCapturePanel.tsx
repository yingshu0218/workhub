import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/design-system/Icon'
import { inputCls } from '@/design-system/ui'
import { settingsRepo } from '@/repositories/localAdmin'
import { saveQuickCapture } from './quickCapture'

const CONFIRM_MS = 2600

/**
 * 侧栏快速便签（Issue #70 定稿）—— 底部「border-t p-3」区块顶部的轻量折叠便签：
 * 折叠时仅一行空白输入框（无提示文字），点击/聚焦即输入；Enter 存、Esc/失焦收起；Shift+Enter 展开多行、
 * mod+Enter 提交。每次保存 = saveQuickCapture 落一条正式 Note（tag「速记」+ 默认目录）。
 * 保存即走，不内联展示历史条目，仅短暂提示并提供「查看」跳转对应笔记。
 *
 * `collapsed`（2026-10-19 侧栏伸缩）：侧栏收到 56px 图标轨时，整条便签收成一枚图标钮
 * （挂 title 提示）—— 否则窄轨里那行输入框会被压成一条缝。**刻意不给它点开输入的能力**：
 * 56px 里没法打字，鼠标悬浮会先让侧栏浮出（railOpen），届时 `collapsed` 已转 false、
 * 便签恢复完整形态，用户再点即可输入。
 */
export default function QuickCapture({ collapsed = false }: { collapsed?: boolean }) {
  const navigate = useNavigate()
  // open: 折叠 → 展开输入；multiline: 单行 → 多行 textarea
  const [open, setOpen] = useState(false)
  const [multiline, setMultiline] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  // 保存成功后的短暂确认态：非 null 时展示「已记入 · 查看」
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  // 展开单行时自动聚焦
  useEffect(() => {
    if (open && !multiline) inputRef.current?.focus()
  }, [open, multiline])

  // 保存成功的确认提示到时自动收起回占位行
  useEffect(() => {
    if (!savedNoteId) return
    const t = window.setTimeout(() => setSavedNoteId(null), CONFIRM_MS)
    return () => window.clearTimeout(t)
  }, [savedNoteId])

  const collapse = () => {
    setOpen(false)
    setMultiline(false)
  }

  const clearDraft = () => {
    setValue('')
    if (areaRef.current) areaRef.current.style.height = 'auto'
  }

  async function submit() {
    const content = value.trim()
    if (!content || saving) {
      clearDraft()
      collapse()
      return
    }
    setSaving(true)
    try {
      const settings = await settingsRepo.get()
      const id = await saveQuickCapture({
        content,
        folderId: settings.notes?.defaultFolderId,
      })
      clearDraft()
      collapse()
      setSavedNoteId(id)
    } finally {
      setSaving(false)
    }
  }

  function onKeyDownSingle(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      clearDraft()
      collapse()
    } else if (e.key === 'Enter' && e.shiftKey) {
      // Shift+Enter：展开为多行 textarea
      e.preventDefault()
      setMultiline(true)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  function onKeyDownArea(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      clearDraft()
      collapse()
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  // 单行展开后失焦收起（保存路径已主动 collapse，blur 不重复处理）
  function onBlur() {
    // 若正处于保存中/确认提示，避免闪烁
    if (saving) return
    window.setTimeout(() => {
      // 失焦时若有残留内容也一并清空收起
      clearDraft()
      collapse()
    }, 120)
  }

  // 保存成功确认行：展示后点击「查看」跳转笔记编辑态
  if (savedNoteId) {
    return (
      <button
        className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.9286rem] text-success hover:bg-success-container/40"
        onClick={() => navigate(`/notes/${savedNoteId}?edit=1`)}
        title="查看刚保存的速记"
      >
        <Icon name="edit_note" className="text-[1.1429rem] text-success" />
        <span className="flex-1 truncate">已记入速记</span>
        <Icon name="chevron_right" className="text-[1.0714rem] text-success" />
      </button>
    )
  }

  // 图标轨态：收成一枚图标钮（悬浮由侧栏 railOpen 接管后自然恢复完整形态）
  if (collapsed) {
    return (
      <button
        type="button"
        className="flex w-full items-center justify-center rounded-lg py-2 text-primary hover:bg-surface-hover"
        title="快速便签（悬停侧栏后展开输入）"
        aria-label="快速便签"
        onClick={() => {
          setOpen(true)
          setMultiline(false)
        }}
      >
        <Icon name="edit_note" className="text-[1.2857rem]" />
      </button>
    )
  }

  // 折叠态：一行占位，点击展开
  if (!open) {
    return (
      <button
        className="flex w-full items-center justify-center rounded-lg py-2 hover:bg-surface-hover"
        onClick={() => {
          setOpen(true)
          setMultiline(false)
        }}
        aria-label="快速便签"
      >
        <Icon name="edit_note" className="text-[1.2857rem] text-primary" />
      </button>
    )
  }

  // 展开态：单行输入 / 多行 textarea
  return multiline ? (
    <div className="mb-2">
      <textarea
        ref={areaRef}
        className={`${inputCls} min-h-12 resize-y`}
        aria-label="快速便签"
        value={value}
        rows={2}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDownArea}
        onBlur={onBlur}
        autoFocus
      />
    </div>
  ) : (
    <div className="mb-2">
      <input
        ref={inputRef}
        className={inputCls}
        aria-label="快速便签"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDownSingle}
        onBlur={onBlur}
      />
    </div>
  )
}

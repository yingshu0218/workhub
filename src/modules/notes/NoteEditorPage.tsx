import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate, useParams } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import { noteRepo } from '@/repositories'
import type { Note, NoteMention } from '@/db/types'
import type { Customer, Ledger, Todo } from '@/db/types'
import { Button, Card, Chip, EmptyState } from '@/design-system/ui'
import dayjs from 'dayjs'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { useBacklinks, useNoteRecord } from './hooks'
import { NOTE_PROSE_CSS, extractMentions, renderMarkdown, safeMentionLabel, tagStyle, wordCount } from './shared'

type SaveState = 'saved' | 'dirty' | 'saving'

type MentionType = NoteMention['type']

interface MentionItem {
  type: MentionType
  id: string
  label: string
  sub: string
}

const TYPE_META: Record<MentionType, { tab: string; cls: string }> = {
  customer: { tab: '客户', cls: 'md-mention-customer' },
  todo: { tab: '待办', cls: 'md-mention-todo' },
  ledger: { tab: '账本', cls: 'md-mention-ledger' },
}

/** 工具栏动作：linePrefix=true 时按行加前缀（标题/列表/引用），否则前后包裹选区/占位文本 */
interface MdAction {
  id: string
  title: string
  prefix: string
  suffix?: string
  placeholder: string
  linePrefix?: boolean
  /** 按钮内容；缺省用 label 文本（B/I/H1 等原型同款文字符号） */
  render?: () => ReactNode
}

const MD_ACTIONS: MdAction[] = [
  { id: 'bold', title: '粗体 **文本**', prefix: '**', suffix: '**', placeholder: '粗体文本', render: () => <span className="font-bold">B</span> },
  { id: 'italic', title: '斜体 *文本*', prefix: '*', suffix: '*', placeholder: '斜体文本', render: () => <span className="font-serif italic">I</span> },
  { id: 'h1', title: '一级标题 #', prefix: '# ', placeholder: '标题文本', linePrefix: true, render: () => <span className="font-mono text-[11px] font-semibold">H1</span> },
  { id: 'h2', title: '二级标题 ##', prefix: '## ', placeholder: '标题文本', linePrefix: true, render: () => <span className="font-mono text-[11px] font-semibold">H2</span> },
  { id: 'ul', title: '无序列表 -', prefix: '- ', placeholder: '列表项', linePrefix: true, render: () => <span className="text-[13px] leading-none">≡</span> },
  { id: 'ol', title: '有序列表 1.', prefix: '1. ', placeholder: '列表项', linePrefix: true, render: () => <span className="font-mono text-[11px]">1.</span> },
  { id: 'quote', title: '引用 >', prefix: '> ', placeholder: '引用内容', linePrefix: true, render: () => <span className="font-serif text-[14px] leading-none">❝</span> },
  { id: 'code', title: '行内代码 `', prefix: '`', suffix: '`', placeholder: '代码', render: () => <span className="font-mono text-[11px]">&lt;/&gt;</span> },
  { id: 'codeblock', title: '代码块 ```', prefix: '```\n', suffix: '\n```', placeholder: '代码块', render: () => <Icon name="data_object" size={14} /> },
  { id: 'link', title: '链接 [文本](url)', prefix: '[', suffix: '](https://)', placeholder: '链接文本', render: () => <Icon name="link" size={14} /> },
]

/** 分组边界（在哪些动作前插入分隔线）：标题组、列表组、代码组 */
const MD_GROUP_BREAKS = new Set(['h1', 'ul', 'codeblock'])

/** 笔记编辑页（对齐原型 12-team-notes 右侧工作区），路由 /notes/:id */
export default function NoteEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // 三态：undefined=加载中（直链首帧，不闪「不存在」）；null=确实不存在/已删除
  const note = useNoteRecord(id)

  if (note === undefined) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/notes')}>
          返回列表
        </Button>
        <Card className="mt-4 p-10">
          <div className="flex flex-col items-center gap-3 text-on-surface-variant">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-[13px]">笔记加载中…</span>
          </div>
        </Card>
      </div>
    )
  }

  if (note === null) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <Button variant="ghost" icon="arrow_back" onClick={() => navigate('/notes')}>
          返回列表
        </Button>
        <Card className="mt-4 p-6">
          <EmptyState icon="note_delete" title="笔记不存在或已删除" description="可能已被移除，返回列表查看其他笔记" />
        </Card>
      </div>
    )
  }

  // note 已就绪才挂载编辑器：CodeMirror 以首载 markdown 为初始文档，此后不再受外部刷新干扰
  return <NoteEditor key={note.id} note={note} />
}

function NoteEditor({ note }: { note: Note }) {
  const navigate = useNavigate()
  const customers = useCollection<Customer>('customers')
  const todos = useCollection<Todo>('todos')
  const ledgers = useCollection<Ledger>('ledgers')
  const backlinks = useBacklinks(note)

  // 本地编辑态（以旧记录为基底，保存时展开旧记录仅覆盖所属字段）
  const [title, setTitle] = useState(() => note.title)
  const [mdText, setMdText] = useState(() => note.markdown)
  const [tags, setTags] = useState<string[]>(() => note.tags)
  const [tagInput, setTagInput] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [mention, setMention] = useState<{ from: number; query: string; x: number; y: number } | null>(null)
  const [mentionTab, setMentionTab] = useState<MentionType>('customer')

  const noteRef = useRef(note)
  noteRef.current = note
  const titleRef = useRef(title)
  titleRef.current = title
  const mdRef = useRef(mdText)
  mdRef.current = mdText
  const tagsRef = useRef(tags)
  tagsRef.current = tags
  const mentionRef = useRef(mention)
  mentionRef.current = mention
  const panelRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dirtyRef = useRef(false)

  // ===== 自动保存：停顿 800ms 防抖 noteRepo.put =====
  const scheduleSaveRef = useRef<() => void>(() => {})
  function scheduleSave() {
    dirtyRef.current = true
    setSaveState('dirty')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flushSave(), 800)
  }
  scheduleSaveRef.current = scheduleSave

  async function flushSave() {
    clearTimeout(timerRef.current)
    const base = noteRef.current
    if (!dirtyRef.current || !base) return
    dirtyRef.current = false
    setSaveState('saving')
    // 删除竞态防复活（审计 P2-4）：put 前复查最新记录，若已被软删则放弃写入
    const latest = await noteRepo.get(base.id)
    if (!latest) {
      setSaveState('saved')
      return
    }
    await noteRepo.put({
      ...latest,
      title: titleRef.current.trim() || '未命名笔记',
      markdown: mdRef.current,
      tags: tagsRef.current,
      mentions: extractMentions(mdRef.current),
    })
    // 保存徽章防虚报（审计 P2-5）：await 期间可能有新输入，复查 dirty 再定态
    setSaveState(dirtyRef.current ? 'dirty' : 'saved')
  }

  // 卸载前兜底：有未保存改动立即落库（fire-and-forget）
  useEffect(
    () => () => {
      if (dirtyRef.current) void flushSave()
      clearTimeout(timerRef.current)
    },
    [],
  )

  // 刷新/关闭页面/切后台时兜底 flush（审计 P2-3：不丢尾部输入）
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void flushSave()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // ===== @提及浮层 =====
  function closeMention() {
    setMention(null)
  }

  function selectMentionItem(item: MentionItem) {
    const view = viewRef.current
    const m = mentionRef.current
    if (!view || !m) return
    const pos = view.state.selection.main.head
    // label 剔除 ]/) 防止 MENTION_RE 解析断裂（审计 P2-1）
    const insert = `@[${safeMentionLabel(item.label)}](${item.type}:${item.id}) `
    view.dispatch({
      changes: { from: m.from, to: pos, insert },
      selection: { anchor: m.from + insert.length },
    })
    view.focus()
    closeMention()
  }

  // ===== 工具栏：在光标/选区处插入 Markdown 语法 =====
  function applyMd(a: MdAction) {
    const view = viewRef.current
    if (!view) return
    const { state } = view
    const { from, to } = state.selection.main
    const sel = state.doc.sliceString(from, to)

    if (a.linePrefix) {
      // 行前缀类：选区跨行时逐行加前缀
      const lineFrom = state.doc.lineAt(from).from
      const body = sel || a.placeholder
      const inserted = body
        .split('\n')
        .map((l) => `${a.prefix}${l}`)
        .join('\n')
      view.dispatch({
        changes: { from: lineFrom, to, insert: inserted },
        selection: { anchor: lineFrom, head: lineFrom + inserted.length },
      })
    } else if (sel) {
      // 有选区：包裹选区，选区保持选中
      const inserted = `${a.prefix}${sel}${a.suffix ?? ''}`
      view.dispatch({
        changes: { from, to, insert: inserted },
        selection: { anchor: from + a.prefix.length, head: from + a.prefix.length + sel.length },
      })
    } else {
      // 无选区：插入占位文本并选中，方便直接输入覆盖
      const inserted = `${a.prefix}${a.placeholder}${a.suffix ?? ''}`
      view.dispatch({
        changes: { from, to, insert: inserted },
        selection: { anchor: from + a.prefix.length, head: from + a.prefix.length + a.placeholder.length },
      })
    }
    view.focus()
    // docChanged 由 updateListener 捕获 → 自动走 scheduleSave 防抖落库
  }

  const mentionItems = useMemo<MentionItem[]>(() => {
    const kw = mention?.query.trim().toLowerCase() ?? ''
    const match = (label: string) => !kw || label.toLowerCase().includes(kw)
    return [
      ...customers.map<MentionItem>((c) => ({
        type: 'customer',
        id: c.id,
        label: c.company ? `${c.company} · ${c.name}` : c.name,
        sub: c.title,
      })),
      ...todos.map<MentionItem>((t) => ({
        type: 'todo',
        id: t.id,
        label: t.title,
        sub: `${t.priority} · ${t.status === 'done' ? '已完成' : '进行中'}`,
      })),
      ...ledgers.map<MentionItem>((l) => ({ type: 'ledger', id: l.id, label: l.name, sub: l.currency })),
    ].filter((it) => it.type === mentionTab && match(it.label))
  }, [customers, todos, ledgers, mentionTab, mention?.query])

  // ===== CodeMirror 初始化 =====
  useEffect(() => {
    const parent = document.getElementById('note-cm-host')
    if (!parent) return
    const view = new EditorView({
      state: EditorState.create({
        doc: mdRef.current,
        extensions: [
          lineNumbers(),
          placeholder('开始写点什么…\n键入 @ 唤起 客户 / 待办 / 账本 选择器'),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.7' },
            '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--color-outline-variant)' },
            '.cm-activeLine': { background: 'var(--color-surface-container-low)' },
            '.cm-activeLineGutter': { background: 'transparent', color: 'var(--color-outline)' },
            '.cm-placeholder': { color: 'var(--color-outline)' },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const text = u.state.doc.toString()
              mdRef.current = text
              setMdText(text)
              scheduleSaveRef.current()
            }
            if (!u.docChanged && !u.selectionSet) return
            const pos = u.state.selection.main.head
            const m = mentionRef.current
            if (u.docChanged) {
              // 刚键入 '@'：打开浮层并记录 '@' 位置
              let typed = ''
              u.changes.iterChanges((_fA, _tA, _fB, _tB, inserted) => {
                typed = inserted.toString()
              })
              if (typed.endsWith('@')) {
                const coords = view.coordsAtPos(pos)
                setMention({
                  from: pos - 1,
                  query: '',
                  x: coords?.left ?? 200,
                  y: (coords?.bottom ?? 200) + 6,
                })
                setMentionTab('customer')
                return
              }
              // 浮层已开：光标后的输入即筛选词；出现空白/超长即关闭
              if (m) {
                if (pos <= m.from) {
                  closeMention()
                } else {
                  const q = u.state.doc.sliceString(m.from + 1, pos)
                  if (q.length > 24 || /[\s@]/.test(q)) closeMention()
                  else setMention({ ...m, query: q })
                }
              }
            } else if (m && (pos <= m.from || pos > m.from + 1 + m.query.length)) {
              // 光标移出提及范围：关闭
              closeMention()
            }
          }),
        ],
      }),
      parent,
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // 浮层打开时：点击外部 / Esc 关闭（面板内 mousedown 已阻止默认，不丢 CM 焦点）
  useEffect(() => {
    if (!mention) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      closeMention()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMention()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [mention])

  // ===== 标签编辑（逗号分隔） =====
  function addTagsFromInput(v: string) {
    const parts = v
      .split(/[,，]/)
      .map((s) => s.trim().replace(/^#/, ''))
      .filter(Boolean)
    if (parts.length === 0) return
    const next = [...new Set([...tagsRef.current, ...parts])]
    tagsRef.current = next
    setTags(next)
    setTagInput('')
    scheduleSave()
  }

  function removeTag(tag: string) {
    const next = tagsRef.current.filter((t) => t !== tag)
    tagsRef.current = next
    setTags(next)
    scheduleSave()
  }

  // ===== 导出 .md（延时 revoke，兼容 Safari） =====
  function exportMd() {
    const blob = new Blob([mdRef.current], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(titleRef.current.trim() || '未命名笔记').replace(/[\\/:*?"<>|]/g, '_')}.md`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  // ===== 删除（软删 + 跳回列表） =====
  async function handleDelete() {
    if (!window.confirm(`确认删除笔记「${noteRef.current.title}」？`)) return
    clearTimeout(timerRef.current)
    dirtyRef.current = false
    await noteRepo.softDelete(noteRef.current.id)
    navigate('/notes')
  }

  const html = useMemo(() => renderMarkdown(mdText), [mdText])
  const words = wordCount(mdText)
  const jumpTarget: Record<MentionType, (id: string) => string> = {
    customer: (eid) => `/crm/${eid}`,
    todo: () => '/todo',
    ledger: () => '/finance',
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 104px)' }}>
      {/* 预览区排版样式（模块内注入，限定 .note-prose 作用域） */}
      <style>{NOTE_PROSE_CSS}</style>

      {/* 顶部：返回 / 标题 / 保存状态 / 字数 / 操作 */}
      <div className="flex shrink-0 items-center gap-3 pb-3">
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          onClick={() => navigate('/notes')}
          title="返回列表"
        >
          <Icon name="arrow_back" />
        </button>
        <input
          className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-[18px] font-bold tracking-tight outline-none transition-colors hover:border-outline-variant/40 focus:border-primary"
          value={title}
          onChange={(e) => {
            titleRef.current = e.target.value
            setTitle(e.target.value)
            scheduleSave()
          }}
          placeholder="笔记标题…"
        />
        <SaveBadge state={saveState} at={note.updatedAt} />
        <span className="shrink-0 rounded bg-surface-container-high px-2 py-1 text-[11px] font-medium text-on-surface-variant">
          {words.toLocaleString('zh-CN')} 字
        </span>
        <Button size="sm" variant="ghost" icon="download" onClick={exportMd}>
          导出
        </Button>
        <Button size="sm" variant="ghost" icon="delete" onClick={() => void handleDelete()}>
          删除
        </Button>
      </div>

      {/* 标签编辑行：彩色 Chip + 逗号分隔输入 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-3">
        {tags.map((t) => (
          <span
            key={t}
            className="flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium"
            style={tagStyle(t)}
          >
            #{t}
            <button
              className="opacity-60 transition-opacity hover:opacity-100"
              onClick={() => removeTag(t)}
              title="移除标签"
            >
              <Icon name="close" size={13} />
            </button>
          </span>
        ))}
        <input
          className="w-44 rounded-full bg-surface-container-low px-2.5 py-0.5 text-[12px] outline-none transition-colors placeholder:text-outline focus:bg-surface-container-high"
          value={tagInput}
          onChange={(e) => {
            const v = e.target.value
            // 逗号即提交（支持连续粘贴多个）
            if (/[,，]/.test(v)) addTagsFromInput(v)
            else setTagInput(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTagsFromInput(tagInput)
            if (e.key === 'Backspace' && tagInput === '' && tagsRef.current.length > 0) {
              removeTag(tagsRef.current[tagsRef.current.length - 1])
            }
          }}
          onBlur={() => tagInput.trim() && addTagsFromInput(tagInput)}
          placeholder="+ 回车或逗号添加标签"
        />
      </div>

      {/* 双栏编辑 + 预览 + 侧栏 */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm">
        {/* 左：CodeMirror 源码 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-outline-variant/30 bg-surface-container-low/40 px-4 py-1.5 text-[11px] font-medium tracking-wide text-outline">
            <span>MARKDOWN SOURCE EDITOR</span>
            <span>键入 @ 提及实体</span>
          </div>
          {/* 格式工具栏（对齐原型 12）：onMouseDown 阻断默认行为，保持 CodeMirror 光标与选区 */}
          <div className="flex flex-wrap items-center gap-0.5 border-b border-outline-variant/30 bg-surface-container-low/60 px-2 py-1">
            {MD_ACTIONS.map((a) => (
              <span key={a.id} className="flex items-center">
                {MD_GROUP_BREAKS.has(a.id) && <span className="mx-1 h-4 w-px bg-outline-variant/40" />}
                <button
                  type="button"
                  title={a.title}
                  className="flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyMd(a)}
                >
                  {a.render ? a.render() : a.id}
                </button>
              </span>
            ))}
          </div>
          <div id="note-cm-host" className="min-h-0 flex-1 overflow-hidden" />
        </div>

        {/* 右：marked 实时预览 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-outline-variant/30">
          <div className="flex items-center justify-between border-b border-outline-variant/30 bg-surface-container-low/40 px-4 py-1.5 text-[11px] font-medium tracking-wide text-outline">
            <span>LIVE PREVIEW</span>
            <span className="flex items-center gap-1 text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              实时渲染
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="note-prose" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>

        {/* 详情侧栏：反向链接 + @提及实体 */}
        <div className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l border-outline-variant/30 bg-surface-container-low/30 p-4 xl:flex">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
            反向链接（{backlinks.length}）
          </div>
          {backlinks.length === 0 ? (
            <div className="mb-5 text-[12px] leading-relaxed text-outline">
              暂无。在其他笔记中 @「{title.trim() || '本笔记'}」即可建立链接。
            </div>
          ) : (
            <div className="mb-5 space-y-1.5">
              {backlinks.map((b) => (
                <button
                  key={b.id}
                  onClick={() => navigate(`/notes/${b.id}`)}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-2.5 py-1.5 text-left text-[12px] transition-colors hover:border-primary"
                >
                  <Icon name="link" className="shrink-0 text-[14px] text-primary" />
                  <span className="truncate">{b.title}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
            @提及实体（{note.mentions.length}）
          </div>
          {note.mentions.length === 0 ? (
            <div className="text-[12px] leading-relaxed text-outline">在正文中键入 @ 关联客户、待办或账本。</div>
          ) : (
            <div className="space-y-1.5">
              {note.mentions.map((m) => (
                <button
                  key={`${m.type}:${m.id}`}
                  onClick={() => navigate(jumpTarget[m.type](m.id))}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-2.5 py-1.5 text-left text-[12px] transition-colors hover:border-primary"
                  title={`跳转${TYPE_META[m.type].tab}`}
                >
                  <span className={`md-mention ${TYPE_META[m.type].cls}`}>@</span>
                  <span className="truncate">{m.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* @提及浮层（客户 / 待办 / 账本 三类 tab） */}
      {mention && (
        <div
          ref={panelRef}
          className="fixed z-50 w-80 overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-[0_8px_28px_rgba(0,0,0,0.14)]"
          style={{ left: Math.min(mention.x, window.innerWidth - 340), top: mention.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex gap-1 border-b border-outline-variant/30 bg-surface-container-low/50 px-2 py-1.5">
            {(Object.keys(TYPE_META) as MentionType[]).map((t) => (
              <button
                key={t}
                onClick={() => setMentionTab(t)}
                className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                  mentionTab === t
                    ? 'bg-primary font-semibold text-on-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {TYPE_META[t].tab}
              </button>
            ))}
            <span className="ml-auto self-center pr-1 text-[11px] text-outline">Esc 关闭</span>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {mentionItems.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-outline">无匹配项</div>
            ) : (
              mentionItems.map((it) => (
                <button
                  key={it.id}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-container-low"
                  onClick={() => selectMentionItem(it)}
                >
                  <span className={`md-mention ${TYPE_META[it.type].cls}`}>@</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{it.label}</span>
                    {it.sub && <span className="block truncate text-[11px] text-outline">{it.sub}</span>}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SaveBadge({ state, at }: { state: SaveState; at: number }) {
  if (state === 'saving')
    return (
      <Chip tone="blue" icon="sync">
        保存中…
      </Chip>
    )
  if (state === 'dirty')
    return (
      <Chip tone="gray" icon="edit">
        编辑中…
      </Chip>
    )
  return (
    <Chip tone="green" icon="cloud_done">
      已保存 {dayjs(at).format('HH:mm')}
    </Chip>
  )
}

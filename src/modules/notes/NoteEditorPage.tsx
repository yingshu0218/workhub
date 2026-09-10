import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import { noteRepo } from '@/repositories'
import type { Note, NoteMention } from '@/db/types'
import type { Customer, Ledger, Todo, Project } from '@/db/types'
import { Button, Card, Chip, ConfirmDialog, EmptyState } from '@/design-system/ui'
import { archivedLast, fuzzyMatch, fuzzySort, MatchCombobox } from '@/design-system/MatchCombobox'
import { toArchivedFlag } from '@/shared/search'
import dayjs from 'dayjs'
import { todoStatusLabel } from '@/modules/todo/domain'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { useBacklinks, useNoteRecord } from './hooks'
import { useIntimacyConfig, resolveIntimacyLevel } from '@/modules/crm/intimacy'
import { useCustomerScoreRows } from '@/modules/crm/hooks'
import { resolveHealthScoreDisplay } from '@/modules/crm/healthScore'
import { useProjects, moveNoteToProject } from '@/modules/projects/hooks'
import {
  NOTE_PROSE_CSS,
  extractMentions,
  renderMarkdown,
  safeMentionLabel,
  tagStyle,
  wordCount,
} from './shared'

type SaveState = 'saved' | 'dirty' | 'saving'

type MentionType = NoteMention['type']

interface MentionItem {
  type: MentionType
  id: string
  label: string
  sub: string
  /** 项目候选拓展位：命中对象透传给联动逻辑（selectProject 后切 Tab） */
  project?: Project
  /** 归档标记（项目已归档）：候选项排序沉底 */
  archived?: boolean
}

/** 悬浮卡片状态（Issue #50）：编辑态点击关联主体/反向链接时弹出，不离开编辑器 */
type HoverCardState =
  | null
  | { kind: 'mention'; type: MentionType; eid: string; label: string }
  | { kind: 'backlink'; noteId: string; title: string }

/** @提及浮层 tab 维度：四类实体横向标签页，交互逻辑统一（Issue #50） */
type MentionsTab = MentionType
const MENTIONS_TABS: MentionsTab[] = ['customer', 'todo', 'ledger', 'project']

const TYPE_META: Record<MentionType, { tab: string; cls: string }> = {
  customer: { tab: '客户', cls: 'md-mention-customer' },
  todo: { tab: '待办', cls: 'md-mention-todo' },
  ledger: { tab: '账本', cls: 'md-mention-ledger' },
  project: { tab: '项目', cls: 'md-mention-project' },
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
  {
    id: 'bold',
    title: '粗体 **文本**',
    prefix: '**',
    suffix: '**',
    placeholder: '粗体文本',
    render: () => <span className="font-bold">B</span>,
  },
  {
    id: 'italic',
    title: '斜体 *文本*',
    prefix: '*',
    suffix: '*',
    placeholder: '斜体文本',
    render: () => <span className="font-serif italic">I</span>,
  },
  {
    id: 'h1',
    title: '一级标题 #',
    prefix: '# ',
    placeholder: '标题文本',
    linePrefix: true,
    render: () => <span className="font-mono text-[0.7857rem] font-semibold">H1</span>,
  },
  {
    id: 'h2',
    title: '二级标题 ##',
    prefix: '## ',
    placeholder: '标题文本',
    linePrefix: true,
    render: () => <span className="font-mono text-[0.7857rem] font-semibold">H2</span>,
  },
  {
    id: 'ul',
    title: '无序列表 -',
    prefix: '- ',
    placeholder: '列表项',
    linePrefix: true,
    render: () => <span className="text-[0.9286rem] leading-none">≡</span>,
  },
  {
    id: 'ol',
    title: '有序列表 1.',
    prefix: '1. ',
    placeholder: '列表项',
    linePrefix: true,
    render: () => <span className="font-mono text-[0.7857rem]">1.</span>,
  },
  {
    id: 'quote',
    title: '引用 >',
    prefix: '> ',
    placeholder: '引用内容',
    linePrefix: true,
    render: () => <span className="font-serif text-[1rem] leading-none">❝</span>,
  },
  {
    id: 'code',
    title: '行内代码 `',
    prefix: '`',
    suffix: '`',
    placeholder: '代码',
    render: () => <span className="font-mono text-[0.7857rem]">&lt;/&gt;</span>,
  },
  {
    id: 'codeblock',
    title: '代码块 ```',
    prefix: '```\n',
    suffix: '\n```',
    placeholder: '代码块',
    render: () => <Icon name="data_object" size={14} />,
  },
  {
    id: 'link',
    title: '链接 [文本](url)',
    prefix: '[',
    suffix: '](https://)',
    placeholder: '链接文本',
    render: () => <Icon name="link" size={14} />,
  },
]

/** 分组边界（在哪些动作前插入分隔线）：标题组、列表组、代码组 */
const MD_GROUP_BREAKS = new Set(['h1', 'ul', 'codeblock'])

/** 笔记查看/编辑页（对齐原型 12-team-notes 右侧工作区），路由 /notes/:id（?edit=1 进编辑，缺省只读查看） */
export default function NoteEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
            <span className="text-[0.9286rem]">笔记加载中…</span>
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
          <EmptyState
            icon="note_alt"
            title="笔记不存在或已删除"
            description="可能已被移除，返回列表查看其他笔记"
          />
        </Card>
      </div>
    )
  }

  // note 已就绪才挂载编辑器：CodeMirror 以首载 markdown 为初始文档，此后不再受外部刷新干扰
  // 列表/跳转默认进入只读查看态；?edit=1（新建/显式编辑）才进入编辑态
  const editing = searchParams.get('edit') === '1'
  return <NoteEditor key={note.id} note={note} initialEditing={editing} />
}

function NoteEditor({ note, initialEditing }: { note: Note; initialEditing: boolean }) {
  const navigate = useNavigate()
  const setSearchParams = useSearchParams()[1]
  // 查看态/编辑态：查看态隐藏编辑工具、渲染 markdown 成品；点「编辑」切换
  const [editing, setEditing] = useState(() => initialEditing)

  function enterEdit() {
    setEditing(true)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('edit', '1')
        return next
      },
      { replace: true },
    )
  }

  function exitEdit() {
    setEditing(false)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('edit')
        return next
      },
      { replace: true },
    )
  }
  const customers = useCollection<Customer>('customers')
  // 健康分算法兜底入参（Issue #108）：只算未手动设置档位的客户，悬停摘要与详情/列表口径一致
  const intimacyCfg = useIntimacyConfig()
  const scoreRows = useCustomerScoreRows(
    customers.filter((c) => !c.intimacy?.level).map((c) => c.id),
  )
  const todos = useCollection<Todo>('todos')
  const ledgers = useCollection<Ledger>('ledgers')
  // @提及「项目」tab 候选源（须在 mentionItems useMemo 之前声明并纳入依赖）
  const mentionProjects = useProjects()
  const backlinks = useBacklinks(note)

  // 本地编辑态（以旧记录为基底，保存时展开旧记录仅覆盖所属字段）
  const [title, setTitle] = useState(() => note.title)
  const [mdText, setMdText] = useState(() => note.markdown)
  const [tags, setTags] = useState<string[]>(() => note.tags)
  const [tagInput, setTagInput] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [mention, setMention] = useState<{
    from: number
    query: string
    x: number
    y: number
  } | null>(null)
  const [mentionTab, setMentionTab] = useState<MentionsTab>('customer')
  // 浮层键盘高亮项（↑↓ 移动 / Enter 选中；候选列表变化时由 mentionItems 计算处收敛范围）
  const [activeIdx, setActiveIdx] = useState(0)
  // Issue #50 悬浮卡片：编辑态点击关联主体/反向链接不再跳转，就地弹卡展示摘要
  const [hoverCard, setHoverCard] = useState<HoverCardState>(null)
  // 删除确认弹窗（应用风格，替代 window.confirm）
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; title: string } | null>(null)

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
  // 浮层顶部筛选输入框：@ 唤起后主输入落在这里，正文不再参与筛选词提取（Issue #50）
  const mentionInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const handleMentionNavRef = useRef<(key: string) => boolean>(() => false)
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
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void flushSave()
      clearTimeout(timerRef.current)
    }
  })

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
    // 关闭后焦点还给编辑器（搜索框输入/键盘选择/Esc/外点关闭均不丢写作焦点）
    viewRef.current?.focus()
  }

  /** 键入 @ 后打开浮层：记录 @ 位置，筛选词主输入迁移到浮层顶部输入框（Issue #50） */
  function openMention(from: number, x: number, y: number) {
    setMention({ from, query: '', x, y })
    setMentionTab('customer')
    setActiveIdx(0)
  }

  function selectMentionItem(item: MentionItem) {
    const view = viewRef.current
    const m = mentionRef.current
    if (!view || !m) return
    // label 剔除 ]/) 防止 MENTION_RE 解析断裂（审计 P2-1）；筛选词在输入框里，正文只需替换 @ 符号
    const insert = `@[${safeMentionLabel(item.label)}](${item.type}:${item.id}) `
    view.dispatch({
      changes: { from: m.from, to: m.from + 1, insert },
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
        selection: {
          anchor: from + a.prefix.length,
          head: from + a.prefix.length + a.placeholder.length,
        },
      })
    }
    view.focus()
    // docChanged 由 updateListener 捕获 → 自动走 scheduleSave 防抖落库
  }

  const mentionItems = useMemo<MentionItem[]>(() => {
    const kw = mention?.query.trim() ?? ''
    // Issue #50 模糊匹配：label 主匹配 + sub 次要文案参与匹配范围（仅命中判定，不参与排序权重），
    // 复用 MatchCombobox 的 fuzzyMatch（子串 + 子序列）与 fuzzySort（前缀 > 子串 > 子序列，同质量稳定）
    const match = (it: MentionItem) => !kw || fuzzyMatch(it.label, kw) || fuzzyMatch(it.sub, kw)
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
        sub: `${t.priority} · ${todoStatusLabel(t)}`,
      })),
      ...ledgers.map<MentionItem>((l) => ({
        type: 'ledger',
        id: l.id,
        label: l.name,
        sub: l.currency,
      })),
      ...mentionProjects.map<MentionItem>((p) => ({
        type: 'project' as const,
        id: p.id,
        label: p.name,
        sub: p.status === 'archived' ? '已归档' : p.status === 'paused' ? '已搁置' : '进行中',
        project: p,
        ...toArchivedFlag(p),
      })),
    ].filter((it) => it.type === mentionTab && match(it))
  }, [customers, todos, ledgers, mentionProjects, mentionTab, mention?.query])

  // 筛选结果先按匹配质量排序，再让归档项目沉底（fuzzySort 按 label 质量排序，同质量保持原顺序）
  const sortedMentionItems = useMemo(
    () => archivedLast(fuzzySort(mentionItems, (it) => it.label, mention?.query.trim() ?? '')),
    [mentionItems, mention?.query],
  )
  // 候选数量变化时收敛键盘高亮范围（切 Tab / 关浮层 / 输入过滤）
  const listLen = sortedMentionItems.length
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, listLen - 1)))
  }, [listLen, mentionTab])

  const safeActiveIdx = Math.min(activeIdx, Math.max(0, sortedMentionItems.length - 1))

  /**
   * 浮层键盘导航：↑↓ 移动高亮项、Enter 插入当前高亮候选、Esc 关闭。
   * 返回是否已处理：CodeMirror keymap 据此拦截按键（防止光标移动把浮层关掉）；
   * document 级监听兜底处理焦点不在编辑器时的按键（已 preventDefault 的事件跳过防二次触发）。
   * 仅认领 ↑↓/Enter/Esc 四键，编辑类按键一律返回 false 不拦截。
   */
  function handleMentionNav(key: string): boolean {
    if (!mentionRef.current) return false
    if (key === 'Escape') {
      closeMention()
      return true
    }
    // 编辑类按键（Backspace/Delete/普通字符等）不拦截：返回 false 保留浏览器默认编辑行为，
    // 否则搜索框文字删不掉（无匹配候选时 Backspace 曾被误吞，Issue #50 用户反馈）
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter' && key !== 'Escape') {
      return false
    }
    const len = sortedMentionItems.length
    if (len === 0) return true
    if (key === 'ArrowDown') {
      setActiveIdx((safeActiveIdx + 1) % len)
      return true
    }
    if (key === 'ArrowUp') {
      setActiveIdx((safeActiveIdx - 1 + len) % len)
      return true
    }
    if (key === 'Enter') {
      const item = sortedMentionItems[safeActiveIdx]
      if (item) selectMentionItem(item)
      return true
    }
    return false
  }
  handleMentionNavRef.current = handleMentionNav

  // ===== CodeMirror 初始化（仅编辑态挂载，退出编辑即销毁，卸载前 flush 兜底已覆盖） =====
  useEffect(() => {
    if (!editing) return
    const parent = document.getElementById('note-cm-host')
    if (!parent) return
    const view = new EditorView({
      state: EditorState.create({
        doc: mdRef.current,
        extensions: [
          lineNumbers(),
          // placeholder 必须单行：CodeMirror 以 inline-block widget 插入空文档行首，两行文本会把首行行盒撑成 2 行高
          placeholder('开始写点什么… 键入 @ 关联 客户 / 待办 / 账本 / 项目'),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          history(),
          // 浮层键盘导航（Issue #50）：置于 defaultKeymap 之前拦截 ↑↓/Enter/Esc，光标不再移动、浮层不被误关
          keymap.of([
            { key: 'ArrowDown', run: () => handleMentionNavRef.current('ArrowDown') },
            { key: 'ArrowUp', run: () => handleMentionNavRef.current('ArrowUp') },
            { key: 'Enter', run: () => handleMentionNavRef.current('Enter') },
            { key: 'Escape', run: () => handleMentionNavRef.current('Escape') },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': {
              overflow: 'auto',
              lineHeight: '1.7',
            },
            '.cm-gutters': {
              background: 'transparent',
              border: 'none',
              color: 'var(--color-outline-variant)',
            },
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
              // 刚键入 '@'：打开浮层并记录 '@' 位置；筛选词此后由浮层顶部输入框接管（Issue #50）
              let typed = ''
              u.changes.iterChanges((_fA, _tA, _fB, _tB, inserted) => {
                typed = inserted.toString()
              })
              if (typed.endsWith('@')) {
                const coords = view.coordsAtPos(pos)
                openMention(
                  pos - 1,
                  coords?.left ?? 200,
                  (coords?.bottom ?? 200) + 6,
                )
                return
              }
              // 浮层已开：删除 @ 或插入空白即关闭（正文不再承载筛选词）
              if (m && (pos <= m.from || /[\s@]/.test(u.state.doc.sliceString(pos - 1, pos)))) {
                closeMention()
              }
            } else if (m && pos <= m.from) {
              // 光标移出提及起始位置：关闭
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
  }, [editing])

  // 浮层打开时自动聚焦筛选输入框（键盘可直接输入模糊匹配词）
  const mentionOpen = mention !== null
  useEffect(() => {
    if (!mentionOpen) return
    mentionInputRef.current?.focus()
  }, [mentionOpen])

  // 浮层打开时：点击外部 / Esc 关闭（面板内 mousedown 已阻止默认，不丢 CM 焦点）
  useEffect(() => {
    if (!mention) return
    // 主输入迁移到浮层搜索框：打开即聚焦，后续筛选词都从这里输入（Issue #50）
    requestAnimationFrame(() => mentionInputRef.current?.focus())
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      closeMention()
    }
    const onKey = (e: KeyboardEvent) => {
      // CodeMirror keymap 已处理（preventDefault）的事件不再重复响应；IME 组合输入期间不触发选择
      if (e.defaultPrevented || e.isComposing) return
      // 搜索框自身的按键已由 input onKeyDown 处理，document 兜底不重复介入（防止对同一按键二次响应）
      if (mentionInputRef.current && e.target === mentionInputRef.current) return
      handleMentionNavRef.current(e.key)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [mention])

  // 悬浮卡片打开时：点击外部 / Esc 关闭（面板内 mousedown 阻止默认，不抢 CodeMirror 焦点）
  const hoverCardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hoverCard) return
    const onDown = (e: MouseEvent) => {
      if (hoverCardRef.current?.contains(e.target as Node)) return
      setHoverCard(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHoverCard(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [hoverCard])

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

  // ===== 删除（软删 + 跳回列表，应用风格确认弹窗） =====
  function handleDelete() {
    setConfirmDelete({ open: true, title: noteRef.current.title })
  }

  async function doDelete() {
    clearTimeout(timerRef.current)
    dirtyRef.current = false
    await noteRepo.softDelete(noteRef.current.id)
    setConfirmDelete(null)
    navigate('/notes')
  }

  const html = useMemo(() => renderMarkdown(mdText), [mdText])
  const words = wordCount(mdText)
  const jumpTarget: Record<MentionType, (id: string) => string> = {
    customer: (eid) => `/crm/${eid}`,
    todo: () => '/todo',
    ledger: () => '/finance',
    project: (eid) => `/projects/${eid}`,
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
        {editing ? (
          <input
            className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-[1.2857rem] font-bold tracking-tight outline-none transition-colors hover:border-outline-variant/40 focus:border-primary"
            value={title}
            onChange={(e) => {
              titleRef.current = e.target.value
              setTitle(e.target.value)
              scheduleSave()
            }}
            placeholder="笔记标题…"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate px-2 text-[1.4286rem] font-bold tracking-tight">
            {title.trim() || '未命名笔记'}
          </h1>
        )}
        {editing && <SaveBadge state={saveState} at={note.updatedAt} />}
        <span className="shrink-0 rounded bg-surface-container-high px-2 py-1 text-[0.7857rem] font-medium text-on-surface-variant">
          {words.toLocaleString('zh-CN')} 字
        </span>
        {editing ? (
          <>
            <Button size="sm" variant="ghost" icon="visibility" onClick={exitEdit}>
              完成
            </Button>
            <Button size="sm" variant="ghost" icon="download" onClick={exportMd}>
              导出
            </Button>
            <Button size="sm" variant="ghost" icon="delete" onClick={() => void handleDelete()}>
              删除
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" icon="edit" onClick={enterEdit}>
              编辑
            </Button>
            <Button size="sm" variant="ghost" icon="download" onClick={exportMd}>
              导出
            </Button>
            <Button size="sm" variant="ghost" icon="delete" onClick={() => void handleDelete()}>
              删除
            </Button>
          </>
        )}
      </div>

      {/* 标签行：编辑态可增删（彩色 Chip + 逗号分隔输入），查看态只读展示 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-3">
        {tags.map((t) => (
          <span
            key={t}
            className="flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium"
            style={tagStyle(t)}
          >
            #{t}
            {editing && (
              <button
                className="opacity-60 transition-opacity hover:opacity-100"
                onClick={() => removeTag(t)}
                title="移除标签"
              >
                <Icon name="close" size={13} />
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && !editing && (
          <span className="text-[0.8571rem] text-outline">暂无标签</span>
        )}
        {editing && (
          <input
            className="w-44 rounded-full bg-surface-container-low px-2.5 py-0.5 text-[0.8571rem] outline-none transition-colors placeholder:text-outline focus:bg-surface-container-high"
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
        )}
      </div>

      {/* 编辑态：双栏源码 + 实时预览；查看态：整宽最终渲染 */}
      <div className="flex min-h-0 flex-1 overflow-hidden surface-card-xl shadow-sm">
        {editing && (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-outline-variant/30 bg-surface-container-low/40 px-4 py-1.5 text-[0.7857rem] font-medium tracking-wide text-outline">
              <span>MARKDOWN SOURCE EDITOR</span>
              <span>键入 @ 提及实体</span>
            </div>
            {/* 格式工具栏（对齐原型 12）：onMouseDown 阻断默认行为，保持 CodeMirror 光标与选区 */}
            <div className="flex flex-wrap items-center gap-0.5 border-b border-outline-variant/30 bg-surface-container-low/60 px-2 py-1">
              {MD_ACTIONS.map((a) => (
                <span key={a.id} className="flex items-center">
                  {MD_GROUP_BREAKS.has(a.id) && (
                    <span className="mx-1 h-4 w-px bg-outline-variant/40" />
                  )}
                  <button
                    type="button"
                    title={a.title}
                    className="flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[0.8571rem] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
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
        )}

        {/* 预览：编辑态右栏实时渲染；查看态整宽（最终成品阅读） */}
        <div
          className={`flex min-w-0 flex-1 flex-col overflow-hidden ${editing ? 'border-l border-outline-variant/30' : ''}`}
        >
          <div className="flex items-center justify-between border-b border-outline-variant/30 bg-surface-container-low/40 px-4 py-1.5 text-[0.7857rem] font-medium tracking-wide text-outline">
            <span>{editing ? 'LIVE PREVIEW' : 'PREVIEW'}</span>
            {editing ? (
              <span className="flex items-center gap-1 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                实时渲染
              </span>
            ) : (
              <span className="flex items-center gap-1 text-outline">
                <Icon name="visibility" size={13} />
                查看模式
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div
              className="note-prose mx-auto max-w-[760px]"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>

        {/* 详情侧栏：反向链接 + @提及实体 */}
        <div className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l border-outline-variant/30 bg-surface-container-low/30 p-4 xl:flex">
          <div className="mb-2 text-[0.7857rem] font-medium uppercase tracking-wide text-on-surface-variant">
            反向链接（{backlinks.length}）
          </div>
          {backlinks.length === 0 ? (
            <div className="mb-5 text-[0.8571rem] leading-relaxed text-outline">
              暂无。在其他笔记中 @「{title.trim() || '本笔记'}」即可建立链接。
            </div>
          ) : (
            <div className="mb-5 space-y-1.5">
              {backlinks.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    // 编辑态弹悬浮卡片保持编辑现场；查看态直接跳转
                    if (editing) setHoverCard({ kind: 'backlink', noteId: b.id, title: b.title })
                    else navigate(`/notes/${b.id}`)
                  }}
                  className="flex w-full items-center gap-1.5 surface-card px-2.5 py-1.5 text-left text-[0.8571rem] transition-colors hover:border-primary"
                >
                  <Icon name="link" className="shrink-0 text-[1rem] text-primary" />
                  <span className="truncate">{b.title}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mb-2 text-[0.7857rem] font-medium uppercase tracking-wide text-on-surface-variant">
            所属项目
          </div>
          <div className="mb-5">
            <MatchCombobox
              value={note.projectId ?? ''}
              options={mentionProjects.map((p) => ({
                id: p.id,
                label: p.name,
                sub: p.status === 'archived' ? '已归档' : undefined,
                ...toArchivedFlag(p),
                icon: 'folder_open',
              }))}
              placeholder="输入项目名称模糊搜索"
              emptyText="没有匹配的项目"
              onChange={(id) => void moveNoteToProject(note.id, id || undefined)}
              onChangeMeta={() => {
                // Issue #50 联动：选完项目把 @提及 Tab 切到 project，保持心智一致
                setMentionTab('project')
              }}
            />
          </div>

          <div className="mb-2 text-[0.7857rem] font-medium uppercase tracking-wide text-on-surface-variant">
            @提及实体（{note.mentions.length}）
          </div>
          {note.mentions.length === 0 ? (
            <div className="text-[0.8571rem] leading-relaxed text-outline">
              在正文中键入 @ 关联客户、待办或账本。
            </div>
          ) : (
            <div className="space-y-1.5">
              {note.mentions.map((m) => (
                <button
                  key={`${m.type}:${m.id}`}
                  onClick={() => {
                    // 编辑态弹悬浮卡片保持编辑现场；查看态直接跳转
                    if (editing)
                      setHoverCard({ kind: 'mention', type: m.type, eid: m.id, label: m.label })
                    else navigate(jumpTarget[m.type](m.id))
                  }}
                  className="flex w-full items-center gap-1.5 surface-card px-2.5 py-1.5 text-left text-[0.8571rem] transition-colors hover:border-primary"
                  title={
                    editing ? `查看${TYPE_META[m.type].tab}摘要` : `跳转${TYPE_META[m.type].tab}`
                  }
                >
                  <span className={`md-mention ${TYPE_META[m.type].cls}`}>@</span>
                  <span className="truncate">{m.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 悬浮卡片（Issue #50）：编辑态点击关联主体/反向链接就地弹卡，不打断写作 */}
      {hoverCard && (
        <div className="fixed inset-0 z-40" onMouseDown={(e) => e.preventDefault()}>
          <div
            ref={hoverCardRef}
            className="fixed right-[17.5rem] top-1/3 w-72 surface-card-xl p-4 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {hoverCard.kind === 'mention' ? (
                  <span className={`md-mention ${TYPE_META[hoverCard.type].cls}`}>
                    @{hoverCard.label}
                  </span>
                ) : (
                  <>
                    <Icon name="link" size={14} className="shrink-0 text-primary" />
                    <span className="truncate text-[0.9286rem] font-medium">{hoverCard.title}</span>
                  </>
                )}
              </div>
              <button
                className="shrink-0 rounded p-0.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
                title="关闭"
                onClick={() => setHoverCard(null)}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="mb-3 border-t border-outline-variant/40 pt-2">
              {hoverCard.kind === 'mention' ? (
                <MentionEntitySummary
                  type={hoverCard.type}
                  eid={hoverCard.eid}
                  customers={customers}
                  todos={todos}
                  ledgers={ledgers}
                  projects={mentionProjects}
                  intimacyCfg={intimacyCfg}
                  scoreRows={scoreRows}
                />
              ) : (
                (() => {
                  const target = backlinks.find((b) => b.id === hoverCard.noteId)
                  if (!target) return <EntityMissing name="笔记" />
                  return (
                    <>
                      <CardRow label="标题" value={target.title || '未命名笔记'} />
                      <CardRow
                        label="更新于"
                        value={dayjs(target.updatedAt).format('YYYY-MM-DD HH:mm')}
                      />
                    </>
                  )
                })()
              )}
            </div>
            <Button
              size="sm"
              icon="open_in_new"
              className="w-full"
              onClick={() => {
                const target = hoverCard
                setHoverCard(null)
                navigate(
                  target.kind === 'mention'
                    ? jumpTarget[target.type](target.eid)
                    : `/notes/${target.noteId}`,
                )
              }}
            >
              打开详情
            </Button>
          </div>
        </div>
      )}

      {/* @提及浮层：顶部筛选输入框 + 客户/待办/账本/项目 四类横向 tab（Issue #50） */}
      {mention && (
        <div
          ref={panelRef}
          className="fixed z-50 w-80 overflow-hidden surface-card-xl border-outline-variant/60 shadow-[0_8px_28px_rgba(0,0,0,0.14)]"
          style={{ left: Math.min(mention.x, window.innerWidth - 340), top: mention.y }}
        >
          {/* 第一行：模糊匹配输入框（自动聚焦，筛选词在框内输入，不写进正文） */}
          <div className="border-b border-outline-variant/30 bg-surface-container-low/50 px-2.5 py-2">
            <input
              ref={mentionInputRef}
              value={mention.query}
              onChange={(e) => {
                setMention((prev) => (prev ? { ...prev, query: e.target.value } : prev))
                setActiveIdx(0)
              }}
              onKeyDown={(e) => {
                // IME 组合输入期间不拦截（避免打断中文/日文候选上屏）
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                const handled = handleMentionNav(e.key)
                if (handled) {
                  e.preventDefault()
                  e.stopPropagation()
                }
              }}
              placeholder="输入关键词模糊匹配…"
              className="w-full rounded-md border border-outline-variant/60 bg-surface px-2.5 py-1.5 text-[0.9286rem] text-on-surface outline-none placeholder:text-outline focus:border-primary"
            />
          </div>
          {/* 第二行：四类实体横向 tab，交互逻辑一致（点选即插入 @提及）
              onMouseDown preventDefault：不夺走输入框/编辑器焦点 */}
          <div
            className="flex items-center gap-1 border-b border-outline-variant/30 px-2 py-1.5"
            onMouseDown={(e) => e.preventDefault()}
          >
            {MENTIONS_TABS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setMentionTab(t)
                  setActiveIdx(0)
                  mentionInputRef.current?.focus()
                }}
                className={`rounded-md px-2.5 py-1 text-[0.8571rem] transition-colors ${
                  mentionTab === t
                    ? 'bg-primary font-semibold text-on-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {TYPE_META[t].tab}
              </button>
            ))}
            <span className="ml-auto self-center pr-1 text-[0.7857rem] text-outline">Esc 关闭</span>
          </div>
          {/* 候选列表（onMouseDown preventDefault 保住输入框焦点，键盘仍可继续操作） */}
          <div className="max-h-60 overflow-y-auto p-1" onMouseDown={(e) => e.preventDefault()}>
            {sortedMentionItems.length === 0 ? (
              <div className="px-3 py-4 text-center text-[0.8571rem] text-outline">无匹配项</div>
            ) : (
              sortedMentionItems.map((it, i) => (
                <button
                  key={it.id}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    i === safeActiveIdx
                      ? 'bg-primary-fixed text-primary'
                      : 'hover:bg-surface-container-low'
                  }`}
                  onClick={() => selectMentionItem(it)}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <span className={`md-mention ${TYPE_META[it.type].cls}`}>@</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9286rem] font-medium">
                      <MentionHighlight label={it.label} query={mention?.query ?? ''} />
                    </span>
                    {it.sub && (
                      <span className="block truncate text-[0.7857rem] text-outline">{it.sub}</span>
                    )}
                  </span>
                  {i === safeActiveIdx && (
                    <span className="shrink-0 text-[0.7143rem] text-primary">↵</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDelete?.open}
        title={`删除笔记「${confirmDelete?.title ?? ''}」`}
        message="删除后可在回收站恢复。"
        confirmText="删除"
        danger
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

/** 关键词命中片段高亮：仅纯前缀/包含段加粗着色，未命中原文返回 */
function MentionHighlight({ label, query }: { label: string; query: string }) {
  const kw = query.trim()
  if (!kw) return <>{label}</>
  const idx = label.toLowerCase().indexOf(kw.toLowerCase())
  if (idx < 0) return <>{label}</>
  return (
    <>
      {label.slice(0, idx)}
      <span className="font-semibold text-primary">{label.slice(idx, idx + kw.length)}</span>
      {label.slice(idx + kw.length)}
    </>
  )
}

/** 悬浮卡片实体摘要（按提及类型），数据缺失（实体已删）显示「已失效」占位 */
function MentionEntitySummary({
  type,
  eid,
  customers,
  todos,
  ledgers,
  projects,
  intimacyCfg,
  scoreRows,
}: {
  type: MentionType
  eid: string
  customers: Customer[]
  todos: Todo[]
  ledgers: Ledger[]
  projects: Project[]
  intimacyCfg: ReturnType<typeof useIntimacyConfig>
  /** 未手动设置档位的客户的算法入参（批次查询结果，Issue #108 健康分兜底） */
  scoreRows: Record<string, Parameters<typeof resolveIntimacyLevel>[2]>
}) {
  if (type === 'customer') {
    const c = customers.find((x) => x.id === eid)
    if (!c) return <EntityMissing name="客户" />
    // 健康分口径与详情/列表统一：未手动设置时由算法推断并用括号标注（Issue #108）
    const health = resolveHealthScoreDisplay(c, intimacyCfg, scoreRows[c.id] ?? null)
    return (
      <>
        <CardRow label="公司" value={c.company || '—'} />
        <CardRow label="职位" value={c.title || '—'} />
        <CardRow label="健康分" value={health.label} />
      </>
    )
  }
  if (type === 'todo') {
    const t = todos.find((x) => x.id === eid)
    if (!t) return <EntityMissing name="待办" />
    return (
      <>
        <CardRow
          label="状态"
          value={todoStatusLabel(t)}
        />
        <CardRow label="优先级" value={t.priority} />
        <CardRow label="截止" value={t.dueAt ? dayjs(t.dueAt).format('YYYY-MM-DD') : '无'} />
      </>
    )
  }
  if (type === 'ledger') {
    const l = ledgers.find((x) => x.id === eid)
    if (!l) return <EntityMissing name="账本" />
    return (
      <>
        <CardRow label="币种" value={l.currency} />
        <CardRow label="期初余额" value={String(l.openingBalance)} />
        <CardRow label="封账周期" value={l.closingCycle} />
      </>
    )
  }
  const pj = projects.find((x) => x.id === eid)
  if (!pj) return <EntityMissing name="项目" />
  return (
    <>
      <CardRow
        label="状态"
        value={pj.status === 'archived' ? '已归档' : pj.status === 'paused' ? '已搁置' : '进行中'}
      />
      {pj.customerId && (
        <CardRow
          label="挂靠客户"
          value={customers.find((c) => c.id === pj.customerId)?.name ?? '—'}
        />
      )}
    </>
  )
}

function CardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-[0.7857rem] text-outline">{label}</span>
      <span className="min-w-0 truncate text-right text-[0.8571rem] text-on-surface">{value}</span>
    </div>
  )
}

function EntityMissing({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[0.8571rem] text-outline">
      <Icon name="person_off" size={14} />原{name}已删除或不存在
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

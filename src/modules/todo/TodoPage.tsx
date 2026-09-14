import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCollection, useRecordState, resolveRecordDisplay, useSettings } from '@/queries/hooks'
import { todoRepo, newId } from '@/repositories'
import type { Todo, Customer, Project, Transaction } from '@/db/types'
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Drawer,
  EmptyState,
  PageHeader,
  Modal,
  useAutoFocus,
  Field,
  inputCls,
} from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import { chipTagStyle } from '@/design-system/ChipTagInput'
import { toArchivedFlag } from '@/shared/search'
import { deriveTodoTitle, toTodoText, splitTodoText } from './title'
import {
  TODO_PRIORITY_LEVELS,
  TODO_PRIORITY_META,
  TODO_PRIORITY_CARD_STYLE,
  DEFAULT_TODO_PRIORITY,
  normalizeTodoPriority,
  todoPriorityLabel,
  todoPriorityTone,
  isHighPriority,
  matchesPriorityFilter,
  sortTodosByPriority,
  type TodoPriority,
} from './priority'
import {
  TODO_TAG_MAX_COUNT,
  TODO_TAG_MAX_LENGTH,
  appendTodoTags,
  normalizeTodoTags,
  removeTodoTag,
  settleTagsFromText,
} from './tags'
import dayjs from 'dayjs'
import { useFocusStore } from '@/stores/focus'
import { toggleTodoDone, voidTodo, restoreTodo } from './toggle'
import { useToast } from '@/design-system/Toast'
import { txnTodoIds, financeFocusPath } from '@/modules/finance/links'
import {
  isTodoOpen,
  isTodoDone,
  isTodoVoided,
  isDueToday,
  isTodoOverdue,
  overdueDays,
  resolveFocusViewKind,
  resolveFocusAction,
  todoStatusLabel,
} from './domain'
import {
  useTodoLists,
  useTodoListCounts,
  useTodoListOptions,
  createTodoList,
  renameTodoList,
  deleteTodoListCascade,
  deleteTodoCascade,
  reorderTodoLists,
} from './hooks'

/**
 * 智能清单视图（Issue #128）：
 * - all/inbox/today/week：未完成口径（「全部待办」= 只看未完成，已完成/已作废不再混入）
 * - done/voided：新增的两个终态视图，分别只列已完成 / 已作废
 */
type Filter = 'all' | 'today' | 'overdue' | 'week' | 'inbox' | 'done' | 'voided'

export default function TodoPage() {
  const todos = useCollection<Todo>('todos')
  const lists = useTodoLists()
  const listCounts = useTodoListCounts()
  // 归属展示用映射：列表行直接呈现客户/项目/清单，关联被级联解绑后可即时感知
  const customers = useCollection<Customer>('customers')
  const projects = useCollection<Project>('projects')
  const customerName = useMemo(
    () => new Map((customers ?? []).map((c) => [c.id, c.company || c.name])),
    [customers],
  )
  const projectName = useMemo(
    () => new Map((projects ?? []).map((p) => [p.id, p.name])),
    [projects],
  )
  const listName = useMemo(() => new Map(lists.map((l) => [l.id, l.name])), [lists])
  const [selKind, setSelKind] = useState<Filter>('all')
  // 优先级筛选（原 P1 紧急开关升级为四档任一，Issue #148 后续）
  const [chipPriority, setChipPriority] = useState<TodoPriority | null>(null)
  const [selListId, setSelListId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [creating, setCreating] = useState(false)
  // 单条详情（Issue #162）：列表行点击打开只读详情抽屉，完整呈现内容/归属/关联业务/时间线
  const [detailId, setDetailId] = useState<string | null>(null)
  // 列表排序方向：按创建时间升序 / 降序
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const focus = useFocusStore()
  // 「逾期提醒」开关（设置 → 通知）：关闭后不再主动提示逾期，仅保留行内标记
  const settings = useSettings()
  const dueWarningOn = settings?.notifications?.todoDueWarning ?? true

  // 清单管理交互态
  const [creatingList, setCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  // 删除二次确认（待办 / 清单），统一用应用风格弹窗替代原生 confirm
  const [confirmTodo, setConfirmTodo] = useState<Todo | null>(null)
  // 清单删除确认态：带上待解绑待办数，供弹窗展示口径
  const [confirmList, setConfirmList] = useState<{
    id: string
    name: string
    count: number
  } | null>(null)

  // 全局快捷指令入口：/todo?new=1 自动打开新建抽屉，打开后立即清掉参数避免返回/刷新重复触发
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreating(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // 深链定位：/todo?focus=<todoId>（客户时间线鱼骨 / ⌘K 搜索 / 工作台速记 / 财务凭证穿透入口）——
  // 默认视图「今天」未必包含目标，先切到目标所在视图确保可见，滚动 + 高亮 + 挂临时 ring，
  // 并**直达单条详情抽屉**（Issue #162 收口）：深链语义就是「定位到这一条」，
  // 只切视图+滚动、不打开详情，入口承诺的详情仍要用户再点一次行，观感等同「点了没进去」。
  const focusId = searchParams.get('focus') ?? undefined
  const [focusRingId, setFocusRingId] = useState<string | null>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  useEffect(() => {
    if (!focusId) return
    // 深链定位：穿透入口（客户时间线鱼骨 / CRM 活动流）最常指向**终态**待办
    //（已完成 / 已作废），而「全部待办」视图只装未完成条目（Issue #128 三态口径），
    // 目标会被挡在视图外 —— 表现为「点进去跳了、但目标行不见」。
    // 修复：**按目标自身状态切到对应视图**（已完成 → done、已作废 → voided、未完成 → all），
    // 目标自然落在范围内；不给终态条目开并集口子，避免与「全部待办=只看未完成」口径打架。
    setSelListId(null)
    setSelKind(resolveFocusViewKind(todos, focusId))
    setChipPriority(null)
    // 该做什么由领域层决策（resolveFocusAction，缺陷 D10）：
    // 关键点是**清参只在确实收尾时**——首帧 todos 为空时清参会把 focus 参数吃掉，
    // 数据回填后 effect 重跑时 focusId 已成 undefined，详情抽屉永不打开（#162 的根因）。
    switch (resolveFocusAction(todos, focusId)) {
      case 'open':
        // 目标已在库中：直达详情抽屉（深链语义就是「定位到这一条」）
        setDetailId(focusId)
        setSearchParams({}, { replace: true })
        return
      case 'wait':
        // 数据尚未回填：**保留 focus 参数**，等 todos 到达后本 effect 因依赖变化重跑
        return
      default: {
        // 数据已就绪但目标不在（记录被删 / id 不存在）：滚动兜底 + 清参收尾，不留误导性参数
        const t = window.setTimeout(() => {
          const el = rowRefs.current.get(focusId)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            setFocusRingId(focusId)
            window.setTimeout(() => setFocusRingId(null), 2400)
          }
          setSearchParams({}, { replace: true })
        }, 0)
        return () => window.clearTimeout(t)
      }
    }
  }, [focusId, setSearchParams, todos])

  const todayStr = dayjs().format('YYYY-MM-DD')

  // 列表排序（缺陷 D12 / 用例 #158）：**档位一级 + 创建时间二级**——
  //   · 未完成口径视图：「高 → 中 → 低 → 无」，同档位内按创建时间（由排序按钮切升/降）；
  //   · 终态视图（已完成 / 已作废）：跳过档位一级，保持纯时间序。
  // 终态视图不参与档位排序的理由：事项已终结，档位不再有「立刻做 / 排进计划」的行动含义，
  // 这两个视图的实际用法是「回看最近完成 / 最近作废了什么」，时间序才对得上直觉；
  // 强行按档位排序会让回溯列表失去时间轴的意义。
  const sortedTodos = useMemo(() => {
    const terminal = (selKind === 'done' || selKind === 'voided') && !selListId
    if (terminal) {
      const list = [...todos]
      return list.sort((a, b) => {
        const d = (a.createdAt ?? 0) - (b.createdAt ?? 0)
        return sortDir === 'asc' ? d : -d
      })
    }
    return sortTodosByPriority(todos, sortDir)
  }, [todos, sortDir, selKind, selListId])
  // 三态口径统一走领域层（Issue #128），不再手写 status === 'done' 之类的判据
  const openTodos = sortedTodos.filter(isTodoOpen)
  const doneTodos = sortedTodos.filter(isTodoDone)
  const voidedTodos = sortedTodos.filter(isTodoVoided)
  // 逾期提醒（P1-2 死开关接通）：全局未完成且截止日早于今天（按天口径，Issue #134 五轮），
  // 按设置开关决定是否提示；已作废条目（Issue #128）不进逾期口径——事项已终止，不再催办
  const overdueTodos = useMemo(
    () => openTodos.filter((t) => isTodoOverdue(t, todayStr)),
    [openTodos, todayStr],
  )

  // 日历日边界：今天 = 今日截止 ∪ 逾期未完成；最近七天 = [今天, +7天] ∪ 逾期未完成
  const weekEndStr = dayjs().add(7, 'day').format('YYYY-MM-DD')
  /**
   * 智能视图范围口径（Issue #128 重写）：
   * - 「全部待办 / 收集箱 / 今天 / 最近七天」只装**未完成**条目，已完成/已作废不再混入；
   * - 「已完成」「已作废」两个新视图是终态视图，只装对应状态，勾选框与操作按钮随之切换。
   */
  const matchesSmart = (t: Todo): boolean => {
    // 终态视图：只认自己的状态，与日期/清单无关
    if (selKind === 'done') return isTodoDone(t)
    if (selKind === 'voided') return isTodoVoided(t)
    // 未完成视图：已完成/已作废一律排除
    if (!isTodoOpen(t)) return false
    if (selKind === 'all') return true
    if (selKind === 'inbox') return !t.listId
    if (!t.dueAt) return false
    const d = dayjs(t.dueAt).format('YYYY-MM-DD')
    if (selKind === 'today') return isDueToday(t, todayStr)
    // 「逾期」与「今天」的关系（Issue #134 四轮）：今天 = 今日到期 ∪ 逾期（含集，不变）；
    // 逾期 = 其中截止日早于今天的那部分（按天口径，五轮），作为「今天」的收窄子视图独立成入口
    if (selKind === 'overdue') return isTodoOverdue(t, todayStr)
    if (selKind === 'week') return d <= weekEndStr
    return false
  }
  // 深链定位（Issue #128）：焦点条目并集兜底时必须过「当前视图」这道闸门，
  // 否则一条已作废/已完成的待办会被并进「全部待办」，还计入「N 条未完成」——与「全部待办=只看未完成」口径打架。
  const inFocusScope = (t: Todo): boolean => {
    if (focusRingId === null || t.id !== focusRingId) return false
    if (selListId) return true
    // 终态视图：只并对应的终态；未完成视图：只并未完成
    if (selKind === 'done') return isTodoDone(t)
    if (selKind === 'voided') return isTodoVoided(t)
    return isTodoOpen(t)
  }
  // 当前视图范围 = 智能视图/清单过滤 ∪ 深链定位条目（保证跳转目标在当前口径内可见）
  const baseScope = selListId
    ? sortedTodos.filter((t) => t.listId === selListId || inFocusScope(t))
    : sortedTodos.filter((t) => matchesSmart(t) || inFocusScope(t))
  // 优先级筛选 Chip（原 P1 紧急开关四档化），作用于当前左栏视图/清单之内；全部未命中时兜底展示空态
  const filtered = baseScope.filter((t) => {
    if (!isTodoOpen(t) && chipPriority) return false
    return matchesPriorityFilter(t.priority, chipPriority)
  })
  // 当前视图是否为终态视图（已完成/已作废）：决定空态文案与行内可用操作
  const isDoneView = selKind === 'done' && !selListId
  const isVoidedView = selKind === 'voided' && !selListId
  const isTerminalView = isDoneView || isVoidedView
  // Chip 仅在未完成视图有意义（终态视图本身已按状态过滤）
  const showPriorityChip = !isTerminalView

  // 打勾完成/取消完成统一走领域函数（status 与 completedAt 成对写入，Issue #74）
  // 写库失败（配额超限/隐私模式等）不再静默：catch 后给出可见提示
  async function toggle(t: Todo) {
    try {
      await toggleTodoDone(t)
    } catch (err) {
      console.error('[todo] 更新完成状态失败', err)
      window.alert('更新待办状态失败，请稍后重试。')
    }
  }

  /** 一键作废（Issue #128，行内按钮入口）：区别于「删除」——不删记录、可恢复、事项终止 */
  async function handleVoid(t: Todo) {
    try {
      await voidTodo(t)
    } catch (err) {
      console.error('[todo] 作废失败', err)
      window.alert('作废待办失败，请稍后重试。')
    }
  }

  /** 一键恢复（已作废视图行内按钮入口） */
  async function handleRestore(t: Todo) {
    try {
      await restoreTodo(t)
    } catch (err) {
      console.error('[todo] 恢复失败', err)
      window.alert('恢复待办失败，请稍后重试。')
    }
  }

  // 固定视图顺序（Issue #128）：未完成区（全部待办 → 收集箱 → 今天 → 最近七天）
  // 之后接终态区（已完成 / 已作废），最后分割线接「我的清单」
  const inboxCount = openTodos.filter((t) => !t.listId).length
  const smartLists: {
    key: Filter
    icon: string
    label: string
    count: number
    /** 突出显示的固定入口：未选中时也用主色调样式与普通清单拉开层次 */
    prominent?: boolean
    /** 终态视图（已完成/已作废）：与未完成视图之间加一条分隔线，视觉上分组（Issue #128） */
    terminal?: boolean
  }[] = [
    { key: 'all', icon: 'list', label: '全部待办', count: openTodos.length, prominent: true },
    {
      key: 'inbox',
      icon: 'move_to_inbox',
      label: '收集箱',
      count: inboxCount,
      prominent: true,
    },
    {
      key: 'today',
      icon: 'today',
      label: '今天',
      count: openTodos.filter((t) => isDueToday(t, todayStr)).length,
    },
    {
      key: 'overdue',
      icon: 'warning',
      label: '逾期',
      count: overdueTodos.length,
    },
    {
      key: 'week',
      icon: 'calendar_month',
      label: '最近七天',
      count: openTodos.filter((t) => t.dueAt && dayjs(t.dueAt).format('YYYY-MM-DD') <= weekEndStr)
        .length,
    },
    // 终态视图（Issue #128）：与上方未完成视图同一层级，各自只装对应状态。
    // 计数恒显示（含 0），让「已完成/已作废」入口始终可点——无需先有数据才能进去看口径
    { key: 'done', icon: 'task_alt', label: '已完成', count: doneTodos.length, terminal: true },
    { key: 'voided', icon: 'block', label: '已作废', count: voidedTodos.length, terminal: true },
  ]
  const selSmart = smartLists.find((l) => l.key === selKind)
  const selCustom = lists.find((l) => l.id === selListId)
  const selLabel = selCustom ? selCustom.name : (selSmart?.label ?? '待办')

  function selectSmart(key: Filter) {
    setSelListId(null)
    setChipPriority(null)
    setSelKind(key)
  }
  function selectList(id: string) {
    setSelListId(id)
    // 切换清单时同步重置筛选 Chip，与切换固定视图一致
    setChipPriority(null)
  }

  async function submitCreateList() {
    const name = newListName.trim()
    if (!name) return
    const list = await createTodoList(name)
    setNewListName('')
    setCreatingList(false)
    selectList(list.id)
  }

  async function submitRename() {
    if (!renamingId) return
    const name = renameValue.trim()
    if (name) await renameTodoList(renamingId, name)
    setRenamingId(null)
  }

  /** 点「删除」：先弹应用风格二次确认，不直接动数据 */
  function removeList(id: string) {
    const list = lists.find((l) => l.id === id)
    if (!list) return
    // 计数与级联行为对齐：解绑全部未删除待办（含已完成），故统计口头口径为「N 条待办」
    const n = todos.filter((t) => t.listId === id).length
    setConfirmList({ id, name: list.name, count: n })
  }

  /** 确认后执行删除：清空当前选中态并级联软删清单 */
  async function doRemoveList(id: string) {
    await deleteTodoListCascade(id)
    if (selListId === id) {
      setSelListId(null)
      setSelKind('all')
      setChipPriority(null)
    }
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    if (!dragId || dragId === targetId) return
    const ids = lists.map((l) => l.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    // 先移除源项，再从数组中取目标索引：from < to 时目标项整体左移一位，需修正
    const [moved] = ids.splice(from, 1)
    ids.splice(from < to ? to - 1 : to, 0, moved)
    void reorderTodoLists(ids)
    setDragId(null)
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="待办事项"
        subtitle="跨模块联动：客户跟进、对账、习惯任务自动归集"
        actions={
          <Button icon="add" onClick={() => setCreating(true)}>
            新建待办
          </Button>
        }
      />

      {dueWarningOn && overdueTodos.length > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-danger/25 bg-danger/5 px-4 py-2.5 text-[0.9286rem] text-danger">
          <Icon name="warning" size={18} />
          <span className="flex-1">
            有 <span className="font-semibold">{overdueTodos.length}</span> 条待办已逾期
          </span>
          <button
            className="font-semibold underline underline-offset-2 hover:opacity-80"
            onClick={() => {
              setSelListId(null)
              setChipPriority(null)
              setSelKind('today')
            }}
          >
            立即查看
          </button>
        </div>
      )}

      <div className="grid grid-cols-[240px_1fr] gap-4 items-start">
        {/* 左侧清单：智能清单 + 我的清单（增删改/拖拽排序） */}
        <Card className="p-2">
          <div className="px-3 pt-2 pb-1 text-[0.7857rem] font-semibold uppercase tracking-wider text-outline">
            智能清单
          </div>
          {smartLists.map((l, i) => (
            <div key={l.key}>
              {/* 终态区（已完成/已作废）之前加一条细分隔线，与未完成视图拉开层次（Issue #128） */}
              {l.terminal && !smartLists[i - 1]?.terminal && (
                <div className="my-2 border-t border-outline-variant/40" />
              )}
              <button
                onClick={() => selectSmart(l.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.9643rem] transition-colors ${
                  !selListId && selKind === l.key
                    ? l.prominent
                      ? 'bg-primary font-semibold text-on-primary'
                      : l.terminal
                        ? 'bg-outline/15 font-semibold text-on-surface'
                        : 'bg-primary-fixed font-semibold text-primary'
                    : l.prominent
                      ? 'bg-primary-container/10 font-semibold text-primary hover:bg-primary-container/20'
                      : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                <Icon name={l.icon} size={19} />
                <span className="flex-1 text-left">{l.label}</span>
                <span
                  className={`text-[0.7857rem] ${
                    l.prominent && (selListId || selKind !== l.key)
                      ? 'font-semibold text-primary/70'
                      : 'text-outline'
                  }`}
                >
                  {l.count}
                </span>
              </button>
            </div>
          ))}

          <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 px-3 pt-2 pb-1">
            <span className="text-[0.7857rem] font-semibold uppercase tracking-wider text-outline">
              我的清单
            </span>
            <button
              className="text-outline hover:text-primary"
              title="新建清单"
              onClick={() => {
                setCreatingList(true)
                setNewListName('')
              }}
            >
              <Icon name="add" size={16} />
            </button>
          </div>

          {lists.map((l) => (
            <div
              key={l.id}
              draggable={renamingId !== l.id}
              onDragStart={(e) => {
                setDragId(l.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, l.id)}
              className={`group/list flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[0.9643rem] transition-colors ${
                selListId === l.id
                  ? 'bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              <span
                className="cursor-grab text-[1rem] leading-none text-outline/60 group-hover/list:text-outline"
                title="拖动排序"
              >
                ⠿
              </span>
              {renamingId === l.id ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-primary px-1.5 py-0.5 text-[0.9286rem] outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void submitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => selectList(l.id)}
                >
                  {l.name}
                </button>
              )}
              <span className="text-[0.7857rem] text-outline">{listCounts[l.id] ?? 0}</span>
              <span className="hidden shrink-0 items-center gap-1 group-hover/list:flex">
                <button
                  title="重命名"
                  className="text-outline hover:text-primary"
                  onClick={() => {
                    setRenamingId(l.id)
                    setRenameValue(l.name)
                  }}
                >
                  <Icon name="edit" size={14} />
                </button>
                <button
                  title="删除清单"
                  className="text-outline hover:text-danger"
                  onClick={() => removeList(l.id)}
                >
                  <Icon name="delete" size={14} />
                </button>
              </span>
            </div>
          ))}

          {creatingList && (
            <div className="px-2 py-1">
              <input
                autoFocus
                placeholder="清单名称，回车保存"
                className="w-full rounded border border-primary px-2 py-1.5 text-[0.9286rem] outline-none"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onBlur={() => void submitCreateList()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCreateList()
                  if (e.key === 'Escape') setCreatingList(false)
                }}
              />
            </div>
          )}
        </Card>

        {/* 右侧待办列表 */}
        <div>
          <Card className="mb-3 flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[0.9286rem] font-semibold">{selLabel}</span>
              {/* 状态徽标：终态视图给一个明确的状态标记，避免与未完成视图混淆（Issue #128） */}
              {isDoneView && (
                <Chip tone="green" icon="task_alt">
                  已完成
                </Chip>
              )}
              {isVoidedView && (
                <Chip tone="gray" icon="block">
                  已作废
                </Chip>
              )}
              {/* 优先级筛选（Issue #148 后续）：四档平铺，点选过滤、再点取消。
                  作用域仍是「当前左栏视图/清单之内」；终态视图本身已按状态过滤，不给该入口 */}
              {showPriorityChip && (
                <div className="flex items-center gap-1">
                  {TODO_PRIORITY_LEVELS.map((p) => {
                    const on = chipPriority === p
                    const meta = TODO_PRIORITY_META[p]
                    return (
                      <button
                        key={p}
                        title={`${meta.label} · ${meta.quadrant}（${meta.hint}）`}
                        onClick={() => setChipPriority((v) => (v === p ? null : p))}
                        className={`rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium transition-colors ${
                          on
                            ? 'bg-primary-fixed text-primary'
                            : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                        }`}
                      >
                        {meta.label}
                        {on && ' ✕'}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* 排序按钮：同一档位内按创建时间升序 / 降序（档位本身恒为高→无，见 sortedTodos） */}
              <button
                onClick={() => setSortDir('asc')}
                title="同一档位内按创建时间升序"
                className={`rounded-lg p-1.5 transition-colors ${
                  sortDir === 'asc'
                    ? 'bg-primary-fixed text-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <Icon name="arrow_upward" size={18} />
              </button>
              <button
                onClick={() => setSortDir('desc')}
                title="同一档位内按创建时间降序"
                className={`rounded-lg p-1.5 transition-colors ${
                  sortDir === 'desc'
                    ? 'bg-primary-fixed text-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <Icon name="arrow_downward" size={18} />
              </button>
              <span className="text-[0.7857rem] text-outline">
                {isTerminalView ? `${filtered.length} 条` : `${filtered.length} 条未完成`}
              </span>
            </div>
          </Card>
          {filtered.length === 0 ? (
            <Card className="p-6">
              {chipPriority && baseScope.length > 0 ? (
                <EmptyState
                  icon="filter_alt_off"
                  title="当前筛选没有命中"
                  description="试试取消上方筛选，查看本视图全部内容"
                />
              ) : isDoneView ? (
                <EmptyState
                  icon="task_alt"
                  title="还没有已完成的待办"
                  description="在「全部待办」里打勾即可完成，条目会归档到这里"
                />
              ) : isVoidedView ? (
                <EmptyState
                  icon="block"
                  title="还没有已作废的待办"
                  description="作废用于终止不再推进的事项，与删除不同——记录会保留在这里供回溯"
                />
              ) : (
                <EmptyState icon="task_alt" title="这里空空如也" description="点击右上角新建待办" />
              )}
            </Card>
          ) : (
            <Card className="divide-y divide-outline-variant/30 px-5">
              {filtered.map((t) => {
                const isDoing = focus.todoId === t.id && focus.status === 'running'
                const isFocusRing = focusRingId === t.id
                return (
                  <div
                    key={t.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(t.id, el)
                      else rowRefs.current.delete(t.id)
                    }}
                    onClick={() => setDetailId(t.id)}
                    className={`group flex cursor-pointer items-center gap-3 rounded-lg py-3.5 transition-all duration-300 hover:bg-surface-container-low/40 ${
                      isFocusRing
                        ? 'focus:outline-2 focus:outline-primary bg-primary-fixed/60 -mx-2 px-2'
                        : ''
                    }`}
                  >
                    {/* 状态勾选框（Issue #128 三态）：
                        未完成 → 打勾完成；已完成 → 取消完成回到未完成；
                        已作废 → 不可打勾（终止事项不得被「完成」，需先恢复），用 block 图标表达 */}
                    {isTodoVoided(t) ? (
                      <span className="shrink-0 text-outline/70" title="已作废：恢复后才可完成">
                        <Icon name="block" size={20} />
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          // 行内动作不穿透到「打开详情」（Issue #162 行点击）
                          e.stopPropagation()
                          void toggle(t)
                        }}
                        className="shrink-0"
                      >
                        <Icon
                          name={isTodoDone(t) ? 'check_circle' : 'radio_button_unchecked'}
                          size={20}
                          fill={isTodoDone(t)}
                          className={
                            isTodoOpen(t) && isHighPriority(t)
                              ? 'text-danger'
                              : isTodoOpen(t)
                                ? 'text-outline'
                                : 'text-success'
                          }
                        />
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[1rem] ${
                          isTodoOpen(t)
                            ? 'font-medium'
                            : isTodoDone(t)
                              ? 'text-outline line-through'
                              : 'text-outline/70 line-through'
                        }`}
                      >
                        {t.title}
                        {/* 「专注中」为专注计时运行时态，与持久化状态独立；作废条目不再显示 */}
                        {isDoing && isTodoOpen(t) && (
                          <span className="ml-2 align-middle">
                            <Chip tone="blue" icon="timer">
                              专注中
                            </Chip>
                          </span>
                        )}
                        {isTodoVoided(t) && (
                          <span className="ml-2 align-middle">
                            <Chip tone="gray" icon="block">
                              已作废
                            </Chip>
                          </span>
                        )}
                      </div>
                      {t.dueAt && (
                        <div className="mt-0.5 text-[0.8571rem] text-outline">
                          截止 {dayjs(t.dueAt).format('M月D日 HH:mm')}
                          {isTodoOverdue(t, todayStr) && (
                            <span className="ml-1.5 text-danger">
                              已逾期 {overdueDays(t, todayStr)} 天
                            </span>
                          )}
                        </div>
                      )}
                      {/* 终态时间说明：完成/作废时间各自展示，口径可追溯 */}
                      {isTodoDone(t) && t.completedAt && (
                        <div className="mt-0.5 text-[0.8571rem] text-success/80">
                          完成于 {dayjs(t.completedAt).format('M月D日 HH:mm')}
                        </div>
                      )}
                      {isTodoVoided(t) && (
                        <div className="mt-0.5 text-[0.8571rem] text-outline/80">
                          {t.voidedAt
                            ? `作废于 ${dayjs(t.voidedAt).format('M月D日 HH:mm')}`
                            : '已作废'}
                          {' · 记录保留，可随时恢复'}
                        </div>
                      )}
                      {/* 归属信息：仅在有归属时展示；弱引用被级联解绑后自然消失，可即时感知 */}
                      {(() => {
                        const owner = [
                          t.customerId
                            ? `客户 ${customerName.get(t.customerId) ?? '已删除'}`
                            : null,
                          t.projectId ? `项目 ${projectName.get(t.projectId) ?? '已删除'}` : null,
                          t.listId ? `清单 ${listName.get(t.listId) ?? '已删除'}` : null,
                        ].filter(Boolean)
                        if (!owner.length) return null
                        return (
                          <div className="mt-0.5 truncate text-[0.7857rem] text-outline/80">
                            {owner.join(' · ')}
                          </div>
                        )
                      })()}
                    </div>
                    {/* 四档优先级：展示中文档位名，色板走 priority 收口（不高亮「无」以降低噪音） */}
                    <Chip tone={todoPriorityTone(t.priority)}>{todoPriorityLabel(t.priority)}</Chip>
                    {isTodoOpen(t) && (
                      <Button
                        size="sm"
                        variant="tonal"
                        icon="timer"
                        onClick={(e) => {
                          e.stopPropagation()
                          focus.start(t.id, t.title)
                        }}
                      >
                        专注
                      </Button>
                    )}
                    {/* 作废 / 恢复（Issue #128）：常显，是行内的一等动作，不藏在 hover 里 */}
                    {isTodoVoided(t) ? (
                      <Button
                        size="sm"
                        variant="tonal"
                        icon="restart_alt"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRestore(t)
                        }}
                      >
                        恢复
                      </Button>
                    ) : (
                      <button
                        title="作废（终止事项，记录保留，可恢复）"
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-outline-variant/60 px-2.5 py-1 text-[0.8571rem] text-on-surface-variant transition-colors hover:border-warning hover:text-warning"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleVoid(t)
                        }}
                      >
                        <Icon name="block" size={16} />
                        作废
                      </button>
                    )}
                    <button
                      title="编辑待办"
                      className="text-outline opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing(t)
                      }}
                    >
                      <Icon name="edit" size={18} />
                    </button>
                    <button
                      title="删除待办"
                      className="text-outline opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmTodo(t)
                      }}
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </div>
                )
              })}
            </Card>
          )}
        </div>
      </div>

      {/* 单条详情抽屉（Issue #162）：列表行点击进入；抽屉内可打勾/专注/作废恢复/编辑/删除 */}
      <TodoDetailDrawer
        todoId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(t) => {
          setDetailId(null)
          setEditing(t)
        }}
        onDelete={(t) => {
          setDetailId(null)
          setConfirmTodo(t)
        }}
      />

      <ConfirmDialog
        open={confirmTodo !== null}
        title={`删除待办「${confirmTodo?.title ?? ''}」`}
        message="删除后该待办将不再显示，且暂无回收站入口，此操作不可撤销。"
        confirmText="删除"
        danger
        onConfirm={() => {
          const t = confirmTodo
          setConfirmTodo(null)
          // 级联删除（Issue #148 后续）：软删待办 + 解绑 transactions.todoIds 悬挂引用
          if (t) void deleteTodoCascade(t.id)
        }}
        onCancel={() => setConfirmTodo(null)}
      />

      <TodoFormDrawer
        open={creating || editing !== null}
        todo={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={(saved) => {
          if (editing) return
          // 新建兜底：当前视图装不下新条目时自动切到能装下它的视图，避免保存成功却"看不到任何反应"。
          // 视图枚举（Issue #128 三态）：清单匹配 / 全部待办(未完成恒可见) / 今天·最近七天(含逾期口径) /
          // 收集箱(listId 空) / 已完成 / 已作废。终态条目自动落到对应终态视图。
          const savedDay = saved.dueAt ? dayjs(saved.dueAt).format('YYYY-MM-DD') : undefined
          const visible = selListId
            ? saved.listId === selListId
            : selKind === 'done'
              ? isTodoDone(saved)
              : selKind === 'voided'
                ? isTodoVoided(saved)
                : selKind === 'all'
                  ? isTodoOpen(saved)
                  : selKind === 'inbox'
                    ? isTodoOpen(saved) && !saved.listId
                    : selKind === 'today'
                      ? isTodoOpen(saved) && !!savedDay && savedDay <= todayStr
                      : selKind === 'overdue'
                        ? isTodoOverdue(saved, todayStr)
                        : isTodoOpen(saved) && !!savedDay && savedDay <= weekEndStr
          const chipOk =
            !chipPriority ||
            (isTodoOpen(saved) && matchesPriorityFilter(saved.priority, chipPriority))
          if (!visible || !chipOk) {
            setSelListId(null)
            setChipPriority(null)
            setSelKind(isTodoDone(saved) ? 'done' : isTodoVoided(saved) ? 'voided' : 'all')
          }
        }}
      />

      {/* 删除清单确认（应用风格弹窗，替代 window.confirm） */}
      <ConfirmDialog
        open={confirmList !== null}
        title={`删除清单「${confirmList?.name ?? ''}」？`}
        danger
        confirmText="删除"
        message={`名下 ${confirmList?.count ?? 0} 条待办将解除归属并移入「收集箱」。此操作不可撤销。`}
        onCancel={() => setConfirmList(null)}
        onConfirm={() => {
          const target = confirmList
          setConfirmList(null)
          if (target) void doRemoveList(target.id)
        }}
      />
    </div>
  )
}

/**
 * 编辑回填：把已落库的 title + desc 拼回单一正文（Issue #148 后续：实现已收口到
 * `./title` 的 `toTodoText`，此处保留导出名以兼容既有测试与调用方）。
 */
export function joinTodoText(todo: Pick<Todo, 'title' | 'desc'> | null): string {
  return toTodoText(todo)
}

/** 兼容再导出：口径唯一来源是 `./title`（见该模块头注释的收口说明） */
export { deriveTodoTitle }

export function TodoFormDrawer({
  open,
  todo,
  onClose,
  onSaved,
}: {
  open: boolean
  todo: Todo | null
  onClose: () => void
  /** 保存成功后回调（新建场景用于视图兜底切换，保证新条目立即可见） */
  onSaved?: (todo: Todo) => void
}) {
  const toast = useToast()
  const customers = useCollection<Customer>('customers')
  const projects = useCollection<Project>('projects')
  // 标题不再是独立输入（Issue #148）：全文入正文，标题恒由正文首行推导
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState<TodoPriority>(DEFAULT_TODO_PRIORITY)
  /**
   * 状态（Issue #148 后续）：**不进表单的常驻字段**。
   *
   * 为什么删掉：新建待办默认就是未完成，弹窗里再摆一个「未完成」下拉，等于让用户
   * 在一个只有单一可选值的字段里做选择 —— 用户说的「状态有点多余」就是这个。
   *
   * 唯一例外是**已作废条目**：作废是「终止」而非「删除」（记录保留），用户很可能
   * 正是在「这条不再推进」的语境下进来改字，或进来恢复。所以只给已作废条目一个
   * 「恢复为未完成」开关（默认不勾=保持作废），避免为了恢复先退出表单去详情里按一下。
   * 完成态不在这里写：它在列表勾选框 / 详情抽屉（`toggleTodoDone`，status 与 completedAt 成对写）。
   */
  const [restoreOnSave, setRestoreOnSave] = useState(false)
  const isVoidedEditing = todo?.status === 'voided'
  const [dueAt, setDueAt] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [listId, setListId] = useState('')
  const [projectId, setProjectId] = useState('')
  // 标签（Issue #148）：`#` + 回车创建，或保存时从正文尾部的 `#词` 结算
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [tagNotice, setTagNotice] = useState('')
  const listOptions = useTodoListOptions()
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)
  const tagInputRef = useRef<HTMLInputElement>(null)
  // 正文即标题来源，打开即聚焦正文（原先聚焦标题输入框）
  const descRef = useAutoFocus<HTMLTextAreaElement>(open)

  // 打开时重置
  const openKey = `${open}-${todo?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    // 编辑回填：标题与正文拼接，对齐「首行即标题」的拆分口径（拆不开时按标题拆分）
    setDesc(joinTodoText(todo))
    // 回填归一化：存量 P1/P2/P3 数据在此转成四档，编辑保存后自然完成数据迁移。
    // 新建（todo 为 null）走**写侧缺省档**「无 · 白色卡片」，不走读侧脏数据兜底的「中」——
    // 两者刻意不同源（见 priority.ts 注释）：一个是「用户没表态」，一个是「字段写坏了」。
    setPriority(todo ? normalizeTodoPriority(todo.priority) : DEFAULT_TODO_PRIORITY)
    setDueAt(todo?.dueAt ? dayjs(todo.dueAt).format('YYYY-MM-DDTHH:mm') : '')
    setCustomerId(todo?.customerId ?? '')
    setListId(todo?.listId ?? '')
    setProjectId(todo?.projectId ?? '')
    setTags(normalizeTodoTags(todo?.tags ?? []))
    setRestoreOnSave(false)
    setTagDraft('')
    setTagNotice('')
    setError('')
    setSeedKey((k) => k + 1)
  }

  /** 追加标签（回车 / 逗号 / 失焦共用）；超上限给出提示而非静默丢弃 */
  function commitTags(raw: string) {
    const { tags: next, overflow } = appendTodoTags(tags, [raw])
    setTags(next)
    setTagDraft('')
    setTagNotice(overflow > 0 ? `最多 ${TODO_TAG_MAX_COUNT} 个标签` : '')
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === '，' || e.key === ',') {
      e.preventDefault()
      if (tagDraft.trim()) commitTags(tagDraft)
      return
    }
    // 退格：输入框为空时删末枚（与笔记 / 客户标签同款手感）
    if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  async function save() {
    // 标签结算（Issue #148）：把未按回车的草稿与正文尾部残留的 `#词` 一并收成标签，
    // 避免「打了 # 没回车 → 标签变成备注文字」这种静默丢失。
    const settledDraft = appendTodoTags(tags, [tagDraft])
    const settledTail = settleTagsFromText(desc)
    const { tags: finalTags } = appendTodoTags(settledDraft.tags, settledTail.tags)
    const content = settledTail.text

    // 标题口径（Issue #148）：正文首行 trim 后作标题（截断 60 字，空正文回退「未命名待办」）。
    // 拆分走 `./title` 的 `splitTodoText` —— 与速记转待办、Agent 两条写入口共用同一实现，
    // 杜绝「同一动作多条命名规则」（本文件不再自行拼 title/desc）。
    if (!content.trim()) {
      setError('请先写下待办内容')
      return
    }
    const { title, desc: body } = splitTodoText(content)
    /*
     * 状态（Issue #148 后续）：表单已无状态字段，只有一种例外迁移 ——
     * 「已作废 → 勾了恢复 → 未完成」。其余一律原样保留 todo.status：
     * 未完成/已完成的条目改字保存不会改状态，也不会重盖 completedAt。
     */
    const reactivated = isVoidedEditing && restoreOnSave
    const nextStatus: Todo['status'] = !todo ? 'todo' : reactivated ? 'todo' : todo.status
    // 以旧记录展开为基底，仅覆盖表单字段，保留 habitId/ledgerId/completedAt 等
    const base: Todo = {
      ...todo,
      id: todo?.id ?? newId('td'),
      title,
      desc: body,
      priority,
      status: nextStatus,
      // 时间戳与 status 成对（Issue #128）：表单只可能产生「作废 → 未完成」这一种状态迁移，
      // 两个终态时间戳一并清空（与 `setTodoVoided(todo, false)` 同纪律，不留单边时间戳）；
      // 其余情况原样保留，表单不参与完成态写入。
      completedAt: reactivated ? undefined : todo?.completedAt,
      voidedAt: reactivated ? undefined : todo?.voidedAt,
      dueAt: dueAt ? dayjs(dueAt).valueOf() : undefined,
      tags: finalTags.length ? finalTags : undefined,
      customerId: customerId || undefined,
      listId: listId || undefined,
      projectId: projectId || undefined,
      createdAt: todo?.createdAt ?? Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    }
    await todoRepo.put(base)
    if (reactivated) toast.success(`已恢复为未完成：${title}`)
    onSaved?.(base)
    onClose()
  }

  return (
    <Modal open={open} title={todo ? '编辑待办' : '新建待办'} onClose={onClose} size="lg">
      <div key={seedKey}>
        {/* 左右分区（Issue #148 后续）：
            - 左栏只放正文，独占可用高度（「把更大的面积留给文本输入」）；
            - 右栏「事项设置」收纳全部非正文字段（优先级/状态/截止时间/清单/项目/客户）；
            - 窄屏（<640px）自动回退单栏堆叠，正文在上、设置在下。 */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* 左栏：正文。`sm:flex-1 sm:min-w-0` 保证长文本不会顶破栅格 */}
          <div className="sm:min-w-0 sm:flex-1">
            <Field label="待办内容 *">
              <textarea
                ref={descRef}
                className={`${inputCls} h-44 resize-none sm:h-72`}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={'第一行作为标题，其余行作为备注\n例如：跟进深蓝续约\n本周五前给出报价'}
              />
              <p className="mt-1.5 text-[0.7857rem] text-outline">
                第一行将作为待办标题，其余内容作为备注
              </p>
            </Field>

            {/* 标签行（Issue #148）：`#` 直接输入、回车成签，样式对齐笔记/客户的彩色小标签。
                这里刻意**不用 MatchCombobox / 弹层** —— 它嵌在表单里，弹层会顶掉输入态。
                正文下移后本行紧跟其后，视觉上属于「正文的延伸」而非右栏设置项。 */}
            <div className="mt-1">
              <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                标签
              </div>
              <div
                className="flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5"
                onClick={() => tagInputRef.current?.focus()}
              >
                {tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium"
                    style={chipTagStyle(t)}
                  >
                    #{t}
                    <button
                      type="button"
                      className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
                      title="移除标签"
                      onClick={(e) => {
                        e.stopPropagation()
                        setTags(removeTodoTag(tags, t))
                      }}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </span>
                ))}
                <input
                  ref={tagInputRef}
                  className="min-w-[7rem] flex-1 bg-transparent text-[0.9286rem] outline-none"
                  value={tagDraft}
                  maxLength={TODO_TAG_MAX_LENGTH + 1}
                  onChange={(e) => {
                    setTagNotice('')
                    setTagDraft(e.target.value)
                  }}
                  onKeyDown={onTagKeyDown}
                  onBlur={() => tagDraft.trim() && commitTags(tagDraft)}
                  placeholder={tags.length === 0 ? '# 输入标签，回车创建' : ''}
                />
              </div>
              <p
                className={`mt-1.5 text-[0.7857rem] ${tagNotice ? 'text-warning' : 'text-outline'}`}
              >
                {tagNotice || `输入 # 标签名后回车创建，最多 ${TODO_TAG_MAX_COUNT} 个`}
              </p>
            </div>
          </div>

          {/* 右栏：事项设置。窄屏与左栏同宽堆叠，桌面固定 280px 侧栏 */}
          <section aria-label="事项设置" className="shrink-0 surface-card-low p-4 sm:w-[17.5rem]">
            <h3 className="mb-3 text-[0.9286rem] font-semibold text-on-surface-variant">
              事项设置
            </h3>

            {/* 优先级（Issue #148 最新口径）：固定四档 → 直接点选的**彩色卡片**，
                红 / 橙 / 蓝 / 白 分别对应 高 / 中 / 低 / 无，白色「无」是默认档。
                不再用下拉：四张卡一屏铺开，点一下即选中，比下拉少一次交互。 */}
            <div className="mb-4">
              <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                优先级
              </div>
              <div role="radiogroup" aria-label="优先级" className="grid grid-cols-4 gap-1.5">
                {TODO_PRIORITY_LEVELS.map((p) => {
                  const meta = TODO_PRIORITY_META[p]
                  const style = TODO_PRIORITY_CARD_STYLE[p]
                  const selected = priority === p
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      title={`${meta.label} · ${meta.quadrant}｜${meta.hint}`}
                      className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-all ${
                        selected ? style.active : style.card
                      }`}
                      onClick={() => setPriority(p)}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${style.swatch}`} />
                      <span className="text-[0.9286rem] font-semibold leading-none">
                        {meta.label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[0.7857rem] text-outline">
                {TODO_PRIORITY_META[priority].label} · {TODO_PRIORITY_META[priority].quadrant}
                {' — '}
                {TODO_PRIORITY_META[priority].hint}
              </p>
            </div>

            {/* 状态（Issue #148 后续）：**表单里没有状态字段** —— 新建默认就是未完成，
                让用户在只有一个可选值的下拉里做选择是多余的交互。
                完成态走列表勾选框 / 详情抽屉（`toggleTodoDone`，status 与 completedAt 成对写）；
                作废是终止而非删除，只给**已作废条目**一个原地恢复开关，其余终态写入不进表单。 */}
            {isVoidedEditing && (
              <Field label="状态">
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-outline-variant/60 px-3 py-2 text-[0.9286rem] transition-colors hover:border-primary/60">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-primary"
                    checked={restoreOnSave}
                    onChange={(e) => setRestoreOnSave(e.target.checked)}
                  />
                  <span>
                    恢复为未完成
                    <span className="mt-0.5 block text-[0.7857rem] text-outline">
                      这条待办当前「已作废」。勾上并保存 = 恢复为未完成；不勾则保持作废状态，
                      仅更新正文与设置。
                    </span>
                  </span>
                </label>
              </Field>
            )}

            <Field label="截止时间">
              <input
                type="datetime-local"
                className={inputCls}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>

            <Field label="所属清单">
              <MatchCombobox
                value={listId}
                options={listOptions.map((l) => ({ id: l.id, label: l.name, icon: 'folder' }))}
                placeholder="输入清单名称模糊搜索"
                emptyText="没有匹配的清单"
                onChange={setListId}
              />
            </Field>

            <Field label="所属项目">
              <MatchCombobox
                value={projectId}
                options={projects.map((p) => ({
                  id: p.id,
                  label: p.name,
                  sub: p.status === 'archived' ? '已归档' : undefined,
                  ...toArchivedFlag(p),
                  icon: 'folder_open',
                }))}
                placeholder="输入项目名称模糊搜索"
                emptyText="没有匹配的项目"
                onChange={setProjectId}
              />
            </Field>

            <Field label="关联客户">
              <MatchCombobox
                value={customerId}
                options={customers.map((c) => ({
                  id: c.id,
                  label: c.company ? `${c.company} · ${c.name}` : c.name,
                  icon: 'person',
                }))}
                placeholder="输入公司或姓名模糊搜索，如：深蓝"
                emptyText="没有匹配的客户"
                onChange={setCustomerId}
              />
            </Field>
          </section>
        </div>
        {error && <div className="mb-3 text-[0.8571rem] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save}>{todo ? '保存修改' : '创建待办'}</Button>
        </div>
      </div>
    </Modal>
  )
}


/**
 * 待办详情抽屉（Issue #162）—— 列表行点击进入的单条详情。
 *
 * 用户反馈「待办列表不能进去查看单条详情」：此前列表行只能就地打勾 / 作废 / 编辑，
 * 想看一条待办的完整内容（正文备注全文、截止时间、归属、关联账目）没有入口。
 *
 * 实现口径对齐财务「凭证详情抽屉」（`FinancePage.TransactionDetailDrawer`）：
 * - 只读呈现 + 抽屉内行动作（打勾完成 / 开始专注 / 作废恢复 / 编辑 / 删除）；
 * - 状态变更统一走 `./toggle` 领域函数，不在详情里另写一套 status 写入；
 * - 关联账目反查 `transactions.todoIds`（数组弱引用，走 `txnTodoIds` 收口），
 *   点击穿透 `/finance?focus=<txnId>` 打开对应凭证详情；
 * - 归属展示用实时映射，弱引用被级联解绑后自然显示「已删除」。
 */
export function TodoDetailDrawer({
  todoId,
  onClose,
  onEdit,
  onDelete,
}: {
  todoId: string | null
  onClose: () => void
  onEdit: (todo: Todo) => void
  onDelete: (todo: Todo) => void
}) {
  // 「未回填」与「查无此记录」必须分开（Issue #162）：useLiveQuery 首帧恒 undefined，
  // 直接当「不存在」会在打开抽屉的瞬间闪一帧误导性的空态提示
  const { record: todo, checked } = useRecordState<Todo>('todos', todoId ?? undefined)
  const display = resolveRecordDisplay(todoId ?? undefined, checked)
  const lists = useTodoLists()
  const customers = useCollection<Customer>('customers')
  const projects = useCollection<Project>('projects')
  const transactions = useCollection<Transaction>('transactions')
  const navigate = useNavigate()
  const focus = useFocusStore()
  const todayStr = dayjs().format('YYYY-MM-DD')
  // 状态流转失败提示（与列表行同款：不静默失败）
  const [busy, setBusy] = useState(false)

  // 关联账目：`transactions.todoIds` 数组弱引用反查（links.ts 收口，兼容旧单值字段）
  const linkedTxns = todo
    ? transactions.filter((t) => txnTodoIds(t).includes(todo.id))
    : []

  /** 详情内动作统一包一层：执行期禁用按钮 + 失败可见提示（不静默吞错） */
  async function run(action: (t: Todo) => Promise<unknown>) {
    if (!todo || busy) return
    setBusy(true)
    try {
      await action(todo)
    } catch (err) {
      console.error('[todo] 详情内更新失败', err)
      window.alert('更新待办失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={todoId !== null} title="待办详情" onClose={onClose} width={460}>
      {display !== 'ready' || !todo ? (
        // 加载中（首帧未回填）渲染空白，避免闪一帧「不存在」；
        // 真正查无此记录（checked=true 但 record 为空）才给空态
        display === 'ready' ? (
          <EmptyState
            icon="task_alt"
            title="待办不存在或已删除"
            description="可能已被移除，关闭后回列表查看其他待办"
          />
        ) : null
      ) : (
        <div className="space-y-5">
          {/* 主卡：状态 + 标题 + 正文全文（列表行只截断展示标题，详情给完整内容） */}
          <div
            className={`rounded-xl p-4 ${
              isTodoDone(todo)
                ? 'bg-success-container/30'
                : isTodoVoided(todo)
                  ? 'bg-surface-container-low'
                  : 'bg-primary-fixed/40'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <Chip
                tone={isTodoDone(todo) ? 'green' : isTodoVoided(todo) ? 'gray' : 'blue'}
                icon={isTodoDone(todo) ? 'task_alt' : isTodoVoided(todo) ? 'block' : 'schedule'}
              >
                {todoStatusLabel(todo)}
              </Chip>
              <Chip tone={todoPriorityTone(todo.priority)}>
                {todoPriorityLabel(todo.priority)}
              </Chip>
            </div>
            <h3
              className={`mt-2 text-[1.2143rem] font-bold leading-snug ${
                isTodoOpen(todo) ? '' : 'text-outline line-through'
              }`}
            >
              {todo.title}
            </h3>
            {/* 正文即备注全文（Issue #148：标题由首行推导，desc 承载完整内容） */}
            {/* ⚠️ desc 必须兜底：类型上标为必填，但存量/同步/手写库的记录可能没有该字段，
                直接 .trim() 会抛 "Cannot read properties of undefined"，让整个待办模块白屏。
                与 modules/todo/title.ts 的 `(todo.desc ?? '')` 保持同口径（缺陷 D11）。 */}
            {(todo.desc ?? '').trim() ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-[0.9286rem] text-on-surface-variant">
                {todo.desc}
              </p>
            ) : (
              <p className="mt-2 text-[0.8571rem] text-outline">无备注</p>
            )}
          </div>

          {/* 抽屉内行动作：与列表行口径一致（打勾 / 专注 / 作废恢复 / 编辑 / 删除） */}
          <div className="flex flex-wrap gap-2">
            {!isTodoVoided(todo) && (
              <Button
                variant={isTodoDone(todo) ? 'tonal' : 'primary'}
                icon={isTodoDone(todo) ? 'undo' : 'check_circle'}
                disabled={busy}
                onClick={() => void run((t) => toggleTodoDone(t))}
              >
                {isTodoDone(todo) ? '取消完成' : '标记完成'}
              </Button>
            )}
            {isTodoOpen(todo) && (
              <Button
                variant="tonal"
                icon="timer"
                disabled={busy}
                onClick={() => focus.start(todo.id, todo.title)}
              >
                开始专注
              </Button>
            )}
            {isTodoVoided(todo) ? (
              <Button
                variant="tonal"
                icon="restart_alt"
                disabled={busy}
                onClick={() => void run((t) => restoreTodo(t))}
              >
                恢复
              </Button>
            ) : (
              <Button
                variant="tonal"
                icon="block"
                disabled={busy}
                onClick={() => void run((t) => voidTodo(t))}
              >
                作废
              </Button>
            )}
            <Button variant="ghost" icon="edit" onClick={() => onEdit(todo)}>
              编辑
            </Button>
            <Button
              variant="danger"
              icon="delete"
              className="ml-auto"
              onClick={() => onDelete(todo)}
            >
              删除
            </Button>
          </div>

          {/* 基础明细：截止 / 创建 / 完成 / 作废时间与归属（归属走实时映射，失效 id 显式占位） */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface-container-low/50 p-4">
            <TodoDetailField label="截止时间">
              {todo.dueAt ? dayjs(todo.dueAt).format('YYYY-MM-DD HH:mm') : '未设置'}
            </TodoDetailField>
            <TodoDetailField label="创建时间">
              {dayjs(todo.createdAt).format('YYYY-MM-DD HH:mm')}
            </TodoDetailField>
            {isTodoDone(todo) && (
              <TodoDetailField label="完成时间">
                {todo.completedAt ? dayjs(todo.completedAt).format('YYYY-MM-DD HH:mm') : '—'}
              </TodoDetailField>
            )}
            {isTodoVoided(todo) && (
              <TodoDetailField label="作废时间">
                {todo.voidedAt ? dayjs(todo.voidedAt).format('YYYY-MM-DD HH:mm') : '—'}
              </TodoDetailField>
            )}
            <TodoDetailField label="所属清单">
              {todo.listId ? (listNameOf(lists, todo.listId) ?? '已删除') : '未归入清单'}
            </TodoDetailField>
            <TodoDetailField label="关联客户">
              {todo.customerId
                ? (customerLabelOf(customers, todo.customerId) ?? '已删除')
                : '未关联'}
            </TodoDetailField>
            <TodoDetailField label="所属项目">
              {todo.projectId
                ? (projectLabelOf(projects, todo.projectId) ?? '已删除')
                : '未关联'}
            </TodoDetailField>
            {isTodoOpen(todo) && todo.dueAt && isTodoOverdue(todo, todayStr) && (
              <TodoDetailField label="逾期">
                <span className="text-danger">已逾期 {overdueDays(todo, todayStr)} 天</span>
              </TodoDetailField>
            )}
          </div>

          {/* 关联账目：从 transactions.todoIds 反查，点击穿透财务凭证详情（Issue #147 同款深链） */}
          <div>
            <div className="mb-2 text-[0.8571rem] font-medium uppercase tracking-wide text-on-surface-variant">
              关联账目（{linkedTxns.length}）
            </div>
            {linkedTxns.length === 0 ? (
              <div className="text-[0.8571rem] text-outline">暂无关联账目</div>
            ) : (
              <div className="space-y-1.5">
                {linkedTxns.map((txn) => (
                  <button
                    key={txn.id}
                    onClick={() => navigate(financeFocusPath(txn.id))}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-container-low/60 p-3 text-left transition-colors hover:bg-surface-container-low"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[0.9286rem] font-medium">{txn.summary}</div>
                      <div className="text-[0.8571rem] text-outline">
                        {dayjs(txn.occurredAt).format('YYYY-MM-DD')} ·{' '}
                        {txn.type === 'income' ? '收入' : '支出'} ¥
                        {txn.amount.toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 pl-2 text-[0.8571rem] font-semibold text-primary">
                      查看凭证
                      <Icon name="open_in_new" size={14} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}

/** 详情字段（标签在上、值在下；长文本允许换行） */
function TodoDetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.7857rem] font-medium text-on-surface-variant">{label}</span>
      <span className="break-all text-[0.9286rem]">{children}</span>
    </div>
  )
}

/** 清单名解析（导出给详情用，保持选择器稳定） */
function listNameOf(lists: { id: string; name: string }[], id: string): string | undefined {
  return lists.find((l) => l.id === id)?.name
}

function customerLabelOf(customers: Customer[], id: string): string | undefined {
  const c = customers.find((x) => x.id === id)
  if (!c) return undefined
  return c.company ? `${c.company} · ${c.name}` : c.name
}

function projectLabelOf(projects: Project[], id: string): string | undefined {
  return projects.find((p) => p.id === id)?.name
}

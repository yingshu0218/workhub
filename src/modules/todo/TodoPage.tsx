import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useSearchParams } from 'react-router-dom'
import { useCollection, useSettings } from '@/queries/hooks'
import { todoRepo, newId } from '@/repositories'
import type { Todo, Customer, Project } from '@/db/types'
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Modal,
  useAutoFocus,
  Field,
  inputCls,
} from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import dayjs from 'dayjs'
import { useFocusStore } from '@/stores/focus'
import { toggleTodoDone } from './toggle'
import { isTodoOpen, isDueToday } from './domain'
import {
  useTodoLists,
  useTodoListCounts,
  useTodoListOptions,
  createTodoList,
  renameTodoList,
  deleteTodoListCascade,
  reorderTodoLists,
} from './hooks'

type Filter = 'all' | 'today' | 'week' | 'inbox'

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
  const [chipP1, setChipP1] = useState(false)
  const [chipDone, setChipDone] = useState(false)
  const [selListId, setSelListId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [creating, setCreating] = useState(false)
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

  // 深链定位：/todo?focus=<todoId>（客户时间线鱼骨穿透入口）——
  // 默认视图「今天」未必包含目标，先切「全部待办」确保可见，再滚动 + 高亮 + 挂临时 ring
  const focusId = searchParams.get('focus') ?? undefined
  const [focusRingId, setFocusRingId] = useState<string | null>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  useEffect(() => {
    if (!focusId) return
    setSelListId(null)
    setSelKind('all')
    setChipP1(false)
    setChipDone(false)
    // 等过滤切换生效、列表重渲染后再滚动定位
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
  }, [focusId, setSearchParams])

  const todayStr = dayjs().format('YYYY-MM-DD')

  // 列表统一按添加时间（createdAt）排序，可通过按钮切换升序/降序，筛选视图沿用同一顺序
  const sortedTodos = useMemo(
    () =>
      [...todos].sort((a, b) => {
        const d = (a.createdAt ?? 0) - (b.createdAt ?? 0)
        return sortDir === 'asc' ? d : -d
      }),
    [todos, sortDir],
  )
  // 未完成口径统一走领域层 isTodoOpen()，不再手写 status !== 'done'
  const openTodos = sortedTodos.filter(isTodoOpen)
  // 逾期提醒（P1-2 死开关接通）：全局未完成且已过截止时间，按设置开关决定是否提示
  const overdueTodos = useMemo(
    () => openTodos.filter((t) => t.dueAt && dayjs(t.dueAt).isBefore(dayjs())),
    [openTodos],
  )

  // 日历日边界：今天 = 今日截止 ∪ 逾期未完成；最近七天 = [今天, +7天] ∪ 逾期未完成
  const weekEndStr = dayjs().add(7, 'day').format('YYYY-MM-DD')
  // 智能视图范围口径：未完成恒可见；已完成仅勾选「已完成」Chip 时纳入本视图范围（Issue #111）。
  // 已完成按各视图同口径归属：今天=完成时间在今天（无完成时间回退截止日期）、最近七天=落在区间内、收集箱=无清单。
  const matchesSmart = (t: Todo, includeDone: boolean): boolean => {
    if (selKind === 'all') return true
    if (!isTodoOpen(t)) {
      if (!includeDone) return false
      if (selKind === 'inbox') return !t.listId
      const stamp = t.completedAt ?? t.dueAt
      if (!stamp) return false
      const d = dayjs(stamp).format('YYYY-MM-DD')
      if (selKind === 'today') return d === todayStr
      if (selKind === 'week') return todayStr <= d && d <= weekEndStr
      return false
    }
    if (selKind === 'inbox') return !t.listId
    if (!t.dueAt) return false
    const d = dayjs(t.dueAt).format('YYYY-MM-DD')
    if (selKind === 'today') return isDueToday(t, todayStr)
    if (selKind === 'week') return d <= weekEndStr
    return false
  }
  // doneInScope 与 chipDone 解耦统计（Chip 禁用态依据），避免「关 Chip 后范围不含已完成 → 计数 0 → 无法再开启」死循环
  const scopeOf = (includeDone: boolean) =>
    selListId
      ? sortedTodos.filter(
          (t) => t.listId === selListId || (focusRingId !== null && t.id === focusRingId),
        )
      : sortedTodos.filter(
          (t) =>
            matchesSmart(t, includeDone) || (focusRingId !== null && t.id === focusRingId),
        )
  const baseScope = scopeOf(chipDone)
  // 当前视图范围内（含未勾选时潜在可见的已完成）的已完成数：为 0 时「已完成」Chip 置灰
  const doneInScope = scopeOf(true).filter((t) => !isTodoOpen(t)).length
  // P1 / 已完成降级为右侧筛选 Chip，作用于当前左栏视图/清单之内；全部未命中时兜底展示空态
  const filtered = baseScope.filter((t) => {
    if (chipP1 && !(isTodoOpen(t) && t.priority === 'P1')) return false
    if (chipDone && isTodoOpen(t)) return false
    return true
  })

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

  // 固定视图顺序：全部待办 → 收集箱 → 今天 → 最近七天，之后分割线接「我的清单」
  const inboxCount = openTodos.filter((t) => !t.listId).length
  const smartLists: {
    key: Filter
    icon: string
    label: string
    count: number
    /** 突出显示的固定入口：未选中时也用主色调样式与普通清单拉开层次 */
    prominent?: boolean
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
      key: 'week',
      icon: 'calendar_month',
      label: '最近七天',
      count: openTodos.filter((t) => t.dueAt && dayjs(t.dueAt).format('YYYY-MM-DD') <= weekEndStr)
        .length,
    },
  ]
  const selSmart = smartLists.find((l) => l.key === selKind)
  const selCustom = lists.find((l) => l.id === selListId)
  const selLabel = selCustom ? selCustom.name : (selSmart?.label ?? '待办')

  function selectSmart(key: Filter) {
    setSelListId(null)
    setChipP1(false)
    setChipDone(false)
    setSelKind(key)
  }
  function selectList(id: string) {
    setSelListId(id)
    // 切换清单时同步重置筛选 Chip，与切换固定视图一致
    setChipP1(false)
    setChipDone(false)
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
      setChipP1(false)
      setChipDone(false)
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
              setChipP1(false)
              setChipDone(false)
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
          {smartLists.map((l) => (
            <button
              key={l.key}
              onClick={() => selectSmart(l.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.9643rem] transition-colors ${
                !selListId && selKind === l.key
                  ? l.prominent
                    ? 'bg-primary font-semibold text-on-primary'
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
              {/* P1 / 已完成筛选 Chip：作用于当前左栏视图/清单之内，点击切换、再点清除 */}
              <button
                onClick={() => setChipP1((v) => !v)}
                className={`rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium transition-colors ${
                  chipP1
                    ? 'bg-danger-container text-danger'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                P1{chipP1 && ' ✕'}
              </button>
              <button
                onClick={() => setChipDone((v) => !v)}
                disabled={doneInScope === 0}
                title={doneInScope === 0 ? '当前视图暂无已完成待办' : undefined}
                className={`rounded-full px-2.5 py-0.5 text-[0.8571rem] font-medium transition-colors ${
                  chipDone
                    ? 'bg-primary-fixed text-primary'
                    : doneInScope === 0
                      ? 'cursor-not-allowed bg-surface-container text-outline/60'
                      : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                已完成{chipDone && ' ✕'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {/* 排序按钮：按创建时间升序 / 降序 */}
              <button
                onClick={() => setSortDir('asc')}
                title="按创建时间升序"
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
                title="按创建时间降序"
                className={`rounded-lg p-1.5 transition-colors ${
                  sortDir === 'desc'
                    ? 'bg-primary-fixed text-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <Icon name="arrow_downward" size={18} />
              </button>
              <span className="text-[0.7857rem] text-outline">
                {chipDone ? `${filtered.length} 条` : `${filtered.length} 条未完成`}
              </span>
            </div>
          </Card>
          {filtered.length === 0 ? (
            <Card className="p-6">
              {(chipP1 || chipDone) && baseScope.length > 0 ? (
                <EmptyState
                  icon="filter_alt_off"
                  title="当前筛选没有命中"
                  description="试试取消上方筛选，查看本视图全部内容"
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
                    className={`group flex items-center gap-3 rounded-lg py-3.5 transition-all duration-300 ${
                      isFocusRing
                        ? 'focus:outline-2 focus:outline-primary bg-primary-fixed/60 -mx-2 px-2'
                        : ''
                    }`}
                  >
                    <button onClick={() => toggle(t)} className="shrink-0">
                      <Icon
                        name={!isTodoOpen(t) ? 'check_circle' : 'radio_button_unchecked'}
                        size={20}
                        fill={!isTodoOpen(t)}
                        className={
                          isTodoOpen(t) && t.priority === 'P1'
                            ? 'text-danger'
                            : isTodoOpen(t)
                              ? 'text-outline'
                              : ''
                        }
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[1rem] ${
                          !isTodoOpen(t) ? 'text-outline line-through' : 'font-medium'
                        }`}
                      >
                        {t.title}
                        {/* 状态只留两态（Issue #74），「专注中」为专注计时运行时态，与持久化状态独立 */}
                        {isDoing && (
                          <span className="ml-2 align-middle">
                            <Chip tone="blue" icon="timer">
                              专注中
                            </Chip>
                          </span>
                        )}
                      </div>
                      {t.dueAt && (
                        <div className="mt-0.5 text-[0.8571rem] text-outline">
                          截止 {dayjs(t.dueAt).format('M月D日 HH:mm')}
                          {isTodoOpen(t) && dayjs(t.dueAt).isBefore(dayjs()) && (
                            <span className="ml-1.5 text-danger">已逾期</span>
                          )}
                        </div>
                      )}
                      {/* 归属信息：仅在有归属时展示；弱引用被级联解绑后自然消失，可即时感知 */}
                      {(() => {
                        const owner = [
                          t.customerId ? `客户 ${customerName.get(t.customerId) ?? '已删除'}` : null,
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
                    <Chip
                      tone={t.priority === 'P1' ? 'red' : t.priority === 'P2' ? 'amber' : 'gray'}
                    >
                      {t.priority}
                    </Chip>
                    {isTodoOpen(t) && (
                      <Button
                        size="sm"
                        variant="tonal"
                        icon="timer"
                        onClick={() => focus.start(t.id, t.title)}
                      >
                        专注
                      </Button>
                    )}
                    <button
                      title="编辑待办"
                      className="text-outline opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                      onClick={() => setEditing(t)}
                    >
                      <Icon name="edit" size={18} />
                    </button>
                    <button
                      title="删除待办"
                      className="text-outline opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      onClick={() => setConfirmTodo(t)}
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

      <ConfirmDialog
        open={confirmTodo !== null}
        title={`删除待办「${confirmTodo?.title ?? ''}」`}
        message="删除后该待办将不再显示，且暂无回收站入口，此操作不可撤销。"
        confirmText="删除"
        danger
        onConfirm={() => {
          const t = confirmTodo
          setConfirmTodo(null)
          if (t) void todoRepo.softDelete(t.id)
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
          // 新建兜底：当前视图装不下新条目时自动切「全部待办」，避免保存成功却"看不到任何反应"。
          // 覆盖全部视图枚举：清单匹配、全部待办(恒可见)、今天/最近七天(含逾期口径)、收集箱(listId 空)、P1/已完成 Chip
          const savedDay = saved.dueAt ? dayjs(saved.dueAt).format('YYYY-MM-DD') : undefined
          const visible = selListId
            ? saved.listId === selListId
            : selKind === 'all'
              ? true
              : selKind === 'inbox'
                ? !saved.listId
                : selKind === 'today'
                  ? isTodoOpen(saved) && !!savedDay && savedDay <= todayStr
                  : isTodoOpen(saved) && !!savedDay && savedDay <= weekEndStr
          const chipOk =
            (!chipP1 || (isTodoOpen(saved) && saved.priority === 'P1')) &&
            (!chipDone || !isTodoOpen(saved))
          if (!visible || !chipOk) {
            setSelListId(null)
            setChipP1(false)
            // 已完成条目仅在勾选「已完成」Chip 时可见，兜底切视图时同步勾上（Issue #111）
            setChipDone(!isTodoOpen(saved))
            setSelKind('all')
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
  const customers = useCollection<Customer>('customers')
  const projects = useCollection<Project>('projects')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState<Todo['priority']>('P2')
  // 状态两态（Issue #74）：仅待处理/已完成，完成时间与 status 成对写入
  const [status, setStatus] = useState<Todo['status']>('todo')
  const [dueAt, setDueAt] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [listId, setListId] = useState('')
  const [projectId, setProjectId] = useState('')
  const listOptions = useTodoListOptions()
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)
  const titleRef = useAutoFocus<HTMLInputElement>(open)

  // 打开时重置
  const openKey = `${open}-${todo?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    setTitle(todo?.title ?? '')
    setDesc(todo?.desc ?? '')
    setPriority(todo?.priority ?? 'P2')
    setStatus(todo?.status ?? 'todo')
    setDueAt(todo?.dueAt ? dayjs(todo.dueAt).format('YYYY-MM-DDTHH:mm') : '')
    setCustomerId(todo?.customerId ?? '')
    setListId(todo?.listId ?? '')
    setProjectId(todo?.projectId ?? '')
    setError('')
    setSeedKey((k) => k + 1)
  }

  async function save() {
    if (!title.trim()) {
      setError('标题不能为空')
      return
    }
    // 以旧记录展开为基底，仅覆盖表单字段，保留 habitId/ledgerId/completedAt 等
    const base: Todo = {
      ...todo,
      id: todo?.id ?? newId('td'),
      title: title.trim(),
      desc: desc.trim(),
      priority,
      status,
      // 完成时间与状态成对维护：切到 done 时补时间戳，切离 done 时显式清空
      completedAt: status === 'done' ? (todo?.completedAt ?? Date.now()) : undefined,
      dueAt: dueAt ? dayjs(dueAt).valueOf() : undefined,
      customerId: customerId || undefined,
      listId: listId || undefined,
      projectId: projectId || undefined,
      createdAt: todo?.createdAt ?? Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    }
    await todoRepo.put(base)
    onSaved?.(base)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={todo ? '编辑待办' : '新建待办'}
      onClose={onClose}
      size="md"
    >
      <div key={seedKey}>
        <Field label="标题 *">
          <input
            ref={titleRef}
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="要做什么？"
          />
        </Field>
        <Field label="描述">
          <textarea
            className={`${inputCls} h-20 resize-none`}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </Field>
        <Field label="优先级">
          <div className="flex gap-2">
            {(['P1', 'P2', 'P3'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`rounded-lg border px-4 py-1.5 text-[0.9286rem] ${
                  priority === p
                    ? 'border-primary bg-primary-fixed font-semibold text-primary'
                    : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="状态">
          <div className="flex gap-2">
            {(
              [
                { key: 'todo', label: '待处理' },
                { key: 'done', label: '已完成' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setStatus(opt.key)}
                className={`rounded-lg border px-4 py-1.5 text-[0.9286rem] ${
                  status === opt.key
                    ? 'border-primary bg-primary-fixed font-semibold text-primary'
                    : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
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
              archived: p.status === 'archived',
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

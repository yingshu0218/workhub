import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import { todoRepo, newId } from '@/repositories'
import type { Todo, Customer, Project } from '@/db/types'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  PageHeader,
  Drawer,
  Field,
  inputCls,
} from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import dayjs from 'dayjs'
import { useFocusStore } from '@/stores/focus'
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
  const [selKind, setSelKind] = useState<Filter>('all')
  const [chipP1, setChipP1] = useState(false)
  const [chipDone, setChipDone] = useState(false)
  const [selListId, setSelListId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [creating, setCreating] = useState(false)
  const focus = useFocusStore()

  // 清单管理交互态
  const [creatingList, setCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

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

  // 列表统一按添加时间（createdAt）排序，筛选视图沿用同一顺序
  const sortedTodos = useMemo(
    () => [...todos].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [todos],
  )
  const openTodos = sortedTodos.filter((t) => t.status !== 'done')

  // 日历日边界：今天 = 今日截止 ∪ 逾期未完成；最近七天 = [今天, +7天] ∪ 逾期未完成
  const weekEndStr = dayjs().add(7, 'day').format('YYYY-MM-DD')
  const matchesSmart = (t: Todo): boolean => {
    if (t.status !== 'done') {
      if (selKind === 'all') return true
      if (selKind === 'inbox') return !t.listId
      if (!t.dueAt) return false
      const d = dayjs(t.dueAt).format('YYYY-MM-DD')
      if (selKind === 'today') return d <= todayStr
      if (selKind === 'week') return d <= weekEndStr
    }
    return false
  }
  const baseScope = selListId
    ? sortedTodos.filter(
        (t) => t.listId === selListId || (focusRingId !== null && t.id === focusRingId),
      )
    : sortedTodos.filter((t) => matchesSmart(t) || (focusRingId !== null && t.id === focusRingId))
  // P1 / 已完成降级为右侧筛选 Chip，作用于当前左栏视图/清单之内；全部未命中时兜底展示空态
  const filtered = baseScope.filter((t) => {
    if (chipP1 && !(t.status !== 'done' && t.priority === 'P1')) return false
    if (chipDone && t.status !== 'done') return false
    return true
  })

  async function toggle(t: Todo) {
    if (t.status === 'done') {
      await todoRepo.put({ ...t, status: 'todo', completedAt: undefined })
    } else {
      await todoRepo.put({ ...t, status: 'done', completedAt: Date.now() })
    }
  }

  // 固定视图顺序：全部待办（默认）→ 今天 → 最近七天 → 收集箱，之后分割线接「我的清单」
  const inboxCount = openTodos.filter((t) => !t.listId).length
  const smartLists: { key: Filter; icon: string; label: string; count: number }[] = [
    { key: 'all', icon: 'list', label: '全部待办', count: openTodos.length },
    {
      key: 'today',
      icon: 'today',
      label: '今天',
      count: openTodos.filter((t) => t.dueAt && dayjs(t.dueAt).format('YYYY-MM-DD') <= todayStr)
        .length,
    },
    {
      key: 'week',
      icon: 'calendar_month',
      label: '最近七天',
      count: openTodos.filter((t) => t.dueAt && dayjs(t.dueAt).format('YYYY-MM-DD') <= weekEndStr)
        .length,
    },
    { key: 'inbox', icon: 'move_to_inbox', label: '收集箱', count: inboxCount },
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

  async function removeList(id: string) {
    const list = lists.find((l) => l.id === id)
    if (!list) return
    const n = todos.filter((t) => t.listId === id && t.status !== 'done').length
    if (!window.confirm(`删除清单「${list.name}」？名下 ${n} 条未完成待办将移入「全部待办」。`))
      return
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
    ids.splice(to, 0, ids.splice(from, 1)[0])
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

      <div className="grid grid-cols-[240px_1fr] gap-4 items-start">
        {/* 左侧清单：智能清单 + 我的清单（增删改/拖拽排序） */}
        <Card className="p-2">
          <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-outline">
            智能清单
          </div>
          {smartLists.map((l) => (
            <button
              key={l.key}
              onClick={() => selectSmart(l.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                !selListId && selKind === l.key
                  ? 'bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              <Icon name={l.icon} size={19} />
              <span className="flex-1 text-left">{l.label}</span>
              <span className="text-[11px] text-outline">{l.count}</span>
            </button>
          ))}

          <div className="mt-3 flex items-center justify-between border-t border-outline-variant/40 px-3 pt-2 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-outline">
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
              className={`group/list flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                selListId === l.id
                  ? 'bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              <span
                className="cursor-grab text-[14px] leading-none text-outline/60 group-hover/list:text-outline"
                title="拖动排序"
              >
                ⠿
              </span>
              {renamingId === l.id ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-primary px-1.5 py-0.5 text-[13px] outline-none"
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
              <span className="text-[11px] text-outline">{listCounts[l.id] ?? 0}</span>
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
                  onClick={() => void removeList(l.id)}
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
                className="w-full rounded border border-primary px-2 py-1.5 text-[13px] outline-none"
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
              <span className="text-[13px] font-semibold">{selLabel}</span>
              {/* P1 / 已完成筛选 Chip：作用于当前左栏视图/清单之内，点击切换、再点清除 */}
              <button
                onClick={() => setChipP1((v) => !v)}
                className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors ${
                  chipP1
                    ? 'bg-danger-container text-danger'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                P1{chipP1 && ' ✕'}
              </button>
              <button
                onClick={() => setChipDone((v) => !v)}
                className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors ${
                  chipDone
                    ? 'bg-primary-fixed text-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                已完成{chipDone && ' ✕'}
              </button>
            </div>
            <span className="text-[11px] text-outline">
              {chipDone ? `${filtered.length} 条` : `${filtered.length} 条未完成`}
            </span>
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
                        name={t.status === 'done' ? 'check_circle' : 'radio_button_unchecked'}
                        size={20}
                        fill={t.status === 'done'}
                        className={
                          t.status !== 'done' && t.priority === 'P1'
                            ? 'text-danger'
                            : t.status !== 'done'
                              ? 'text-outline'
                              : ''
                        }
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[14px] ${
                          t.status === 'done' ? 'text-outline line-through' : 'font-medium'
                        }`}
                      >
                        {t.title}
                        {isDoing && (
                          <span className="ml-2 align-middle">
                            <Chip tone="blue" icon="timer">
                              专注中
                            </Chip>
                          </span>
                        )}
                      </div>
                      {t.dueAt && (
                        <div className="mt-0.5 text-[12px] text-outline">
                          截止 {dayjs(t.dueAt).format('M月D日 HH:mm')}
                          {t.status !== 'done' && dayjs(t.dueAt).isBefore(dayjs()) && (
                            <span className="ml-1.5 text-danger">已逾期</span>
                          )}
                        </div>
                      )}
                    </div>
                    <Chip
                      tone={t.priority === 'P1' ? 'red' : t.priority === 'P2' ? 'amber' : 'gray'}
                    >
                      {t.priority}
                    </Chip>
                    {t.status !== 'done' && (
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
                      className="text-outline opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      onClick={() => todoRepo.softDelete(t.id)}
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
                  ? saved.status !== 'done' && !!savedDay && savedDay <= todayStr
                  : saved.status !== 'done' && !!savedDay && savedDay <= weekEndStr
          const chipOk =
            (!chipP1 || (saved.status !== 'done' && saved.priority === 'P1')) &&
            (!chipDone || saved.status === 'done')
          if (!visible || !chipOk) {
            setSelListId(null)
            setChipP1(false)
            setChipDone(false)
            setSelKind('all')
          }
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
  const [dueAt, setDueAt] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [listId, setListId] = useState('')
  const [projectId, setProjectId] = useState('')
  const listOptions = useTodoListOptions()
  const [error, setError] = useState('')
  const [seedKey, setSeedKey] = useState(0)

  // 打开时重置
  const openKey = `${open}-${todo?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState('')
  if (openKey !== lastKey) {
    setLastKey(openKey)
    setTitle(todo?.title ?? '')
    setDesc(todo?.desc ?? '')
    setPriority(todo?.priority ?? 'P2')
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
      status: todo?.status ?? 'todo',
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
    <Drawer open={open} title={todo ? '编辑待办' : '新建待办'} onClose={onClose}>
      <div key={seedKey}>
        <Field label="标题 *">
          <input
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="要做什么？"
            autoFocus
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
                className={`rounded-lg border px-4 py-1.5 text-[13px] ${
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
        {error && <div className="mb-3 text-[12px] text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tonal" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save}>{todo ? '保存修改' : '创建待办'}</Button>
        </div>
      </div>
    </Drawer>
  )
}

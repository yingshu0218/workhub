import { useState } from 'react'
import { useCollection } from '@/queries/hooks'
import { todoRepo, newId } from '@/repositories'
import type { Todo, Customer } from '@/db/types'
import { Button, Card, Chip, EmptyState, PageHeader, Drawer, Field, inputCls } from '@/design-system/ui'
import dayjs from 'dayjs'
import { useFocusStore } from '@/stores/focus'

type Filter = 'today' | 'open' | 'done'

export default function TodoPage() {
  const todos = useCollection<Todo>('todos')
  const [filter, setFilter] = useState<Filter>('today')
  const [editing, setEditing] = useState<Todo | null>(null)
  const [creating, setCreating] = useState(false)
  const focus = useFocusStore()

  const todayStr = dayjs().format('YYYY-MM-DD')
  const filtered = todos.filter((t) => {
    if (filter === 'done') return t.status === 'done'
    if (filter === 'today')
      return t.status !== 'done' && (!t.dueAt || dayjs(t.dueAt).format('YYYY-MM-DD') === todayStr)
    return t.status !== 'done'
  })

  async function toggle(t: Todo) {
    if (t.status === 'done') {
      await todoRepo.put({ ...t, status: 'todo', completedAt: undefined })
    } else {
      await todoRepo.put({ ...t, status: 'done', completedAt: Date.now() })
    }
  }

  const tabs: { key: Filter; label: string }[] = [
    { key: 'today', label: '今日' },
    { key: 'open', label: '全部待办' },
    { key: 'done', label: '已完成' },
  ]

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

      <div className="mb-4 flex gap-1 rounded-lg bg-surface-container p-1" style={{ width: 'fit-content' }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-md px-4 py-1.5 text-[13px] transition-colors ${
              filter === tab.key
                ? 'bg-surface-container-lowest font-semibold text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon="task_alt" title="这里空空如也" description="点击右上角新建待办" />
        </Card>
      ) : (
        <Card className="divide-y divide-outline-variant/30 px-5">
          {filtered.map((t) => {
            const isDoing = focus.todoId === t.id && focus.status === 'running'
            return (
              <div key={t.id} className="group flex items-center gap-3 py-3.5">
                <button onClick={() => toggle(t)} className="shrink-0">
                  <span
                    className={`material-symbols-rounded ${
                      t.status === 'done' ? 'msr-fill text-success' : t.priority === 'P1' ? 'text-danger' : 'text-outline'
                    }`}
                  >
                    {t.status === 'done' ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-[14px] ${
                      t.status === 'done' ? 'text-outline line-through' : 'font-medium'
                    }`}
                  >
                    {t.title}
                    {isDoing && <span className="ml-2 align-middle"><Chip tone="blue" icon="timer">专注中</Chip></span>}
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
                <Chip tone={t.priority === 'P1' ? 'red' : t.priority === 'P2' ? 'amber' : 'gray'}>
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
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>delete</span>
                </button>
              </div>
            )
          })}
        </Card>
      )}

      <TodoFormDrawer
        open={creating || editing !== null}
        todo={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

export function TodoFormDrawer({
  open,
  todo,
  onClose,
}: {
  open: boolean
  todo: Todo | null
  onClose: () => void
}) {
  const customers = useCollection<Customer>('customers')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState<Todo['priority']>('P2')
  const [dueAt, setDueAt] = useState('')
  const [customerId, setCustomerId] = useState('')
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
    setError('')
    setSeedKey((k) => k + 1)
  }

  async function save() {
    if (!title.trim()) {
      setError('标题不能为空')
      return
    }
    const base: Todo = {
      id: todo?.id ?? newId('td'),
      title: title.trim(),
      desc: desc.trim(),
      priority,
      status: todo?.status ?? 'todo',
      dueAt: dueAt ? dayjs(dueAt).valueOf() : undefined,
      customerId: customerId || undefined,
      createdAt: todo?.createdAt ?? Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    }
    await todoRepo.put(base)
    onClose()
  }

  return (
    <Drawer open={open} title={todo ? '编辑待办' : '新建待办'} onClose={onClose}>
      <div key={seedKey}>
        <Field label="标题 *">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="要做什么？" autoFocus />
        </Field>
        <Field label="描述">
          <textarea className={`${inputCls} h-20 resize-none`} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label="优先级">
          <div className="flex gap-2">
            {(['P1', 'P2', 'P3'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`rounded-lg border px-4 py-1.5 text-[13px] ${
                  priority === p ? 'border-primary bg-primary-fixed font-semibold text-primary' : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="截止时间">
          <input type="datetime-local" className={inputCls} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field label="关联客户">
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">不关联</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.company}
              </option>
            ))}
          </select>
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

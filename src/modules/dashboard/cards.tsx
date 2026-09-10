import { useCollection, useTodayFocusMinutes } from '@/queries/hooks'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useFocusStore, FOCUS_TOTAL_SEC } from '@/stores/focus'
import { Button, Card, Chip } from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import { eventBus } from '@/shared/eventBus'
import { todoRepo, habitLogRepo, habitLogId, newId } from '@/repositories'
import { toggleTodoDone } from '@/modules/todo/toggle'
import { isDueToday, isTodoOpen } from '@/modules/todo/domain'
import { useState } from 'react'
import type { Todo, Customer, Ledger } from '@/db/types'
import dayjs from 'dayjs'

function fmt(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

/** NOW DOING · 25min 深度专注计时器 */
export function FocusCard() {
  const focus = useFocusStore()
  const navigate = useNavigate()
  const todos = useCollection<Todo>('todos')
  const customers = useCollection<Customer>('customers')
  const ledgers = useCollection<Ledger>('ledgers')
  const doing = todos.find((t) => t.id === focus.todoId)
  const openTodos = todos.filter(isTodoOpen)

  // 专注进行中时的关联实体引用（对齐原型 01）：无关联则不显示
  const refCustomer = doing?.customerId
    ? customers.find((c) => c.id === doing.customerId)
    : undefined
  const refLedger = doing?.ledgerId ? ledgers.find((l) => l.id === doing.ledgerId) : undefined
  const customerLabel = refCustomer
    ? refCustomer.company
      ? `${refCustomer.company} · ${refCustomer.name}`
      : refCustomer.name
    : ''

  // 今日专注分钟数（本地推导，不参与同步）
  const todayMinutes = useTodayFocusMinutes()

  const pct = 1 - focus.remaining / FOCUS_TOTAL_SEC
  const circumference = 2 * Math.PI * 52

  return (
    <Card className="relative overflow-hidden p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
          <Icon name="track_changes" fill className="text-primary" />
          NOW DOING
        </h2>
        <Chip tone="green" icon="whatshot">
          今日 {todayMinutes} 分钟
        </Chip>
      </div>

      <div className="flex items-center gap-6">
        {/* 计时环 */}
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#e5eeff" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct)}
              style={{ transition: 'stroke-dashoffset 0.5s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[1.5714rem] font-bold tabular-nums">
              {focus.status === 'idle' ? '25:00' : fmt(focus.remaining)}
            </div>
            <div className="text-[0.7857rem] text-outline">
              {focus.status === 'running'
                ? '专注中'
                : focus.status === 'paused'
                  ? '已暂停'
                  : '待开始'}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {focus.status === 'idle' ? (
            <>
              <div className="mb-2 text-[0.9286rem] text-on-surface-variant">
                {doing ? doing.title : '选择一件事，开始 25 分钟深度专注'}
              </div>
              <div className="mb-3">
                <MatchCombobox
                  value={focus.todoId ?? ''}
                  options={openTodos.map((t) => ({
                    id: t.id,
                    label: t.title,
                    sub: t.priority,
                    icon: 'task_alt',
                  }))}
                  placeholder="自由专注：不选即不关联待办，可输入标题模糊搜索"
                  emptyText="暂无未完成待办"
                  onChange={(id) => {
                    const t = todos.find((x) => x.id === id)
                    useFocusStore.setState({ todoId: t?.id, todoTitle: t?.title })
                  }}
                />
              </div>
              <Button
                icon="play_arrow"
                onClick={() =>
                  focus.start(useFocusStore.getState().todoId, useFocusStore.getState().todoTitle)
                }
              >
                开始专注
              </Button>
            </>
          ) : (
            <>
              <div className="mb-1 truncate text-[1rem] font-semibold">
                {focus.todoTitle ?? '自由专注'}
              </div>
              <div className="mb-3 text-[0.8571rem] text-on-surface-variant">
                完成后自动打卡「深度专注」习惯
              </div>
              {/* 关联引用小卡（对齐原型 01）：客户 / 财务账本 */}
              {(refCustomer || refLedger) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {refCustomer && (
                    <button
                      className="flex max-w-full min-w-0 items-center gap-1.5 surface-card-low !bg-surface-container-low px-2.5 py-1.5 text-left transition-colors hover:border-primary"
                      title="打开客户详情"
                      onClick={() => navigate(`/crm/${refCustomer.id}`)}
                    >
                      <Icon name="group" size={14} className="shrink-0 text-primary" />
                      <span className="shrink-0 text-[0.75rem] font-medium text-outline">
                        关联客户
                      </span>
                      <span className="truncate text-[0.8214rem] font-medium text-primary">
                        {customerLabel}
                      </span>
                    </button>
                  )}
                  {refLedger && (
                    <button
                      className="flex max-w-full min-w-0 items-center gap-1.5 surface-card-low !bg-surface-container-low px-2.5 py-1.5 text-left transition-colors hover:border-primary"
                      title="打开财务账本"
                      onClick={() => navigate('/finance')}
                    >
                      <Icon
                        name="account_balance_wallet"
                        size={14}
                        className="shrink-0 text-warning"
                      />
                      <span className="shrink-0 text-[0.75rem] font-medium text-outline">
                        关联账本
                      </span>
                      <span className="truncate text-[0.8214rem] font-medium text-primary">
                        {refLedger.name}
                      </span>
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                {focus.status === 'running' ? (
                  <Button size="sm" variant="tonal" icon="pause" onClick={focus.pause}>
                    暂停
                  </Button>
                ) : (
                  <Button size="sm" variant="tonal" icon="play_arrow" onClick={focus.resume}>
                    继续
                  </Button>
                )}
                <Button size="sm" icon="check" onClick={() => void focus.finish()}>
                  完成专注
                </Button>
                <Button size="sm" variant="ghost" onClick={focus.abort}>
                  放弃
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

/** 每日习惯闭环（预览版：打卡交互，P5 实装热力图） */
export function HabitLoopCard() {
  const habits = useCollection<import('@/db/types').Habit>('habits')
  const logs = useCollection<import('@/db/types').HabitLog>('habitLogs')
  const todayStr = dayjs().format('YYYY-MM-DD')

  async function toggle(habitId: string) {
    const existing = logs.find((l) => l.habitId === habitId && l.date === todayStr)
    if (existing) {
      await habitLogRepo.softDelete(existing.id)
    } else {
      // 确定性 id 幂等：同日同习惯恒为同一条记录（若之前软删过则原地复活）
      await habitLogRepo.put({
        id: habitLogId(habitId, todayStr),
        habitId,
        date: todayStr,
        completedAt: Date.now(),
      })
      eventBus.emit('habit:checked', { habitId, date: todayStr })
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[1.0714rem] font-semibold">每日习惯闭环</h2>
        <Chip tone="amber" icon="local_fire_department">
          21 天稳态
        </Chip>
      </div>
      <ul className="space-y-2">
        {habits.map((h) => {
          const doneToday = logs.some((l) => l.habitId === h.id && l.date === todayStr)
          const streak = (function () {
            const dates = new Set(logs.filter((l) => l.habitId === h.id).map((l) => l.date))
            let n = 0
            let cursor = dates.has(todayStr) ? dayjs() : dayjs().subtract(1, 'day')
            while (dates.has(cursor.format('YYYY-MM-DD'))) {
              n++
              cursor = cursor.subtract(1, 'day')
            }
            return n
          })()
          return (
            <li
              key={h.id}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-container-low"
            >
              <button onClick={() => void toggle(h.id)}>
                <Icon
                  name={doneToday ? 'check_circle' : 'circle'}
                  size={26}
                  fill={doneToday}
                  className={doneToday ? 'text-success' : 'text-outline'}
                />
              </button>
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md text-white"
                style={{ background: h.color }}
              >
                <Icon name={h.icon} size={16} />
              </span>
              <div className="flex-1">
                <div className="text-[0.9643rem] font-medium">{h.name}</div>
                <div className="text-[0.7857rem] text-outline">
                  {h.schedule} · {h.targetMinutes} 分钟
                </div>
              </div>
              {streak > 0 && (
                <Chip tone={streak >= 21 ? 'green' : 'amber'} icon="local_fire_department">
                  {streak} 天
                </Chip>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** 随手速记 · 转待办 / 归笔记 */
/** 今日待办日程（对齐原型 01：时间轴待办 + 已完成划线 + 进入待办中心） */
export function TodayTodosCard() {
  const todos = useCollection<Todo>('todos')
  const todayStr = dayjs().format('YYYY-MM-DD')
  const list = todos
    // 「今天」口径（Issue #74）：今日截止 ∪ 逾期未完成，与待办中心一致
    .filter((t) => isDueToday(t, todayStr))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
  const doneToday = todos.filter(
    (t) =>
      t.status === 'done' &&
      t.completedAt &&
      dayjs(t.completedAt).format('YYYY-MM-DD') === todayStr,
  )

  // 打勾完成/取消完成统一走领域函数（与待办中心同一口径，Issue #74）
  async function toggle(t: Todo) {
    await toggleTodoDone(t)
  }

  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
          今日待办日程
          <Chip tone="blue">{list.length} 待完成</Chip>
        </h2>
        <button
          className="text-outline hover:text-primary"
          title="新建待办"
          onClick={() => (location.href = '/todo?new=1')}
        >
          <Icon name="add" size={20} />
        </button>
      </div>

      {list.length === 0 && doneToday.length === 0 ? (
        <div className="py-6 text-center text-[0.8571rem] text-outline">
          今日暂无安排，去待办中心创建 →
        </div>
      ) : (
        <ul className="space-y-1 overflow-y-auto">
          {list.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-container-low"
            >
              <button onClick={() => void toggle(t)} className="mt-0.5 shrink-0">
                <Icon name="radio_button_unchecked" size={20} className="text-outline" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.9643rem] font-medium">{t.title}</div>
                {t.dueAt && (
                  <div
                    className={`text-[0.7857rem] ${dayjs(t.dueAt).isBefore(dayjs()) ? 'text-danger' : 'text-outline'}`}
                  >
                    {dayjs(t.dueAt).format('HH:mm')}
                    {t.priority === 'P1' && <span className="ml-1.5 font-medium">P1 紧急</span>}
                  </div>
                )}
              </div>
              <button
                className="shrink-0 text-[0.7857rem] text-primary hover:underline"
                onClick={() => void toggle(t)}
              >
                完成
              </button>
            </li>
          ))}
          {doneToday.slice(0, 3).map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <button onClick={() => void toggle(t)} className="shrink-0">
                <Icon name="check_box" size={20} fill className="text-success" />
              </button>
              <span className="min-w-0 flex-1 truncate text-[0.8929rem] text-outline line-through">
                {t.title}
              </span>
              <Chip tone="green">已完成</Chip>
            </li>
          ))}
        </ul>
      )}

      <button
        className="mt-3 border-t border-outline-variant/40 pt-3 text-left text-[0.8571rem] text-primary hover:underline"
        onClick={() => (location.href = '/todo')}
      >
        进入待办事项中心查看全部（{todos.filter(isTodoOpen).length}）→
      </button>
    </Card>
  )
}

export function QuickNoteCard() {
  const notes = useCollection<import('@/db/types').QuickNote>('quickNotes')
  const [draft, setDraft] = useState('')

  async function add() {
    const content = draft.trim()
    if (!content) return
    const { quickNoteRepo } = await import('@/repositories')
    await quickNoteRepo.put({
      id: newId('qn'),
      content,
      createdAt: Date.now(),
    })
    setDraft('')
  }

  async function convert(id: string, to: 'todo' | 'note') {
    const qn = notes.find((n) => n.id === id)
    if (!qn) return
    if (to === 'todo') {
      await todoRepo.put({
        id: newId('td'),
        title: qn.content.slice(0, 60),
        desc: '由速记便签转入',
        priority: 'P2',
        status: 'todo',
        createdAt: Date.now(),
        updatedAt: 0,
        deleted: 0,
        rev: 0,
      })
    } else {
      const { noteRepo } = await import('@/repositories')
      await noteRepo.put({
        id: newId('n'),
        title: qn.content.slice(0, 30),
        markdown: qn.content,
        tags: ['速记归档'],
        backlinks: [],
        mentions: [],
        createdAt: Date.now(),
        updatedAt: 0,
        deleted: 0,
        rev: 0,
      })
    }
    await (await import('@/repositories')).quickNoteRepo.put({ ...qn, convertedTo: to })
    eventBus.emit('quicknote:convert', { quickNoteId: id, to })
  }

  const pending = notes.filter((n) => !n.convertedTo)

  return (
    <Card className="flex flex-col p-5">
      <h2 className="mb-3 text-[1.0714rem] font-semibold">随手速记</h2>
      <div className="mb-2 flex gap-2">
        <input
          className="flex-1 surface-card border-outline-variant px-3 py-2 text-[0.9286rem] outline-none focus:border-primary"
          placeholder="灵感一闪，先记下来…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Button size="sm" icon="add" onClick={() => void add()} />
      </div>
      {/* 字符计数（对齐原型 01：N 字符已录入 · 本地缓存已就绪） */}
      <div className="mb-3 text-right text-[0.7857rem] text-outline">
        {draft.length} 字符已录入 · 本地缓存已就绪
      </div>
      {pending.length === 0 ? (
        <div className="py-6 text-center text-[0.8571rem] text-outline">暂存区已清空</div>
      ) : (
        <ul className="space-y-2 overflow-y-auto">
          {pending.map((n) => (
            <li key={n.id} className="group list-row">
              <div className="text-[0.9286rem] leading-snug">{n.content}</div>
              <div className="mt-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  size="sm"
                  variant="tonal"
                  icon="check_circle"
                  onClick={() => void convert(n.id, 'todo')}
                >
                  转待办
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="description"
                  onClick={() => void convert(n.id, 'note')}
                >
                  归笔记
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

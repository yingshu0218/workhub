import { useCollection, useTodayFocusMinutes } from '@/queries/hooks'
import { useFocusStore, FOCUS_TOTAL_SEC } from '@/stores/focus'
import { Button, Card, Chip } from '@/design-system/ui'
import { eventBus } from '@/shared/eventBus'
import { todoRepo, habitLogRepo, habitLogId, newId } from '@/repositories'
import { useState } from 'react'
import type { Todo } from '@/db/types'
import dayjs from 'dayjs'

function fmt(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

/** NOW DOING · 25min 深度专注计时器 */
export function FocusCard() {
  const focus = useFocusStore()
  const todos = useCollection<Todo>('todos')
  const doing = todos.find((t) => t.id === focus.todoId)
  const openTodos = todos.filter((t) => t.status !== 'done' && t.id !== focus.todoId)

  // 今日专注分钟数（本地推导，不参与同步）
  const todayMinutes = useTodayFocusMinutes()

  const pct = 1 - focus.remaining / FOCUS_TOTAL_SEC
  const circumference = 2 * Math.PI * 52

  return (
    <Card className="relative overflow-hidden p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="material-symbols-rounded msr-fill text-primary">track_changes</span>
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
            <div className="text-[22px] font-bold tabular-nums">
              {focus.status === 'idle' ? '25:00' : fmt(focus.remaining)}
            </div>
            <div className="text-[11px] text-outline">
              {focus.status === 'running' ? '专注中' : focus.status === 'paused' ? '已暂停' : '待开始'}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {focus.status === 'idle' ? (
            <>
              <div className="mb-2 text-[13px] text-on-surface-variant">
                {doing ? doing.title : '选择一件事，开始 25 分钟深度专注'}
              </div>
              <select
                className="mb-3 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px]"
                value={focus.todoId ?? ''}
                onChange={(e) => {
                  const t = todos.find((x) => x.id === e.target.value)
                  useFocusStore.setState({ todoId: t?.id, todoTitle: t?.title })
                }}
              >
                <option value="">自由专注（不关联待办）</option>
                {openTodos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <Button
                icon="play_arrow"
                onClick={() => focus.start(useFocusStore.getState().todoId, useFocusStore.getState().todoTitle)}
              >
                开始专注
              </Button>
            </>
          ) : (
            <>
              <div className="mb-1 truncate text-[14px] font-semibold">
                {focus.todoTitle ?? '自由专注'}
              </div>
              <div className="mb-3 text-[12px] text-on-surface-variant">
                完成后自动打卡「深度专注」习惯
              </div>
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
        <h2 className="text-[15px] font-semibold">每日习惯闭环</h2>
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
            <li key={h.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-container-low">
              <button onClick={() => void toggle(h.id)}>
                <span
                  className={`material-symbols-rounded ${doneToday ? 'msr-fill text-success' : 'text-outline'}`}
                  style={{ fontSize: 26 }}
                >
                  {doneToday ? 'check_circle' : 'circle'}
                </span>
              </button>
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md text-white"
                style={{ background: h.color }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>{h.icon}</span>
              </span>
              <div className="flex-1">
                <div className="text-[13.5px] font-medium">{h.name}</div>
                <div className="text-[11px] text-outline">
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
      <h2 className="mb-3 text-[15px] font-semibold">随手速记</h2>
      <div className="mb-3 flex gap-2">
        <input
          className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] outline-none focus:border-primary"
          placeholder="灵感一闪，先记下来…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Button size="sm" icon="add" onClick={() => void add()} />
      </div>
      {pending.length === 0 ? (
        <div className="py-6 text-center text-[12px] text-outline">暂存区已清空</div>
      ) : (
        <ul className="space-y-2 overflow-y-auto">
          {pending.map((n) => (
            <li key={n.id} className="group rounded-lg border border-outline-variant/50 bg-surface-container-low p-3">
              <div className="text-[13px] leading-snug">{n.content}</div>
              <div className="mt-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="sm" variant="tonal" icon="check_circle" onClick={() => void convert(n.id, 'todo')}>
                  转待办
                </Button>
                <Button size="sm" variant="ghost" icon="description" onClick={() => void convert(n.id, 'note')}>
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

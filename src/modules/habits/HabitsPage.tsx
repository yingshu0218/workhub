import { useState } from 'react'
import dayjs from 'dayjs'
import type { Habit } from '@/db/types'
import { habitLogRepo, habitLogId, deleteHabitCascade } from '@/repositories'
import { eventBus } from '@/shared/eventBus'
import { Button, Card, Chip, EmptyState, PageHeader } from '@/design-system/ui'
import { useHabitStats, useHabitMonthCounts, useCompletedHabitsOn, useTodayCheckCount } from './hooks'
import { HabitFormDrawer } from './HabitFormDrawer'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/** 当日完成习惯数 → 热力色阶（0=灰 / 1-2=浅绿 / 3+=深绿） */
function heatClass(count: number): string {
  if (count <= 0) return 'bg-surface-container text-outline'
  if (count <= 2) return 'bg-secondary-container text-on-secondary-container'
  return 'bg-secondary text-on-secondary'
}

export default function HabitsPage() {
  const [month, setMonth] = useState(() => dayjs().format('YYYY-MM'))
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState<Habit | null>(null)
  const [creating, setCreating] = useState(false)

  const stats = useHabitStats(month)
  const counts = useHabitMonthCounts(month)
  const dayHabits = useCompletedHabitsOn(selectedDate)
  const todayDone = useTodayCheckCount()

  const todayStr = dayjs().format('YYYY-MM-DD')
  const monthLabel = dayjs(month + '-01').format('YYYY年M月')
  const daysInMonth = dayjs(month + '-01').daysInMonth()
  // 周一起始的月历前置空位
  const leadingBlanks = (dayjs(month + '-01').day() + 6) % 7

  function shiftMonth(delta: number) {
    setMonth((m) => dayjs(m + '-01').add(delta, 'month').format('YYYY-MM'))
    setSelectedDate(undefined)
  }

  /** 打卡/取消打卡 —— 与工作台 HabitLoopCard 同款 habitLogId 幂等逻辑 */
  async function toggleCheck(habit: Habit, doneToday: boolean) {
    if (doneToday) {
      await habitLogRepo.softDelete(habitLogId(habit.id, todayStr))
    } else {
      await habitLogRepo.put({
        id: habitLogId(habit.id, todayStr),
        habitId: habit.id,
        date: todayStr,
        completedAt: Date.now(),
      })
      eventBus.emit('habit:checked', { habitId: habit.id, date: todayStr })
    }
  }

  /** 删除习惯 —— 确认后单事务级联软删习惯及其全部历史打卡 */
  function removeHabit(habit: Habit, totalChecks: number) {
    const msg =
      totalChecks > 0
        ? `删除习惯「${habit.name}」？\n该习惯已有 ${totalChecks} 次历史打卡记录，将一并删除，此操作不可撤销。`
        : `删除习惯「${habit.name}」？此操作不可撤销。`
    if (confirm(msg)) void deleteHabitCascade(habit.id)
  }

  const monthTotalChecks = stats.reduce((sum, s) => sum + s.monthChecks, 0)

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="打卡习惯"
        subtitle="21 天稳态 · 月历热力图 · 连击追踪"
        actions={
          <Button icon="add" onClick={() => setCreating(true)}>
            新建习惯
          </Button>
        }
      />

      {/* 头部速览 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip tone="amber" icon="local_fire_department">
          今日已打卡 {todayDone} 项
        </Chip>
        <Chip tone="green" icon="verified">
          {monthLabel}累计 {monthTotalChecks} 次
        </Chip>
        {stats.some((s) => s.streak >= 21) && <Chip tone="green" icon="military_tech">21 天稳态达成</Chip>}
      </div>

      {/* 月历热力图 */}
      <Card className="mb-4 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">本月热力图</h2>
          <div className="flex items-center gap-1">
            <button className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-low" onClick={() => shiftMonth(-1)}>
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>chevron_left</span>
            </button>
            <span className="min-w-[88px] text-center text-[13px] font-medium">{monthLabel}</span>
            <button className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-low" onClick={() => shiftMonth(1)}>
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>chevron_right</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-outline">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const date = dayjs(month + '-01').date(i + 1).format('YYYY-MM-DD')
            const count = counts[date] ?? 0
            const isSelected = selectedDate === date
            const isToday = date === todayStr
            const isFuture = dayjs(date).isAfter(dayjs(), 'day')
            return (
              <button
                key={date}
                disabled={isFuture}
                onClick={() => setSelectedDate(isSelected ? undefined : date)}
                className={`flex h-14 flex-col items-start justify-between rounded-lg p-1.5 text-left transition-transform ${heatClass(count)} ${
                  isSelected ? 'ring-2 ring-primary' : ''
                } ${isFuture ? 'opacity-40' : 'hover:scale-105'} ${isToday ? 'ring-1 ring-primary/60' : ''}`}
              >
                <span className="text-[11px] font-semibold">{isToday ? '今' : i + 1}</span>
                {count > 0 && <span className="text-[10px] opacity-80">{count} 项</span>}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-outline">
          <span>少</span>
          <span className="h-3 w-3 rounded bg-surface-container" />
          <span className="h-3 w-3 rounded bg-secondary-container" />
          <span className="h-3 w-3 rounded bg-secondary" />
          <span>多 · 点击某日查看完成明细</span>
        </div>

        {selectedDate && (
          <div className="mt-4 rounded-lg bg-surface-container-low p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold">
                {dayjs(selectedDate).format('M月D日')} 完成明细 · {dayHabits.length} 项
              </span>
              <button className="text-outline hover:text-on-surface" onClick={() => setSelectedDate(undefined)}>
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>
            {dayHabits.length === 0 ? (
              <div className="py-2 text-[12px] text-outline">这一天没有打卡记录</div>
            ) : (
              <ul className="space-y-1.5">
                {dayHabits.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 text-[13px]">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white"
                      style={{ background: h.color }}
                    >
                      <span className="material-symbols-rounded" style={{ fontSize: 14 }}>{h.icon}</span>
                    </span>
                    {h.name}
                    <span className="text-[11px] text-outline">{h.targetMinutes} 分钟</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* 活跃习惯清单 */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">活跃习惯 · {stats.length} 项</h2>
        </div>
        {stats.length === 0 ? (
          <EmptyState icon="event_repeat" title="还没有习惯" description="点击右上角「新建习惯」开始你的第一个稳态闭环" />
        ) : (
          <ul className="divide-y divide-outline-variant/30">
            {stats.map(({ habit, streak, monthChecks, monthRate, doneToday, totalChecks }) => (
              <li key={habit.id} className="group flex items-center gap-3 py-3">
                <button onClick={() => void toggleCheck(habit, doneToday)} className="shrink-0" title={doneToday ? '取消打卡' : '今日打卡'}>
                  <span
                    className={`material-symbols-rounded ${doneToday ? 'msr-fill text-success' : 'text-outline'}`}
                    style={{ fontSize: 26 }}
                  >
                    {doneToday ? 'check_circle' : 'circle'}
                  </span>
                </button>
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ background: habit.color }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>{habit.icon}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{habit.name}</div>
                  <div className="truncate text-[11px] text-outline">
                    {habit.schedule} · {habit.targetMinutes} 分钟{habit.motivationNote ? ` · ${habit.motivationNote}` : ''}
                  </div>
                </div>
                {streak > 0 && (
                  <Chip tone={streak >= 21 ? 'green' : 'amber'} icon="local_fire_department">
                    {streak} 天
                  </Chip>
                )}
                <div className="hidden w-28 shrink-0 text-right sm:block">
                  <div className="text-[11px] text-outline">
                    {monthLabel.slice(0, -1)}完成 {monthChecks} 次 · {monthRate === null ? '—' : `${monthRate}%`}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container">
                    <div
                      className="h-full rounded-full bg-secondary transition-all"
                      style={{ width: `${monthRate === null ? 0 : Math.min(100, monthRate)}%` }}
                    />
                  </div>
                </div>
                <div className="hidden w-16 shrink-0 text-right text-[11px] text-outline lg:block">
                  累计 {totalChecks} 次
                </div>
                <button
                  className="rounded-md p-1.5 text-outline opacity-0 transition-opacity hover:bg-surface-container-low hover:text-primary group-hover:opacity-100"
                  title="编辑"
                  onClick={() => setEditing(habit)}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>edit</span>
                </button>
                <button
                  className="rounded-md p-1.5 text-outline opacity-0 transition-opacity hover:bg-surface-container-low hover:text-danger group-hover:opacity-100"
                  title="删除习惯"
                  onClick={() => removeHabit(habit, totalChecks)}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>delete</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <HabitFormDrawer
        open={creating || editing !== null}
        habit={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

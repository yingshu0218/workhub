import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import dayjs from 'dayjs'
import type { Habit } from '@/db/types'
import { checkinHabit, uncheckHabit, deleteHabitCascade } from '@/repositories'
import { Button, Card, Chip, ConfirmDialog, EmptyState, PageHeader } from '@/design-system/ui'
import {
  useHabitStats,
  useHabitMonthCounts,
  useCompletedHabitsOn,
  useTodayCheckCount,
  useHabitMood,
} from './hooks'
import { HabitFormDrawer } from './HabitFormDrawer'
import { useIsMobile } from '@/shared/useIsMobile'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/** 稳态评语色点（对应设计系统语义色） */
const MOOD_TONE_CLASS: Record<NonNullable<ReturnType<typeof useHabitMood>>['tone'], string> = {
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-danger',
  blue: 'bg-primary',
}

/** 当日完成习惯数 → 热力色阶（0=灰 / 1-2=浅绿 / 3+=深绿） */
function heatClass(count: number): string {
  if (count <= 0) return 'bg-surface-container text-outline'
  if (count <= 2) return 'bg-secondary-container text-on-secondary-container'
  return 'bg-secondary text-on-secondary'
}

export default function HabitsPage() {
  // 标题是**结构级**差异（移动原型 06 作「打卡 · 习惯」），纯 CSS 改不了字符串内容，
  // 而 PageHeader 只收 title: string，故这里走 JS 判定而不是硬改 design-system
  const isMobile = useIsMobile()
  const [month, setMonth] = useState(() => dayjs().format('YYYY-MM'))
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState<Habit | null>(null)
  const [creating, setCreating] = useState(false)
  // 删除习惯确认（应用风格弹窗，替代 window.confirm）
  const [confirmHabit, setConfirmHabit] = useState<{ habit: Habit; totalChecks: number } | null>(
    null,
  )

  const stats = useHabitStats(month)
  const counts = useHabitMonthCounts(month)
  const dayHabits = useCompletedHabitsOn(selectedDate)
  const todayDone = useTodayCheckCount()
  const mood = useHabitMood()

  const todayStr = dayjs().format('YYYY-MM-DD')
  const monthLabel = dayjs(month + '-01').format('YYYY年M月')
  const daysInMonth = dayjs(month + '-01').daysInMonth()
  // 周一起始的月历前置空位
  const leadingBlanks = (dayjs(month + '-01').day() + 6) % 7

  function shiftMonth(delta: number) {
    setMonth((m) =>
      dayjs(m + '-01')
        .add(delta, 'month')
        .format('YYYY-MM'),
    )
    setSelectedDate(undefined)
  }

  /** 打卡/取消打卡 —— 走领域命令单点收口（checkinHabit/uncheckHabit，§9.6.1） */
  async function toggleCheck(habit: Habit, doneToday: boolean) {
    if (doneToday) {
      await uncheckHabit(habit.id, todayStr)
    } else {
      await checkinHabit(habit.id, todayStr)
    }
  }

  /** 删除习惯 —— 确认后单事务级联软删习惯及其全部历史打卡 */
  function removeHabit(habit: Habit, totalChecks: number) {
    setConfirmHabit({ habit, totalChecks })
  }

  const monthTotalChecks = stats.reduce((sum, s) => sum + s.monthChecks, 0)

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={isMobile ? '打卡 · 习惯' : '打卡习惯'}
        actions={
          <Button icon="add" onClick={() => setCreating(true)}>
            {/* 390px 下「新建习惯」四个字会把标题挤走，窄屏只留 + 图标（按钮宽度靠字号撑不住，故隐藏文案而非缩字号） */}
            <span className="hidden md:inline">新建习惯</span>
          </Button>
        }
      />

      {/* 头部速览：窄屏下多项统计挤在一行会各自折行成「碎片」，改为 2 等分网格；
          ≥768px 用 md: 还原成原来的一行 flex-wrap，桌面零变化 */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
        <Chip tone="amber" icon="local_fire_department">
          今日已打卡 {todayDone} 项
        </Chip>
        <Chip tone="green" icon="verified">
          {monthLabel}累计 {monthTotalChecks} 次
        </Chip>
        {stats.some((s) => s.streak >= 21) && (
          <Chip tone="green" icon="military_tech">
            21 天稳态达成
          </Chip>
        )}
      </div>

      {/* 月历热力图（窄屏收内边距，给右侧 7 列格子多匀出 8px） */}
      <Card className="mb-4 p-4 md:p-5">
        {/* 左边「标题 + 稳态评语」最长可到 12 个字，390px 下与右侧月份切换器同排必溢出 →
            窄屏改列排（各占一行），md: 起还原为原来的 justify-between 单行 */}
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-[1.0714rem] font-semibold">本月热力图</h2>
            {mood && (
              <span
                className="flex items-center gap-1.5 text-[0.8571rem] text-on-surface-variant"
                title="基于近 7 天完成率与当前连击推导"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${MOOD_TONE_CLASS[mood.tone]}`}
                />
                {mood.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-low"
              onClick={() => shiftMonth(-1)}
            >
              <Icon name="chevron_left" size={20} />
            </button>
            <span className="min-w-[88px] text-center text-[0.9286rem] font-medium">{monthLabel}</span>
            <button
              className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-low"
              onClick={() => shiftMonth(1)}
            >
              <Icon name="chevron_right" size={20} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center text-[0.7857rem] text-outline">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const date = dayjs(month + '-01')
              .date(i + 1)
              .format('YYYY-MM-DD')
            const count = counts[date] ?? 0
            const isSelected = selectedDate === date
            const isToday = date === todayStr
            const isFuture = dayjs(date).isAfter(dayjs(), 'day')
            return (
              <button
                key={date}
                disabled={isFuture}
                onClick={() => setSelectedDate(isSelected ? undefined : date)}
                className={`flex h-12 flex-col items-center justify-center rounded-lg p-1.5 text-center transition-transform md:h-14 md:items-start md:justify-between md:text-left ${heatClass(count)} ${
                  isSelected ? 'ring-2 ring-primary' : ''
                } ${isFuture ? 'opacity-40' : 'hover:scale-105'} ${isToday ? 'ring-1 ring-primary/60' : ''}`}
              >
                <span className="text-[0.7857rem] font-semibold">{isToday ? '今' : i + 1}</span>
                {/* 窄屏格子约 42px 宽，放不下「12 项」（会折行撑破格子）；
                    色阶已编码当日完成量级，明细靠点击展开，故窄屏只在格子里留日期 */}
                {count > 0 && (
                  <span className="hidden text-[0.7143rem] opacity-80 md:block">{count} 项</span>
                )}
              </button>
            )
          })}
        </div>

        {/* flex-wrap 只在放不下时才生效：窄屏把「点击查看明细」换到下一行，宽屏与原来同排 */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.7857rem] text-outline">
          <span>少</span>
          <span className="h-3 w-3 rounded bg-surface-container" />
          <span className="h-3 w-3 rounded bg-secondary-container" />
          <span className="h-3 w-3 rounded bg-secondary" />
          <span>多 · 点击某日查看完成明细</span>
        </div>

        {selectedDate && (
          <div className="mt-4 rounded-lg bg-surface-container-low p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[0.9286rem] font-semibold">
                {dayjs(selectedDate).format('M月D日')} 完成明细 · {dayHabits.length} 项
              </span>
              <button
                className="text-outline hover:text-on-surface"
                onClick={() => setSelectedDate(undefined)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            {dayHabits.length === 0 ? (
              <div className="py-2 text-[0.8571rem] text-outline">这一天没有打卡记录</div>
            ) : (
              <ul className="space-y-1.5">
                {dayHabits.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 text-[0.9286rem]">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white"
                      style={{ background: h.color }}
                    >
                      <Icon name={h.icon} size={14} />
                    </span>
                    {h.name}
                    <span className="text-[0.7857rem] text-outline">{h.targetMinutes} 分钟</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* 活跃习惯清单 */}
      <Card className="p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[1.0714rem] font-semibold">活跃习惯 · {stats.length} 项</h2>
        </div>
        {stats.length === 0 ? (
          <EmptyState
            icon="event_repeat"
            title="还没有习惯"
            description="点击右上角「新建习惯」开始你的第一个稳态闭环"
          />
        ) : (
          <ul className="divide-y divide-outline-variant/30">
            {stats.map(({ habit, streak, monthChecks, monthRate, doneToday, totalChecks }) => (
              <li key={habit.id} className="group flex items-center gap-2 py-3 md:gap-3">
                <button
                  onClick={() => void toggleCheck(habit, doneToday)}
                  className="shrink-0"
                  title={doneToday ? '取消打卡' : '今日打卡'}
                >
                  <Icon
                    name={doneToday ? 'check_circle' : 'circle'}
                    size={26}
                    fill={doneToday}
                    className={doneToday ? 'text-success' : 'text-outline'}
                  />
                </button>
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ background: habit.color }}
                >
                  <Icon name={habit.icon} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.9643rem] font-medium">{habit.name}</div>
                  <div className="truncate text-[0.7857rem] text-outline">
                    {habit.schedule} · {habit.targetMinutes} 分钟
                    {habit.motivationNote ? ` · ${habit.motivationNote}` : ''}
                  </div>
                </div>
                {streak > 0 && (
                  <Chip tone={streak >= 21 ? 'green' : 'amber'} icon="local_fire_department">
                    {streak} 天
                  </Chip>
                )}
                {/* 月度完成率 112px 宽，窄屏会顶掉习惯名 → 只在 ≥768px 显示（原 sm: 是 640px 遗留，
                    会在移动形态里露出，故一并收口到 md:） */}
                <div className="hidden w-28 shrink-0 text-right md:block">
                  <div className="text-[0.7857rem] text-outline">
                    {monthLabel}完成 {monthChecks} 次 · {monthRate === null ? '—' : `${monthRate}%`}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container">
                    <div
                      className="h-full rounded-full bg-secondary transition-all"
                      style={{ width: `${monthRate === null ? 0 : Math.min(100, monthRate)}%` }}
                    />
                  </div>
                </div>
                <div className="hidden w-16 shrink-0 text-right text-[0.7857rem] text-outline lg:block">
                  累计 {totalChecks} 次
                </div>
                {/* 触屏没有 hover，窄屏常显这两个按钮；md:opacity-0 让桌面保持「悬停才出现」原样 */}
                <button
                  className="rounded-md p-1.5 text-outline opacity-100 transition-opacity hover:bg-surface-container-low hover:text-primary group-hover:opacity-100 md:opacity-0"
                  title="编辑"
                  onClick={() => setEditing(habit)}
                >
                  <Icon name="edit" size={18} />
                </button>
                <button
                  className="rounded-md p-1.5 text-outline opacity-100 transition-opacity hover:bg-surface-container-low hover:text-danger group-hover:opacity-100 md:opacity-0"
                  title="删除习惯"
                  onClick={() => removeHabit(habit, totalChecks)}
                >
                  <Icon name="delete" size={18} />
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

      {/* 删除习惯确认（应用风格弹窗，替代 window.confirm） */}
      <ConfirmDialog
        open={confirmHabit !== null}
        title={`删除习惯「${confirmHabit?.habit.name ?? ''}」？`}
        danger
        confirmText="删除"
        message={
          confirmHabit && confirmHabit.totalChecks > 0
            ? `该习惯已有 ${confirmHabit.totalChecks} 次历史打卡记录，将一并删除，此操作不可撤销。`
            : '此操作不可撤销。'
        }
        onCancel={() => setConfirmHabit(null)}
        onConfirm={() => {
          const target = confirmHabit
          setConfirmHabit(null)
          if (target) void deleteHabitCascade(target.habit.id)
        }}
      />
    </div>
  )
}

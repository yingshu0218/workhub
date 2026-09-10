import { useCollection, useTodayFocusMinutes } from '@/queries/hooks'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useFocusStore, FOCUS_TOTAL_SEC } from '@/stores/focus'
import { Button, Card, Chip, inputCls } from '@/design-system/ui'
import { useToast } from '@/design-system/Toast'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import { checkinHabit, uncheckHabit, newId, quickNoteRepo } from '@/repositories'
import { toggleTodoDone } from '@/modules/todo/toggle'
import { isDueToday, isTodoOpen, isTodoDone } from '@/modules/todo/domain'
import { convertQuickNote } from '@/modules/notes/quickCapture'
import { useRef, useState } from 'react'
import type { Todo, Customer, Ledger, QuickNote } from '@/db/types'
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
    // 走领域命令单点收口（§9.6.1）：软删也统一按确定性 habitLogId 派生 id，
    // 消除「按 existing.id 删」与「按确定性 id 删」两套语义
    if (existing) {
      await uncheckHabit(habitId, todayStr)
    } else {
      await checkinHabit(habitId, todayStr)
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

/**
 * 今日待办日程（对齐原型 01：时间轴待办 + 进入待办中心）
 *
 * Issue #134 口径修正：**已完成项不再出现在首页**。
 * 首页是「此刻要做什么」的行动面板，不是归档视图——一条待办打勾后应立即消失，
 * 完成后的去向是待办中心的「已完成」视图（左栏一级入口），首页不承担回看职责。
 * 达成情况由顶部「待办达成 N/M」指标卡承载，故此处不做「已完成划线区」（两者会互相矛盾）。
 */
export function TodayTodosCard() {
  const todos = useCollection<Todo>('todos')
  const todayStr = dayjs().format('YYYY-MM-DD')
  const list = todos
    // 「今天」口径（Issue #74）：今日截止 ∪ 逾期未完成；isDueToday 内部已含 isTodoOpen 判定
    .filter((t) => isDueToday(t, todayStr))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
  // 未完成总览（进入待办中心的计数）：与待办中心「全部待办」同一口径
  const openCount = todos.filter(isTodoOpen).length
  // 今日已完成数：仅用于空态文案（「今日 N 项已达成」），不渲染成列表条目
  const doneTodayCount = todos.filter(
    (t) => isTodoDone(t) && t.completedAt && dayjs(t.completedAt).format('YYYY-MM-DD') === todayStr,
  ).length

  // 打勾完成/取消完成统一走领域函数（与待办中心同一口径，Issue #74）
  async function toggle(t: Todo) {
    await toggleTodoDone(t)
  }

  return (
    <Card className="flex min-h-[280px] flex-col p-5">
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

      {list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
          <div className="text-[0.8571rem] text-outline">今日暂无待完成事项</div>
          {doneTodayCount > 0 && (
            <div className="text-[0.7857rem] text-success">
              今日已达成 {doneTodayCount} 项，已完成事项已移出首页
            </div>
          )}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
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
                {t.desc && (
                  <div className="truncate text-[0.7857rem] text-outline">{t.desc}</div>
                )}
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
        </ul>
      )}

      <button
        className="mt-3 border-t border-outline-variant/40 pt-3 text-left text-[0.8571rem] text-primary hover:underline"
        onClick={() => (location.href = '/todo')}
      >
        进入待办事项中心查看全部（{openCount}）→
      </button>
    </Card>
  )
}

/**
 * 随手速记暂存便签（对齐原型 01 / Issue #134：**收集箱入口**，常驻大文本框）
 *
 * 定位：首页右下角的「外置收集箱」——灵感一闪先落这里，不分类、不中断当前动作；
 * 攒下的每一条速记再由底部两个大按钮一键处置为**待办**（进收集箱）或**团队笔记**。
 *
 * Issue #134 相对旧版的三处变化：
 * 1. 常驻 `textarea`（可拖高、随列宽自适应），取代「一行 input + Enter 提交」——
 *    速记常是多行灵感，输入区必须够大，且不再有「按错 Enter 就提前落库」的陷阱；
 * 2. 两个处置按钮**常显**（旧版藏在条目 hover 里，且要「先入库再 hover 转换」两步）；
 * 3. 处置动作统一走 `convertQuickNote` 领域收口，落库字段（tag / mentions / 收集箱归属）
 *    与侧栏速记、待办中心完全一致，不再由卡片内联手拼。
 */
export function QuickNoteCard() {
  const notes = useCollection<QuickNote>('quickNotes')
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  // 尚未处置的速记（已转待办/笔记的离开暂存区）
  const pending = notes.filter((n) => !n.convertedTo)
  const canSubmit = draft.trim().length > 0 && !busy

  /** 只入暂存区：把正文落成一条 QuickNote，不改动草稿以外的任何状态 */
  async function saveDraftOnly(): Promise<boolean> {
    const content = draft.trim()
    if (!content) return false
    await quickNoteRepo.put({ id: newId('qn'), content, createdAt: Date.now() })
    setDraft('')
    return true
  }

  /** 落一条速记进暂存区（按钮「存入暂存区」） */
  async function stash() {
    if (!canSubmit) return
    setBusy(true)
    try {
      if (await saveDraftOnly()) toast.success('已存入速记暂存区')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 一键处置当前草稿：先落一条速记（保留原始输入痕迹），再转换为待办 / 笔记。
   * 已入库的旧速记走 convertStashed（复用同一领域函数）。
   */
  async function convertDraft(to: 'todo' | 'note') {
    if (!canSubmit) return
    setBusy(true)
    try {
      const qn: QuickNote = {
        id: newId('qn'),
        content: draft.trim(),
        createdAt: Date.now(),
        updatedAt: 0,
        deleted: 0,
        rev: 0,
      }
      await quickNoteRepo.put(qn)
      const targetId = await convertQuickNote(qn, to)
      setDraft('')
      if (to === 'todo') {
        toast.success('已转入待办收集箱，可在待办中心归类')
        location.href = '/todo?focus=' + targetId
      } else {
        toast.success('已归入团队笔记')
        location.href = '/notes/' + targetId
      }
    } catch (err) {
      console.error('[dashboard] 速记处置失败', err)
      toast.error('处置速记失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  /** 处置一条已入库的速记 */
  async function convertStashed(n: QuickNote, to: 'todo' | 'note') {
    if (busy) return
    setBusy(true)
    try {
      const targetId = await convertQuickNote(n, to)
      toast.success(to === 'todo' ? '已转入待办收集箱' : '已归入团队笔记')
      // 转待办后不等于完成处置：仍需在待办中心补归属/截止，故跳转待办中心定位该条
      if (to === 'todo') location.href = '/todo?focus=' + targetId
    } catch (err) {
      console.error('[dashboard] 速记处置失败', err)
      toast.error('处置速记失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-1 flex-col p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
          <Icon name="edit_note" className="text-primary" />
          随手速记暂存便签
        </h2>
        <Chip tone="gray">AUTO-SAVED</Chip>
      </div>
      <p className="mb-3 text-[0.8571rem] text-on-surface-variant">
        无需归类与层级的瞬时灵感、临时纪要或剪贴板文本，一键转存。
      </p>

      {/* 常驻大文本框：可纵向拖高，随列宽自适应（对齐原型 01 的 rows=4 输入域） */}
      <textarea
        ref={areaRef}
        className={`${inputCls} min-h-[7.5rem] flex-1 resize-y leading-relaxed`}
        rows={4}
        placeholder="在此快速输入闪现灵感…（例如：考虑把客户合同催付与财务发票流联动自动化）"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl + Enter 直接转待办收集箱；Enter 保留为换行（多行灵感）
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void convertDraft('todo')
          }
        }}
      />

      <div className="mt-1.5 flex items-center justify-between text-[0.7857rem] text-outline">
        <span className="flex items-center gap-1.5">
          <Icon name="cloud_done" size={14} className="text-success" />
          本地缓存已就绪
        </span>
        <span>
          {draft.length} 字符已录入
          {draft.trim() && <span className="ml-1">· ⌘↵ 转待办</span>}
        </span>
      </div>

      {/* 常显双按钮（Issue #134）：转入待办 = 进收集箱；归入团队笔记 = 落正式笔记 */}
      <div className="mt-3 flex gap-2">
        <Button
          variant="tonal"
          icon="move_to_inbox"
          className="flex-1 justify-center"
          disabled={!canSubmit}
          onClick={() => void convertDraft('todo')}
        >
          转入待办
        </Button>
        <Button
          icon="menu_book"
          className="flex-1 justify-center"
          disabled={!canSubmit}
          onClick={() => void convertDraft('note')}
        >
          归入团队笔记
        </Button>
      </div>
      <button
        className="mt-2 text-left text-[0.7857rem] text-outline hover:text-primary disabled:opacity-50"
        disabled={!canSubmit}
        onClick={() => void stash()}
      >
        或先存入暂存区，稍后处置
      </button>

      {/* 暂存区：已攒下的速记，逐条一键处置 */}
      <div className="mt-4 border-t border-outline-variant/40 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.8571rem] font-medium text-on-surface-variant">
            暂存区（{pending.length}）
          </span>
          {pending.length > 0 && (
            <button
              className="text-[0.7857rem] text-primary hover:underline"
              onClick={() => (location.href = '/notes')}
            >
              查看全部速记 →
            </button>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="py-3 text-center text-[0.8571rem] text-outline">暂存区已清空</div>
        ) : (
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {pending.map((n) => (
              <li key={n.id} className="rounded-lg bg-surface-container-low px-3 py-2">
                <div className="text-[0.9286rem] leading-snug break-words whitespace-pre-wrap">
                  {n.content}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Button
                    size="sm"
                    variant="tonal"
                    icon="move_to_inbox"
                    disabled={busy}
                    onClick={() => void convertStashed(n, 'todo')}
                  >
                    转待办
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="menu_book"
                    disabled={busy}
                    onClick={() => void convertStashed(n, 'note')}
                  >
                    归笔记
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

import { useCollection, useTodayFocusMinutes } from '@/queries/hooks'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useFocusStore, FOCUS_TOTAL_SEC } from '@/stores/focus'
import { Button, Card, Chip, inputCls } from '@/design-system/ui'
import { MatchCombobox } from '@/design-system/MatchCombobox'
import { useToast } from '@/design-system/Toast'
import { checkinHabit, uncheckHabit, newId, quickNoteRepo } from '@/repositories'
import { toggleTodoDone } from '@/modules/todo/toggle'
import { isDueToday, isTodoOpen, isTodoDone } from '@/modules/todo/domain'
import { useCallback, useRef, useState } from 'react'
import type { Todo, Customer, Ledger, Habit, HabitLog, QuickNote, Note } from '@/db/types'
import dayjs from 'dayjs'
import { convertQuickNote } from '@/modules/notes/quickCapture'

function fmt(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

/** 时间戳 → 「X 分钟前 / X 小时前 / X 天前」（速记的「刚刚捕获」时间感，不引入新依赖） */
function relTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
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
  // 多关联（Issue #140）：展示取首个关联客户
  const refCustomer = (doing?.customerIds ?? [])[0]
    ? customers.find((c) => c.id === doing!.customerIds![0])
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

/** 空态占位：统一「图标 + 主文案 + 副文案」三层，避免各卡各写一套 */
function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
      <Icon name={icon} size={22} className="text-outline/70" />
      <div className="text-[0.8571rem] text-outline">{title}</div>
      {hint && <div className="text-[0.7857rem] text-outline/80">{hint}</div>}
    </div>
  )
}

/** 卡片底部的「进入模块」出口：首页各卡统一收尾样式（原型 01 的 `查看全部 →`） */
function CardExitLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="mt-3 border-t border-outline-variant/40 pt-3 text-left text-[0.8571rem] text-primary hover:underline"
      onClick={onClick}
    >
      {label} →
    </button>
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
        <EmptyState
          icon="task_alt"
          title="今日暂无待完成事项"
          hint={
            doneTodayCount > 0
              ? `今日已达成 ${doneTodayCount} 项，已完成事项已移出首页`
              : '去待办中心创建 →'
          }
        />
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
                {t.desc && <div className="truncate text-[0.7857rem] text-outline">{t.desc}</div>}
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

      <CardExitLink
        label={`进入待办事项中心查看全部（${openCount}）`}
        onClick={() => (location.href = '/todo')}
      />
    </Card>
  )
}

/** 习惯连击天数（与 Sidebar/待办口径一致：今日未打卡则从昨日回溯） */
function habitStreak(logs: HabitLog[], habitId: string, todayStr: string): number {
  const dates = new Set(logs.filter((l) => l.habitId === habitId).map((l) => l.date))
  let n = 0
  let cursor = dates.has(todayStr) ? dayjs() : dayjs().subtract(1, 'day')
  while (dates.has(cursor.format('YYYY-MM-DD'))) {
    n++
    cursor = cursor.subtract(1, 'day')
  }
  return n
}

/**
 * 每日习惯闭环（对齐原型 01）
 *
 * Issue #134 视觉重构：旧版是一列「图标 + 名称 + 排期」的等权列表，
 * 与原型差距在于**成组语义**——原型把习惯切成「已完成（打勾 + 完成时间 + 连击）」与
 * 「未完成」两组，同一组内才有比较价值；完成时间/证据文案给出「今天已经做了什么」的回顾感。
 * 卡片头改为「N / M 完成」进度胶囊 + 顶部进度条，让「闭环」在未展开时也能一眼看见。
 */
export function HabitLoopCard() {
  const habits = useCollection<Habit>('habits')
  const logs = useCollection<HabitLog>('habitLogs')
  const navigate = useNavigate()
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

  const doneLogs = new Map(
    logs.filter((l) => l.date === todayStr).map((l) => [l.habitId, l] as const),
  )
  const doneCount = habits.filter((h) => doneLogs.has(h.id)).length
  const pct = habits.length === 0 ? 0 : Math.round((doneCount / habits.length) * 100)
  // 已完成组在前（回顾），未完成组在后（待办），与「先看成果再看缺口」的阅读顺序一致
  const ordered = [...habits].sort(
    (a, b) => Number(doneLogs.has(b.id)) - Number(doneLogs.has(a.id)),
  )

  function renderRow(h: Habit) {
    const log = doneLogs.get(h.id)
    const done = Boolean(log)
    const streak = habitStreak(logs, h.id, todayStr)
    return (
      <li
        key={h.id}
        className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
          done
            ? 'border-transparent bg-success/8'
            : 'border-outline-variant/40 bg-surface-container-lowest'
        }`}
      >
        <button
          onClick={() => void toggle(h.id)}
          className="mt-0.5 shrink-0"
          title={done ? '取消打卡' : '打卡'}
        >
          <Icon
            name={done ? 'check_box' : 'check_box_outline_blank'}
            size={22}
            fill={done}
            className={done ? 'text-success' : 'text-outline'}
          />
        </button>
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
          style={{ background: h.color }}
        >
          <Icon name={h.icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[0.9643rem] font-medium">{h.name}</div>
          {/* 已打卡显示完成时间（回顾），未打卡显示排期与目标（计划） */}
          <div className={`truncate text-[0.7857rem] ${done ? 'text-success' : 'text-outline'}`}>
            {done
              ? `已于 ${dayjs(log!.completedAt).format('HH:mm')} 完成 · ${h.motivationNote || '保持节奏'}`
              : `${h.schedule} · 计划 ${h.targetMinutes} 分钟`}
          </div>
        </div>
        {streak > 0 && (
          <Chip tone={streak >= 21 ? 'green' : 'amber'} icon="local_fire_department">
            {streak} 天连胜
          </Chip>
        )}
      </li>
    )
  }

  return (
    <Card className="flex flex-col p-5">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[1.0714rem] font-semibold">每日习惯闭环</h2>
          <p className="mt-0.5 text-[0.8571rem] text-on-surface-variant">
            自律即自由 · 每一个微习惯都在塑造长期壁垒
          </p>
        </div>
        {habits.length > 0 && (
          <div className="shrink-0 text-right">
            <div className="text-[1.2857rem] font-bold tabular-nums text-success">
              {doneCount}
              <span className="text-[0.9286rem] font-medium text-outline"> / {habits.length}</span>
            </div>
            <div className="text-[0.7857rem] text-outline">已完成</div>
          </div>
        )}
      </div>

      {/* 顶部进度条：闭环进度在卡片收起/扫视时也可见 */}
      <div className="mb-3 mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
        <div
          className="h-full rounded-full bg-success transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {habits.length === 0 ? (
        <EmptyState icon="event_repeat" title="还没有习惯" hint="去打卡·习惯新建一个微习惯 →" />
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">{ordered.map(renderRow)}</ul>
      )}

      <CardExitLink label="习惯统计洞察" onClick={() => navigate('/habits')} />
    </Card>
  )
}

/** 速记暂存区的本地 UI 偏好（关闭/展开）：只影响本机展示，不写库、不进同步 */
const STASH_COLLAPSED_KEY = 'nexus:dashboard.quicknote.stash-collapsed'
/** 暂存区最多内联展示条数：其余走「查看全部速记」，避免首页被速记淹没 */
const STASH_INLINE_LIMIT = 5

/**
 * 随手速记暂存便签（对齐原型 01 / Issue #134：**收集箱入口**，常驻大文本框）
 *
 * 定位：首页右下角的「外置收集箱」——灵感一闪先落这里，不分类、不中断当前动作；
 * 攒下的每一条速记再由卡片底部两个大按钮一键处置为**待办**（进收集箱）或**团队笔记**。
 *
 * Issue #134 相对旧版的三处变化：
 * 1. 常驻 `textarea`（可拖高、随列宽自适应），取代「一行 input + Enter 提交」——
 *    速记常是多行灵感，输入区必须够大，且不再有「按错 Enter 就提前落库」的陷阱；
 * 2. 两个处置按钮**常显**（旧版藏在条目 hover 里，且要「先入库再 hover 转换」两步）；
 * 3. 处置动作统一走 `convertQuickNote` 领域收口，落库字段（tag / mentions / 收集箱归属）
 *    与侧栏速记、待办中心完全一致，不再由卡片内联手拼。
 * 4. 暂存区可折叠、只内联最近 N 条 —— 速记是「越攒越多」的流，不能让它把首页顶走；
 *    折叠态与「N 条待处置」计数、最近更新时间一起常显，做到收起也不丢状态。
 */
export function QuickNoteCard() {
  const notes = useCollection<QuickNote>('quickNotes')
  const notesList = useCollection<Note>('notes')
  const navigate = useNavigate()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  // 折叠态从 localStorage 惰性初始化（隐私模式下不可用则退化为默认展开）
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STASH_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  /** 只入暂存区：把正文落成一条 QuickNote，不改动草稿以外的任何状态 */
  const saveDraftOnly = useCallback(async (): Promise<boolean> => {
    const content = draft.trim()
    if (!content) return false
    await quickNoteRepo.put({ id: newId('qn'), content, createdAt: Date.now() })
    setDraft('')
    return true
  }, [draft])

  /** 落一条速记进暂存区（按钮「存入暂存区」） */
  async function stash() {
    if (busy || !draft.trim()) return
    setBusy(true)
    try {
      if (await saveDraftOnly()) toast.success('已存入速记暂存区')
    } catch (err) {
      console.error('[dashboard] 速记暂存失败', err)
      toast.error('暂存速记失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 一键处置当前草稿：先落一条速记（保留原始输入痕迹），再转换为待办 / 笔记。
   * 已入库的旧速记走 convertStashed（复用同一领域函数）。
   */
  async function convertDraft(to: 'todo' | 'note') {
    if (busy || !draft.trim()) return
    setBusy(true)
    try {
      // QuickNote 的同步元数据（updatedAt/deleted/rev）由 repository 落库时统一盖章，
      // 这里只给业务字段，避免卡片内联手拼同步字段（Issue #134 收口）
      // 落库只为保留「原始输入痕迹 + 处置留痕」；同步元数据（updatedAt/deleted/rev）
      // 由 repository 在 put 内统一盖章，卡片不再手拼同步字段（Issue #134 收口）
      const qnId = newId('qn')
      const content = draft.trim()
      await quickNoteRepo.put({ id: qnId, content, createdAt: Date.now() })
      // 处置只需业务字段：库内那份记录由 convertQuickNote 回写 convertedTo/At/Via
      const targetId = await convertQuickNote({ id: qnId, content } as QuickNote, to, 'dashboard')
      setDraft('')
      if (to === 'todo') {
        toast.success('已转入待办收集箱，可在待办中心归类')
        navigate('/todo?focus=' + targetId)
      } else {
        toast.success('已归入团队笔记')
        navigate('/notes/' + targetId)
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
      const targetId = await convertQuickNote(n, to, 'dashboard')
      toast.success(to === 'todo' ? '已转入待办收集箱' : '已归入团队笔记')
      // 转待办后不等于完成处置：仍需在待办中心补归属/截止，故跳转待办中心定位该条
      if (to === 'todo') navigate('/todo?focus=' + targetId)
    } catch (err) {
      console.error('[dashboard] 速记处置失败', err)
      toast.error('处置速记失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STASH_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* 隐私模式：仅内存态生效 */
      }
      return next
    })
  }

  // 尚未处置的速记（已转待办/笔记的离开暂存区），最新在前
  const pending = notes.filter((n) => !n.convertedTo).sort((a, b) => b.createdAt - a.createdAt)
  const visible = pending.slice(0, STASH_INLINE_LIMIT)
  const canSubmit = draft.trim().length > 0 && !busy
  // 转笔记后的通道读数：让「攒下的速记去哪儿了」有正向反馈（Issue #134 原型 01 的归档感）
  const archivedCount = notesList.filter((n) => (n.tags ?? []).includes('速记归档')).length

  /** 字符计数与本地缓存状态（原型 01：`N 字符已录入 · 本地缓存已就绪`） */
  const draftMeta = `${draft.length} 字符已录入 · 本地缓存已就绪`

  return (
    <Card className="flex flex-1 flex-col p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[1.0714rem] font-semibold">
          <Icon name="edit_note" className="text-primary" />
          随手速记暂存便签
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {pending.length > 0 && <Chip tone="blue">{pending.length} 待处置</Chip>}
          <Chip tone="gray">AUTO-SAVED</Chip>
        </div>
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
        <span>{draftMeta}</span>
        {draft.trim() && <span className="ml-1">⌘↵ 转待办</span>}
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

      {/* 暂存区：已攒下的速记，逐条一键处置；可折叠避免把首页顶长 */}
      <div className="mt-4 border-t border-outline-variant/40 pt-3">
        <div className="flex items-center justify-between gap-2">
          <button
            className="flex items-center gap-1.5 text-[0.8571rem] font-medium text-on-surface-variant hover:text-primary"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? 'expand_more' : 'expand_less'} size={18} />
            暂存区（{pending.length}）
          </button>
          <span className="flex items-center gap-3">
            {pending[0] && (
              <span className="text-[0.7857rem] text-outline">
                最近 {relTime(pending[0].createdAt)}
              </span>
            )}
            {archivedCount > 0 && (
              <button
                className="text-[0.7857rem] text-primary hover:underline"
                onClick={() => navigate('/notes')}
                title="查看归入团队笔记的速记"
              >
                {archivedCount} 条已归档 →
              </button>
            )}
          </span>
        </div>

        {collapsed ? (
          <p className="mt-2 text-[0.7857rem] text-outline">
            暂存区已收起{pending.length > 0 ? `，${pending.length} 条速记待处置` : ''} ·
            点击标题展开
          </p>
        ) : pending.length === 0 ? (
          <p className="py-3 text-center text-[0.8571rem] text-outline">暂存区已清空</p>
        ) : (
          <>
            <ul className="mt-2 space-y-2">
              {visible.map((n) => (
                <li key={n.id} className="rounded-lg bg-surface-container-low px-3 py-2">
                  <div className="text-[0.9286rem] leading-snug break-words whitespace-pre-wrap">
                    {n.content}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="mr-auto text-[0.75rem] text-outline">
                      {relTime(n.createdAt)}
                    </span>
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
            {pending.length > STASH_INLINE_LIMIT && (
              <button
                className="mt-2 text-[0.7857rem] text-primary hover:underline"
                onClick={() => navigate('/notes')}
              >
                查看全部速记（含 {pending.length - STASH_INLINE_LIMIT} 条更早的）→
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

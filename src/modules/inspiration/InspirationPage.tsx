import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '@/queries/hooks'
import type { Customer, Todo, Transaction, Note } from '@/db/types'
import { todoRepo } from '@/repositories'
import { registerShortcut } from '@/shared/shortcuts'
import { useFocusStore } from '@/stores/focus'
import buildCandidates from './engine'
import type { CandidateKind, InspirationCandidate } from './engine'

/**
 * 灵感闪现全屏决策态（对齐原型 02-inspiration-flash · 深色全屏，不套 AppLayout）
 * Space 换一个 / Enter 开始专注（联动 focus store 并跳回工作台）/ Esc 退出回工作台
 */

const KIND_META: Record<CandidateKind, { chip: string; tone: string; icon: string }> = {
  'overdue-todo': { chip: '待办灵感 · 临界推进', tone: 'bg-rose-500/15 text-rose-300 border-rose-400/40', icon: 'priority_high' },
  'due-todo': { chip: '待办日程 · 今日到期', tone: 'bg-amber-500/15 text-amber-300 border-amber-400/40', icon: 'schedule' },
  reconciliation: { chip: '财务灵感 · 待对账', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40', icon: 'account_balance_wallet' },
  'stale-customer': { chip: '人脉灵感 · 久未跟进', tone: 'bg-sky-500/15 text-sky-300 border-sky-400/40', icon: 'handshake' },
  'stale-note': { chip: '笔记灵感 · 沉睡文库', tone: 'bg-violet-500/15 text-violet-300 border-violet-400/40', icon: 'auto_stories' },
}

/** 候选池开关（对齐原型 02 底部）：kind → 池 key 归组 */
const POOLS = [
  { key: 'todo', label: '紧急待办' },
  { key: 'reconciliation', label: '待对账' },
  { key: 'customer', label: '久未联系客户' },
  { key: 'note', label: '沉睡笔记' },
] as const

type PoolKey = (typeof POOLS)[number]['key']

function poolOfKind(kind: CandidateKind): PoolKey {
  if (kind === 'overdue-todo' || kind === 'due-todo') return 'todo'
  if (kind === 'stale-customer') return 'customer'
  if (kind === 'reconciliation') return 'reconciliation'
  return 'note'
}

/** 稍后提醒间隔：15 分钟 */
const REMIND_DELAY_MS = 15 * 60_000

/** 合度环（SVG） */
function MatchRing({ pct }: { pct: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-white">
        {pct}%
      </div>
    </div>
  )
}

export default function InspirationPage() {
  const navigate = useNavigate()
  const todos = useCollection<Todo>('todos')
  const transactions = useCollection<Transaction>('transactions')
  const customers = useCollection<Customer>('customers')
  const notes = useCollection<Note>('notes')

  // 候选池开关（组件态即可，不落库）
  const [pools, setPools] = useState<Record<PoolKey, boolean>>({
    todo: true,
    reconciliation: true,
    customer: true,
    note: true,
  })

  const candidates = useMemo(
    () => buildCandidates({ todos, transactions, customers, notes }).filter((c) => pools[poolOfKind(c.kind)]),
    [todos, transactions, customers, notes, pools],
  )
  const [idx, setIdx] = useState(0)
  const [reminderMsg, setReminderMsg] = useState<string | null>(null)
  // 稍后提醒调度队列（审计 P2-1：记录提醒时间，到点真实唤起）
  const [reminders, setReminders] = useState<{ title: string; dueAt: number }[]>([])

  // 队列收缩时归位
  const safeIdx = candidates.length ? idx % candidates.length : 0
  const current: InspirationCandidate | undefined = candidates[safeIdx]

  const next = () => {
    if (candidates.length) setIdx((i) => (i + 1) % candidates.length)
  }

  const togglePool = (key: PoolKey) => {
    setPools((prev) => ({ ...prev, [key]: !prev[key] }))
    setIdx(0)
  }

  const remindLater = () => {
    if (!current) return
    // 首次使用时顺手申请桌面通知权限（拒绝则走应用内 Toast）
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
    setReminders((prev) => [...prev, { title: current.title, dueAt: Date.now() + REMIND_DELAY_MS }])
    setReminderMsg(`已稍后提醒：${current.title}（15 分钟后再来唤起你）`)
    window.setTimeout(() => setReminderMsg(null), 3000)
    next()
  }

  // 提醒到点：桌面通知（若已授权），否则应用内顶部 Toast
  // 调度优化：单个 setTimeout 指向最近到期项，无到期项时零空转（替代 1s interval 轮询）
  useEffect(() => {
    if (reminders.length === 0) return
    const nextDue = Math.min(...reminders.map((r) => r.dueAt))
    const delay = Math.max(0, nextDue - Date.now())
    const timer = window.setTimeout(() => {
      const now = Date.now()
      const due = reminders.filter((r) => r.dueAt <= now)
      if (due.length === 0) return
      setReminders((prev) => prev.filter((r) => r.dueAt > now))
      const msg = due.map((r) => r.title).join('、')
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('寻鸽工作台 · 稍后提醒', { body: `该回来处理了：${msg}` })
      } else {
        setReminderMsg(`稍后提醒到点：${msg}`)
        window.setTimeout(() => setReminderMsg(null), 6000)
      }
    }, delay)
    return () => window.clearTimeout(timer)
  }, [reminders])

  const startFocus = () => {
    if (!current) return
    useFocusStore.getState().start(current.todoId, current.title)
    navigate('/')
  }

  const completeTodo = async () => {
    if (!current?.todoId) return
    const todo = todos.find((t) => t.id === current.todoId)
    if (!todo) return
    // 以旧记录展开为基底流转状态
    await todoRepo.put({ ...todo, status: 'done', completedAt: Date.now() })
    next()
  }

  // 快捷键过统一注册表（Esc 退出 / Space 换一个 / Enter 开始专注）
  // handler 经 ref 间接调用：注册一次，始终拿到最新闭包（避免挂载/卸载风暴）
  const handlersRef = useRef({ next, startFocus, navigate })
  handlersRef.current = { next, startFocus, navigate }
  useEffect(() => {
    const unsubs = [
      registerShortcut({ combo: 'space', description: '灵感闪现：换一个', scope: 'page', handler: () => handlersRef.current.next() }),
      registerShortcut({ combo: 'enter', description: '灵感闪现：开始专注执行', scope: 'page', handler: () => handlersRef.current.startFocus() }),
      registerShortcut({ combo: 'esc', description: '灵感闪现：退出回工作台', scope: 'page', handler: () => handlersRef.current.navigate('/') }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  const kindMeta = current ? KIND_META[current.kind] : undefined
  const topMatch = candidates.length ? candidates[0].match : 0

  // 壳内全幅：负 margin 抵消 AppLayout main 的 px-8 py-6，高度补回上下 padding（3rem）
  return (
    <div className="relative -mx-8 -my-6 flex h-[calc(100%+3rem)] flex-col overflow-hidden bg-[#0b1220] text-slate-100">
      {/* 背景光晕 */}
      <div className="pointer-events-none absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-1/4 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />

      {/* 顶栏 */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Icon name="flight_takeoff" size={18} fill />
          </div>
          <div>
            <div className="text-[13.5px] font-bold leading-tight">寻鸽工作台</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Nexus Workspace</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11.5px] font-medium text-emerald-300">
            ● 算法置信度 {topMatch}%
          </span>
          <button
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-[12px] text-slate-400 transition-colors hover:border-blue-500 hover:text-blue-300"
            onClick={() => navigate('/')}
          >
            <Icon name="keyboard_return" size={15} />
            返回工作台
          </button>
        </div>
      </header>

      {/* 主体 */}
      <main className="relative z-10 flex flex-1 items-start justify-center overflow-y-auto px-8 pb-4">
        {!current ? (
          <div className="mt-24 flex flex-col items-center gap-4 text-center">
            <Icon name="auto_awesome" className="text-[52px] text-slate-600" />
            <div className="text-[17px] font-semibold">抽取池暂时是空的</div>
            <div className="max-w-sm text-[13px] leading-relaxed text-slate-500">
              没有发现逾期待办、到期日程、待对账流水或久未跟进的客户。去工作台记录一笔，或先享受片刻清闲。
            </div>
            <button
              className="mt-2 rounded-lg bg-blue-600 px-5 py-2.5 text-[13px] font-medium text-white hover:bg-blue-500"
              onClick={() => navigate('/')}
            >
              返回工作台
            </button>
          </div>
        ) : (
          <div className="w-full max-w-[880px]">
            {/* 标题区 */}
            <div className="rounded-t-2xl border border-slate-800 bg-[#101a2e]/90 px-7 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                    <Icon name="bolt" fill />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[17px] font-bold">灵感闪现</span>
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Inspiration Flash
                      </span>
                      <kbd className="rounded bg-slate-800 px-1.5 text-[10px] text-slate-400">⌘J</kbd>
                    </div>
                    <p className="mt-1 max-w-[520px] text-[12px] leading-relaxed text-slate-500">
                      从待办事项、久未跟进客户、待对账流水与今日日程中，综合截止时限与商务权重，抽出当下最值得推进的事。
                    </p>
                  </div>
                </div>
                <button
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-400 hover:border-blue-500 hover:text-blue-300"
                  onClick={next}
                >
                  <Icon name="shuffle" size={15} />
                  抽取池
                </button>
              </div>
            </div>

            {/* 候选卡片 */}
            <div key={current.id} className="rounded-b-2xl border border-t-0 border-slate-800 bg-[#0e1626]/90 px-7 py-6">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${kindMeta!.tone}`}>
                      <Icon name={kindMeta!.icon} size={13} />
                      {kindMeta!.chip}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11.5px] text-emerald-300">
                      ✓ 综合匹配合度 {current.match}%
                    </span>
                  </div>
                  <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Recommended Action Target
                  </div>
                  <h1 className="mt-1 text-[26px] font-bold leading-snug text-white">{current.title}</h1>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{current.reason}</p>
                </div>
                <div className="flex flex-col items-center gap-1 pt-1">
                  <MatchRing pct={current.match} />
                  <span className="text-[10px] uppercase tracking-widest text-slate-500">合度</span>
                </div>
              </div>

              {/* 执行上下文（客户 · 款项 · 笔记） */}
              {current.context.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {current.context.map((ctx) => (
                    <div key={ctx.label} className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                        <Icon name={ctx.icon} size={14} />
                        {ctx.label}
                      </div>
                      <div className="mt-1 truncate text-[13px] font-medium text-slate-200">{ctx.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* 操作区 */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  className="flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-blue-500"
                  onClick={startFocus}
                >
                  <Icon name="play_arrow" size={17} />
                  立即专注执行（锁定此任务）
                  <kbd className="rounded bg-blue-500/60 px-1.5 text-[10.5px]">Enter</kbd>
                </button>
                <button
                  className="flex h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-[13px] text-slate-300 transition-colors hover:border-slate-500"
                  onClick={next}
                >
                  <Icon name="shuffle" size={16} />
                  换一个
                  <kbd className="rounded bg-slate-800 px-1.5 text-[10.5px] text-slate-400">Space</kbd>
                </button>
                <button
                  className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] text-slate-400 transition-colors hover:text-slate-200"
                  onClick={remindLater}
                >
                  <Icon name="schedule" size={16} />
                  稍后提醒（15 分钟后）
                </button>
                {current.noteId && (
                  <button
                    className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] text-violet-300 transition-colors hover:text-violet-200"
                    onClick={() => navigate(`/notes/${current.noteId}`)}
                  >
                    <Icon name="auto_stories" size={16} />
                    打开笔记
                  </button>
                )}
                {current.todoId && (
                  <button
                    className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] text-emerald-400 transition-colors hover:text-emerald-300"
                    onClick={() => void completeTodo()}
                  >
                    <Icon name="check_circle" size={16} />
                    直接完成
                  </button>
                )}
              </div>
            </div>

            {/* 候选池开关（对齐原型 02 底部） */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 rounded-xl border border-slate-800/80 bg-[#0d1524]/80 px-4 py-2.5">
              <span className="text-[11px] font-medium uppercase tracking-widest text-slate-500">候选池</span>
              {POOLS.map((p) => (
                <label
                  key={p.key}
                  className={`flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                    pools[p.key]
                      ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                      : 'border-slate-700 text-slate-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-3 w-3 accent-blue-500"
                    checked={pools[p.key]}
                    onChange={() => togglePool(p.key)}
                  />
                  {p.label}
                </label>
              ))}
            </div>

            {/* 队列圆点 */}
            <div className="mt-5 flex items-center justify-center gap-2">
              {candidates.map((c, i) => (
                <button
                  key={c.id}
                  title={c.title}
                  className={`h-2 rounded-full transition-all ${
                    i === safeIdx ? 'w-5 bg-blue-500' : 'w-2 bg-slate-700 hover:bg-slate-500'
                  }`}
                  onClick={() => setIdx(i)}
                />
              ))}
              <span className="ml-3 text-[11px] text-slate-500">
                已抽取并达成 {Math.min(candidates.length, safeIdx + 1)} / {candidates.length} 项
              </span>
            </div>
          </div>
        )}
      </main>

      {/* 底部按键提示 */}
      <footer className="relative z-10 flex items-center justify-center gap-6 border-t border-slate-800/80 py-3 text-[11.5px] text-slate-500">
        <span><kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">Space</kbd> 切换下一个灵感</span>
        <span><kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">Enter</kbd> 开启锁定强专注工作态</span>
        <span><kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">Esc</kbd> 返回工作台</span>
      </footer>

      {/* 稍后提醒 Toast */}
      {reminderMsg && (
        <div className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-900/95 px-5 py-2.5 text-[12.5px] text-slate-200 shadow-xl">
          <Icon name="notifications_active" className="mr-1.5 align-[-4px] text-[15px] text-amber-400" />
          {reminderMsg}
        </div>
      )}
    </div>
  )
}

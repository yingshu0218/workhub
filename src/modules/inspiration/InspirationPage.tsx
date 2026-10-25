import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { useNavigate } from 'react-router-dom'
import { useCollection, useQuery } from '@/queries/hooks'
import { db } from '@/db/db'
import type { Customer, IntimacyLevel, Todo, Transaction, Note, Link } from '@/db/types'
import { intimacyLevelName, resolveIntimacyLevel, useIntimacyConfig } from '@/modules/crm/intimacy'
import { useCustomerScoreRows } from '@/modules/crm/hooks'
import { toggleTodoDone } from '@/modules/todo/toggle'
import { registerShortcut } from '@/shared/shortcuts'
import { useFocusStore } from '@/stores/focus'
import buildCandidates from './engine'
import type { CandidateKind, InspirationCandidate } from './engine'
import { staggerStyle } from '@/shared/stagger'

/**
 * 灵感闪现全屏决策态（对齐原型 02-inspiration-flash · 全屏决策态（样式走设计 token，自动跟随深浅模式与主题包），不套 AppLayout）
 * Space 换一个 / Enter 开始专注（联动 focus store 并跳回工作台）/ Esc 退出回工作台
 */

const KIND_META: Record<CandidateKind, { chip: string; tone: string; icon: string }> = {
  'overdue-todo': {
    chip: '待办灵感 · 临界推进',
    tone: 'bg-danger-container text-danger border-danger/30',
    icon: 'priority_high',
  },
  'due-todo': {
    chip: '待办日程 · 今日到期',
    tone: 'bg-warning-container text-warning border-warning/30',
    icon: 'schedule',
  },
  reconciliation: {
    chip: '财务灵感 · 待对账',
    tone: 'bg-success-container/60 text-success border-success/30',
    icon: 'account_balance_wallet',
  },
  'stale-customer': {
    chip: '人脉灵感 · 久未跟进',
    tone: 'bg-primary-fixed text-primary border-primary/30',
    icon: 'handshake',
  },
  'stale-note': {
    chip: '笔记灵感 · 沉睡文库',
    tone: 'bg-primary-container text-on-primary-container border-primary/40',
    icon: 'auto_stories',
  },
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
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--color-outline-variant)"
          strokeWidth="5"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[0.9286rem] font-bold text-primary">
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
  // 提及已迁 links：客户 → 首篇提及该客户的笔记（mentions 索引 + 首条 link，与引擎原 find 口径一致）
  const mentionLinksRaw = useQuery<Link[]>(
    () =>
      db.links
        .where('kind')
        .equals('mention')
        .filter((l) => !l.deleted && l.toType === 'customers')
        .toArray(),
    [],
  )
  // 稳定空数组引用：`?? []` 直接放 hook 依赖里会每帧新建（react-hooks/exhaustive-deps）
  const mentionLinks = useMemo(() => mentionLinksRaw ?? [], [mentionLinksRaw])
  const notesByCustomerMention = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]))
    const m = new Map<string, Note>()
    for (const l of mentionLinks) {
      if (m.has(l.toId)) continue
      const n = byId.get(l.fromId)
      if (n) m.set(l.toId, n)
    }
    return m
  }, [notes, mentionLinks])

  // 候选池开关（组件态即可，不落库）
  const [pools, setPools] = useState<Record<PoolKey, boolean>>({
    todo: true,
    reconciliation: true,
    customer: true,
    note: true,
  })

  // 久未跟进客户的排序权重按**健康分档位**取值（原手动分层已并入健康分）：
  // 与客户列表/详情页同一套解析口径（手动优先 → 算法兜底），不在本页另算一套。
  const intimacyCfg = useIntimacyConfig()
  const scoreInputs = useCustomerScoreRows(
    customers.filter((c) => !c.intimacy?.level).map((c) => c.id),
  )
  const customerLevels = useMemo(() => {
    const map: Record<string, { level: IntimacyLevel; name: string }> = {}
    for (const c of customers) {
      const { level } = resolveIntimacyLevel(c, intimacyCfg, scoreInputs[c.id] ?? null)
      map[c.id] = { level, name: intimacyLevelName(intimacyCfg, level) }
    }
    return map
  }, [customers, intimacyCfg, scoreInputs])

  const candidates = useMemo(
    () =>
      buildCandidates({
        todos,
        transactions,
        customers,
        notes,
        notesByCustomerMention,
        customerLevels,
      }).filter((c) => pools[poolOfKind(c.kind)]),
    [todos, transactions, customers, notes, notesByCustomerMention, customerLevels, pools],
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
    // 完成态统一走领域函数（status 与 completedAt 成对写入，Issue #74）
    await toggleTodoDone(todo)
    next()
  }

  // 快捷键过统一注册表（Esc 退出 / Space 换一个 / Enter 开始专注）
  // handler 经 ref 间接调用：注册一次，始终拿到最新闭包（避免挂载/卸载风暴）
  const handlersRef = useRef({ next, startFocus, navigate })
  handlersRef.current = { next, startFocus, navigate }
  useEffect(() => {
    const unsubs = [
      registerShortcut({
        combo: 'space',
        description: '灵感闪现：换一个',
        scope: 'page',
        handler: () => handlersRef.current.next(),
      }),
      registerShortcut({
        combo: 'enter',
        description: '灵感闪现：开始专注执行',
        scope: 'page',
        handler: () => handlersRef.current.startFocus(),
      }),
      registerShortcut({
        combo: 'esc',
        description: '灵感闪现：退出回工作台',
        scope: 'page',
        handler: () => handlersRef.current.navigate('/'),
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  const kindMeta = current ? KIND_META[current.kind] : undefined
  const topMatch = candidates.length ? candidates[0].match : 0

  // 壳内全幅：负 margin 抵消 AppLayout main 的 px-8 py-6，高度补回上下 padding（3rem）
  return (
    <div className="relative -mx-8 -my-6 flex h-[calc(100%+3rem)] flex-col overflow-hidden bg-surface text-on-surface">
      {/* 背景光晕 */}
      <div className="pointer-events-none absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-1/4 h-96 w-96 rounded-full bg-primary-fixed/60 blur-3xl" />

      {/* 顶栏 */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary">
            <Icon name="flight_takeoff" size={18} fill />
          </div>
          <div>
            <div className="text-[0.9643rem] font-bold leading-tight">寻鸽工作台</div>
            <div className="text-[0.7143rem] uppercase tracking-widest text-outline">
              Nexus Workspace
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-success/30 bg-success-container/60 px-3 py-1 text-[0.8214rem] font-medium text-success">
            ● 算法置信度 {topMatch}%
          </span>
          <button
            className="flex h-8 items-center gap-1.5 nav-item !bg-transparent px-3 text-[0.8571rem] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
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
            <Icon name="auto_awesome" className="text-[3.7143rem] text-outline" />
            <div className="text-[1.2143rem] font-semibold">抽取池暂时是空的</div>
            <div className="max-w-sm text-[0.9286rem] leading-relaxed text-on-surface-variant">
              没有发现逾期待办、到期日程、待对账流水或久未跟进的客户。去工作台记录一笔，或先享受片刻清闲。
            </div>
            <button
              className="mt-2 rounded-lg bg-primary px-5 py-2.5 text-[0.9286rem] font-medium text-on-primary hover:bg-primary-container"
              onClick={() => navigate('/')}
            >
              返回工作台
            </button>
          </div>
        ) : (
          <div className="w-full max-w-[880px]">
            {/* 标题区 */}
            <div className="rounded-t-2xl border border-outline-variant/40 bg-surface-container-low px-7 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
                    <Icon name="bolt" fill />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[1.2143rem] font-bold">灵感闪现</span>
                      <span className="text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-outline">
                        Inspiration Flash
                      </span>
                      <kbd className="rounded bg-surface-container-high px-1.5 text-[0.7143rem] text-on-surface-variant">
                        ⌘J
                      </kbd>
                    </div>
                    <p className="mt-1 max-w-[520px] text-[0.8571rem] leading-relaxed text-on-surface-variant">
                      从待办事项、久未跟进客户、待对账流水与今日日程中，综合截止时限与商务权重，抽出当下最值得推进的事。
                    </p>
                  </div>
                </div>
                <button
                  className="flex shrink-0 items-center gap-1.5 surface-card-low !bg-surface-container px-3 py-1.5 text-[0.8571rem] text-on-surface-variant hover:border-primary hover:text-primary"
                  onClick={next}
                >
                  <Icon name="shuffle" size={15} />
                  抽取池
                </button>
              </div>
            </div>

            {/* 候选卡片 */}
            <div
              key={current.id}
              /* 已有 key={current.id} → 换卡即重挂，anim-enter 自然重播（无需新增状态） */
              className="anim-enter rounded-b-2xl border border-t-0 border-outline-variant/40 bg-surface-container-lowest px-7 py-6"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.8214rem] font-medium ${kindMeta!.tone}`}
                    >
                      <Icon name={kindMeta!.icon} size={13} />
                      {kindMeta!.chip}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-container/60 px-2.5 py-0.5 text-[0.8214rem] text-success">
                      ✓ 综合匹配合度 {current.match}%
                    </span>
                  </div>
                  <div className="mt-4 text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-outline">
                    Recommended Action Target
                  </div>
                  <h1 className="mt-1 text-[1.8571rem] font-bold leading-snug text-on-surface">
                    {current.title}
                  </h1>
                  <p className="mt-1.5 text-[0.9286rem] leading-relaxed text-on-surface-variant">
                    {current.reason}
                  </p>
                </div>
                <div className="flex flex-col items-center gap-1 pt-1">
                  <MatchRing pct={current.match} />
                  <span className="text-[0.7143rem] uppercase tracking-widest text-outline">合度</span>
                </div>
              </div>

              {/* 执行上下文（客户 · 款项 · 笔记） */}
              {current.context.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {current.context.map((ctx, i) => (
                    <div
                      key={ctx.label}
                      style={staggerStyle(i)}
                      className="anim-list-item surface-card-low rounded-xl px-4 py-3"
                    >
                      <div className="flex items-center gap-1.5 text-[0.7857rem] font-medium text-outline">
                        <Icon name={ctx.icon} size={14} />
                        {ctx.label}
                      </div>
                      <div className="mt-1 truncate text-[0.9286rem] font-medium text-on-surface">
                        {ctx.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 操作区 */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-[0.9643rem] font-semibold text-on-primary transition-colors hover:bg-primary-container"
                  onClick={startFocus}
                >
                  <Icon name="play_arrow" size={17} />
                  立即专注执行（锁定此任务）
                  <kbd className="rounded bg-on-primary/20 px-1.5 text-[0.75rem]">Enter</kbd>
                </button>
                <button
                  className="flex h-11 items-center gap-2 surface-card-low rounded-xl !bg-surface-container px-4 text-[0.9286rem] text-on-surface transition-colors hover:border-outline"
                  onClick={next}
                >
                  <Icon name="shuffle" size={16} />
                  换一个
                  <kbd className="rounded bg-surface-container-high px-1.5 text-[0.75rem] text-on-surface-variant">
                    Space
                  </kbd>
                </button>
                <button
                  className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[0.9286rem] text-on-surface-variant transition-colors hover:text-on-surface"
                  onClick={remindLater}
                >
                  <Icon name="schedule" size={16} />
                  稍后提醒（15 分钟后）
                </button>
                {current.noteId && (
                  <button
                    className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[0.9286rem] text-primary transition-colors hover:text-primary"
                    onClick={() => navigate(`/notes/${current.noteId}`)}
                  >
                    <Icon name="auto_stories" size={16} />
                    打开笔记
                  </button>
                )}
                {current.todoId && (
                  <button
                    className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[0.9286rem] text-success transition-colors hover:text-success"
                    onClick={() => void completeTodo()}
                  >
                    <Icon name="check_circle" size={16} />
                    直接完成
                  </button>
                )}
              </div>
            </div>

            {/* 候选池开关（对齐原型 02 底部） */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 surface-card-low rounded-xl px-4 py-2.5">
              <span className="text-[0.7857rem] font-medium uppercase tracking-widest text-outline">
                候选池
              </span>
              {POOLS.map((p) => (
                <label
                  key={p.key}
                  className={`flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8214rem] transition-colors ${
                    pools[p.key]
                      ? 'border-primary/50 bg-primary-fixed text-primary'
                      : 'border-outline-variant/60 text-on-surface-variant'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-3 w-3 accent-[var(--color-primary)]"
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
                    i === safeIdx ? 'w-5 bg-primary' : 'w-2 bg-outline-variant/60 hover:bg-outline'
                  }`}
                  onClick={() => setIdx(i)}
                />
              ))}
              <span className="ml-3 text-[0.7857rem] text-on-surface-variant">
                已抽取并达成 {Math.min(candidates.length, safeIdx + 1)} / {candidates.length} 项
              </span>
            </div>
          </div>
        )}
      </main>

      {/* 底部按键提示 */}
      <footer className="relative z-10 flex items-center justify-center gap-6 border-t border-outline-variant/40 py-3 text-[0.8214rem] text-on-surface-variant">
        <span>
          <kbd className="rounded bg-surface-container-high px-1.5 py-0.5 text-on-surface">
            Space
          </kbd>{' '}
          切换下一个灵感
        </span>
        <span>
          <kbd className="rounded bg-surface-container-high px-1.5 py-0.5 text-on-surface">
            Enter
          </kbd>{' '}
          开启锁定强专注工作态
        </span>
        <span>
          <kbd className="rounded bg-surface-container-high px-1.5 py-0.5 text-on-surface">Esc</kbd>{' '}
          返回工作台
        </span>
      </footer>

      {/* 稍后提醒 Toast */}
      {reminderMsg && (
        <div className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-full border border-outline-variant/60 bg-surface-container-high px-5 py-2.5 text-[0.8929rem] text-on-surface shadow-xl">
          <Icon
            name="notifications_active"
            className="mr-1.5 align-[-4px] text-[1.0714rem] text-warning"
          />
          {reminderMsg}
        </div>
      )}
    </div>
  )
}

import { isServerFirstWeb } from '@/platform/env'
import { connectionEpoch } from '@/platform/endpoint'
import { create } from 'zustand'
import { db } from '@/db/db'
import { newId } from '@/repositories'
import { eventBus } from '@/shared/eventBus'

/**
 * 专注计时器（25min 番茄）
 * 进行中状态持久化到 sessionStorage 快照（刷新/杀进程恢复，审计 P1-5）；
 * pagehide 按墙钟结算已投入分钟落 focusSessions（不足 1 分钟丢弃）。
 * 计秒唯一事实来源是墙钟：elapsed = Date.now() - startedAt - 暂停累计，
 * remaining 由 elapsed 派生；interval 仅驱动刷新（后台节流不会造成计秒失真）。
 * 自然结束恒按完整时长 FOCUS_TOTAL_SEC 记账。
 */
export const FOCUS_TOTAL_SEC = 25 * 60

/** sessionStorage 快照 key（进程级持久化：刷新可恢复，关闭标签页自然作废） */
const FOCUS_SNAPSHOT_KEY = 'nexus:focus-session'

interface FocusState {
  status: 'idle' | 'running' | 'paused'
  remaining: number
  todoId?: string
  todoTitle?: string
  startedAt?: number
  /** 暂停累计毫秒数（墙钟重算时扣除） */
  pausedAccumMs: number
  /** 本次暂停的起点（resume 时并入 pausedAccumMs） */
  pausedAt?: number
  timer?: ReturnType<typeof setInterval>
  start: (todoId?: string, todoTitle?: string) => void
  pause: () => void
  resume: () => void
  finish: () => Promise<void>
  abort: () => void
}

/** 已专注秒数（墙钟推导，暂停期间不计） */
function elapsedSec(startedAt: number, pausedAccumMs: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt - pausedAccumMs) / 1000))
}

async function recordSession(startedAt: number, seconds: number, _todoId?: string) {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return
  const epoch=connectionEpoch(),cache=db
  await cache.focusSessions.put({
    id: newId('fs'),
    startedAt,
    completedAt: Date.now(),
    minutes,
  })
  // 口径统一（Issue #74）：「专注中」是运行时 UI 状态，不回写 todo.status（已收窄两态）
  void _todoId
  if(epoch===connectionEpoch())eventBus.emit('focus:completed', { minutes })
}

/** 写 sessionStorage 快照（失败静默：持久化是增强，不阻塞计时） */
function writeSnapshot(s: {
  status: FocusState['status']
  todoId?: string
  todoTitle?: string
  startedAt?: number
  pausedAccumMs: number
  pausedAt?: number
}) {
  try {
    if (s.status === 'idle' || !s.startedAt) {
      sessionStorage.removeItem(FOCUS_SNAPSHOT_KEY)
    } else {
      sessionStorage.setItem(
        FOCUS_SNAPSHOT_KEY,
        JSON.stringify({
          todoId: s.todoId,
          todoTitle: s.todoTitle,
          startedAt: s.startedAt,
          pausedAccumMs: s.pausedAccumMs,
          pausedAt: s.pausedAt,
        }),
      )
    }
  } catch {
    /* 隐私模式等场景 sessionStorage 不可用：忽略 */
  }
}

/**
 * pagehide 兜底结算（审计 P1-5）：刷新/切后台被杀前，把已投入 ≥1 分钟的进行中
 * 专注按墙钟落 focusSessions（会话以 start 为界，结算后重置快照起点为当前墙钟，
 * 恢复后从新段继续累计，不重复计费）。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const s = useFocusStore.getState()
    if (!s.startedAt || (s.status !== 'running' && s.status !== 'paused')) return
    const elapsed = elapsedSec(s.startedAt, s.pausedAccumMs)
    if (elapsed >= 60) {
      void recordSession(s.startedAt, Math.min(elapsed, FOCUS_TOTAL_SEC), s.todoId)
    }
    // 结算后快照起点重置：恢复时从当前墙钟继续（已投入部分已落库）
    writeSnapshot({ ...s, startedAt: Date.now(), pausedAccumMs: 0, pausedAt: undefined })
  })
}

export const useFocusStore = create<FocusState>((set, get) => {
  /** interval 仅驱动刷新：每次 tick 按墙钟重算 remaining，归零即自然结束 */
  function startTicker() {
    const timer = setInterval(() => {
      const s = get()
      if (s.status !== 'running' || !s.startedAt) return
      const remaining = FOCUS_TOTAL_SEC - elapsedSec(s.startedAt, s.pausedAccumMs)
      if (remaining <= 0) {
        clearInterval(s.timer)
        set({
          remaining: 0,
          timer: undefined,
          status: 'idle',
          todoId: undefined,
          todoTitle: undefined,
        })
        writeSnapshot({ status: 'idle', pausedAccumMs: 0 })
        void recordSession(s.startedAt, FOCUS_TOTAL_SEC, s.todoId)
        return
      }
      set({ remaining })
    }, 1000)
    return timer
  }

  function resetToIdle() {
    set({
      status: 'idle',
      remaining: FOCUS_TOTAL_SEC,
      timer: undefined,
      todoId: undefined,
      todoTitle: undefined,
      startedAt: undefined,
      pausedAccumMs: 0,
      pausedAt: undefined,
    })
    writeSnapshot({ status: 'idle', pausedAccumMs: 0 })
  }

  // 启动恢复：刷新后若有进行中/暂停快照，按墙钟重建计时
  function restore() {
    try {
      const raw = sessionStorage.getItem(FOCUS_SNAPSHOT_KEY)
      if (!raw) return
      const snap = JSON.parse(raw) as {
        todoId?: string
        todoTitle?: string
        startedAt?: number
        pausedAccumMs?: number
        pausedAt?: number
      }
      if (!snap.startedAt) return
      const pausedAccumMs = snap.pausedAccumMs ?? 0
      const running = !snap.pausedAt
      const elapsed = elapsedSec(snap.startedAt, pausedAccumMs)
      if (elapsed >= FOCUS_TOTAL_SEC) {
        // 刷新前已完成：按完整时长记账
        void recordSession(snap.startedAt, FOCUS_TOTAL_SEC, snap.todoId)
        return
      }
      const remaining = FOCUS_TOTAL_SEC - elapsed
      if (running) {
        set({
          status: 'running',
          remaining,
          todoId: snap.todoId,
          todoTitle: snap.todoTitle,
          startedAt: snap.startedAt,
          pausedAccumMs,
          pausedAt: undefined,
          timer: startTicker(),
        })
      } else {
        set({
          status: 'paused',
          remaining,
          todoId: snap.todoId,
          todoTitle: snap.todoTitle,
          startedAt: snap.startedAt,
          pausedAccumMs,
          pausedAt: snap.pausedAt,
        })
      }
    } catch {
      /* 快照损坏：忽略 */
    }
  }
  // 在线客户端只在已验证会话内启动计时，旧进程快照不能在登录前写入另一空间。
  if(!isServerFirstWeb())restore()

  return {
    status: 'idle',
    remaining: FOCUS_TOTAL_SEC,
    pausedAccumMs: 0,

    start(todoId, todoTitle) {
      if (get().timer) clearInterval(get().timer)
      const timer = startTicker()
      set({
        status: 'running',
        remaining: FOCUS_TOTAL_SEC,
        todoId,
        todoTitle,
        startedAt: Date.now(),
        pausedAccumMs: 0,
        pausedAt: undefined,
        timer,
      })
      writeSnapshot(get())
    },

    pause() {
      const s = get()
      if (s.status !== 'running') return
      if (s.timer) clearInterval(s.timer)
      set({ status: 'paused', timer: undefined, pausedAt: Date.now() })
      writeSnapshot(get())
    },

    resume() {
      const s = get()
      if (s.status !== 'paused' || !s.startedAt) return
      set({
        status: 'running',
        pausedAccumMs: s.pausedAccumMs + (Date.now() - (s.pausedAt ?? Date.now())),
        pausedAt: undefined,
      })
      set({ timer: startTicker() })
      writeSnapshot(get())
    },

    async finish() {
      const s = get()
      if (s.timer) clearInterval(s.timer)
      const { startedAt, pausedAccumMs, todoId } = s
      resetToIdle()
      if (!startedAt) return
      // 手动完成按墙钟实算，封顶完整时长
      const elapsed = Math.min(elapsedSec(startedAt, pausedAccumMs), FOCUS_TOTAL_SEC)
      if (elapsed >= 60) await recordSession(startedAt, elapsed, todoId)
    },

    abort() {
      const { timer } = get()
      if (timer) clearInterval(timer)
      resetToIdle()
    },
  }
})

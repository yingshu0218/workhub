import { create } from 'zustand'
import { db } from '@/db/db'
import { newId } from '@/repositories'
import { eventBus } from '@/shared/eventBus'

/**
 * 专注计时器（25min 番茄）
 * 状态只存内存（瞬态，不参与同步）；完成的会话写入本地 focusSessions 表
 * 计秒唯一事实来源是墙钟：elapsed = Date.now() - startedAt - 暂停累计，
 * remaining 由 elapsed 派生；interval 仅驱动刷新（后台节流不会造成计秒失真）。
 * 自然结束恒按完整时长 FOCUS_TOTAL_SEC 记账。
 */
export const FOCUS_TOTAL_SEC = 25 * 60

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

async function recordSession(startedAt: number, seconds: number, todoId?: string) {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return
  await db.focusSessions.put({
    id: newId('fs'),
    startedAt,
    completedAt: Date.now(),
    minutes,
  })
  void todoId // P2 联动待办状态
  eventBus.emit('focus:completed', { minutes })
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
  }

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
    },

    pause() {
      const s = get()
      if (s.status !== 'running') return
      if (s.timer) clearInterval(s.timer)
      set({ status: 'paused', timer: undefined, pausedAt: Date.now() })
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

import { create } from 'zustand'
import { db } from '@/db/db'
import { newId } from '@/repositories'
import { eventBus } from '@/shared/eventBus'

/**
 * 专注计时器（25min 番茄）
 * 状态只存内存（瞬态，不参与同步）；完成的会话写入本地 focusSessions 表
 * 累计专注秒数恒等式：elapsed = FOCUS_TOTAL_SEC - remaining（pause/resume 不重置 remaining）
 */
export const FOCUS_TOTAL_SEC = 25 * 60

interface FocusState {
  status: 'idle' | 'running' | 'paused'
  remaining: number
  todoId?: string
  todoTitle?: string
  startedAt?: number
  timer?: ReturnType<typeof setInterval>
  start: (todoId?: string, todoTitle?: string) => void
  pause: () => void
  resume: () => void
  finish: () => Promise<void>
  abort: () => void
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

export const useFocusStore = create<FocusState>((set, get) => ({
  status: 'idle',
  remaining: FOCUS_TOTAL_SEC,

  start(todoId, todoTitle) {
    if (get().timer) clearInterval(get().timer)
    const timer = setInterval(() => {
      const s = get()
      if (s.status !== 'running') return
      if (s.remaining <= 1) {
        clearInterval(s.timer)
        set({
          remaining: 0,
          timer: undefined,
          status: 'idle',
          todoId: undefined,
          todoTitle: undefined,
        })
        void recordSession(s.startedAt ?? Date.now(), FOCUS_TOTAL_SEC - s.remaining, s.todoId)
        return
      }
      set({ remaining: s.remaining - 1 })
    }, 1000)
    set({
      status: 'running',
      remaining: FOCUS_TOTAL_SEC,
      todoId,
      todoTitle,
      startedAt: Date.now(),
      timer,
    })
  },

  pause() {
    const { timer } = get()
    if (timer) clearInterval(timer)
    set({ status: 'paused', timer: undefined })
  },

  resume() {
    const s = get()
    if (s.status !== 'paused') return
    const timer = setInterval(() => {
      const cur = get()
      if (cur.status !== 'running') return
      if (cur.remaining <= 1) {
        clearInterval(cur.timer)
        set({
          remaining: 0,
          timer: undefined,
          status: 'idle',
          todoId: undefined,
          todoTitle: undefined,
        })
        void recordSession(cur.startedAt ?? Date.now(), FOCUS_TOTAL_SEC - cur.remaining, cur.todoId)
        return
      }
      set({ remaining: cur.remaining - 1 })
    }, 1000)
    set({ status: 'running', timer })
  },

  async finish() {
    const s = get()
    if (s.timer) clearInterval(s.timer)
    const elapsed = FOCUS_TOTAL_SEC - s.remaining
    set({
      status: 'idle',
      remaining: FOCUS_TOTAL_SEC,
      timer: undefined,
      todoId: undefined,
      todoTitle: undefined,
    })
    if (elapsed >= 60) await recordSession(s.startedAt ?? Date.now(), elapsed, s.todoId)
  },

  abort() {
    const { timer } = get()
    if (timer) clearInterval(timer)
    set({
      status: 'idle',
      remaining: FOCUS_TOTAL_SEC,
      timer: undefined,
      todoId: undefined,
      todoTitle: undefined,
    })
  },
}))

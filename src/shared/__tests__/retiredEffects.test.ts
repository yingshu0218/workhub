// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { DEFAULT_SETTINGS, type Habit, type Trophy } from '@/db/types'
import { habitRepo, trophyRepo } from '@/repositories'
import { settingsRepo } from '@/repositories/localAdmin'
import { useFocusStore } from '@/stores/focus'
import { eventBus } from '../eventBus'
import { installModuleEffects } from '../effects'

let dispose: (() => void) | undefined

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  useFocusStore.getState().abort()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('习惯与奖杯退役后的全局订阅', () => {
  it('专注仍记录分钟，既有自动联动设置不再触发打卡或奖杯评估', async () => {
    const habit: Habit = {
      id: 'legacy-focus', name: '深度专注', category: '工作', icon: 'work',
      color: '#336699', motivationNote: '',
      targetMinutes: 1, schedule: '每日', crossModuleSync: true, createdAt: 1,
      updatedAt: 1, rev: 1, deleted: 0,
    }
    const trophy: Trophy = {
      id: 'legacy-trophy', name: '历史专注奖杯', tier: '铜', rarity: '50%',
      description: '保留原始记录', icon: 'emoji_events', conditionType: 'focus_once_minutes',
      conditionValue: 1, updatedAt: 1, rev: 1, deleted: 0,
    }
    await db.habits.put(habit)
    await db.trophies.put(trophy)
    await db.habitLogs.put({
      id: 'legacy-log', habitId: habit.id, date: '2026-10-01', completedAt: 1,
      updatedAt: 1, rev: 1, deleted: 0,
    })
    const historicalLogs = await db.habitLogs.toArray()
    const listHabits = vi.spyOn(habitRepo, 'list')
    const listTrophies = vi.spyOn(trophyRepo, 'list')
    const trophyEvent = vi.fn()
    const offTrophyEvent = eventBus.on('trophy:unlocked', trophyEvent)

    try {
      dispose = installModuleEffects()
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      useFocusStore.getState().start()
      vi.setSystemTime(Date.now() + 25 * 60 * 1000)
      await useFocusStore.getState().finish()
      eventBus.emit('habit:checked', { habitId: habit.id, date: '2026-11-17' })
      eventBus.emit('transaction:created', { transactionId: 'legacy-transaction' })

      expect(await db.focusSessions.toArray()).toEqual([expect.objectContaining({ minutes: 25 })])
      expect(listHabits).not.toHaveBeenCalled()
      expect(listTrophies).not.toHaveBeenCalled()
      expect(trophyEvent).not.toHaveBeenCalled()
      expect(await db.habits.toArray()).toEqual([habit])
      expect(await db.habitLogs.toArray()).toEqual(historicalLogs)
      expect(await db.trophies.toArray()).toEqual([trophy])
    } finally {
      offTrophyEvent()
    }
  })

  it('外观设置仍实时应用，卸载后停止消费设置广播', async () => {
    dispose = installModuleEffects()
    await settingsRepo.save({ appearance: { mode: 'dark' } })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    dispose()
    dispose = undefined
    eventBus.emit('settings:changed', { settings: DEFAULT_SETTINGS })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

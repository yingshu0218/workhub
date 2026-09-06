import { eventBus } from './eventBus'
import { habitRepo, habitLogRepo } from '@/repositories'
import { newId } from '@/repositories'
import dayjs from 'dayjs'

/**
 * 跨模块联动订阅（开发计划 2.4）
 * 深度专注完成 → 自动打卡「深度专注」习惯（若开启跨模块联动且时长达标）
 */
let installed = false

export function installModuleEffects() {
  if (installed) return
  installed = true

  eventBus.on('focus:completed', async ({ minutes }) => {
    try {
      const habits = await habitRepo.list()
      const focusHabit = habits.find((h) => h.crossModuleSync && h.targetMinutes > 0 && h.category === '工作')
      if (!focusHabit || minutes < focusHabit.targetMinutes) return
      const date = dayjs().format('YYYY-MM-DD')
      const logs = await habitLogRepo.list()
      const exists = logs.some((l) => l.habitId === focusHabit.id && l.date === date)
      if (exists) return
      await habitLogRepo.put({
        id: newId('hl'),
        habitId: focusHabit.id,
        date,
        completedAt: Date.now(),
        evidence: `深度专注 ${minutes} 分钟`,
      })
      eventBus.emit('habit:checked', { habitId: focusHabit.id, date })
    } catch (err) {
      console.error('[effects] focus→habit 联动失败', err)
    }
  })
}

/** 退役功能的旧入口仍须给出确定结论，不能被历史白名单重新开启。 */
export const RETIRED_HABIT_TOOLS = [
  'habit_checkin', 'habit_createHabit', 'habit_updateHabit', 'habit_deleteHabit',
] as const

export const RETIRED_FEATURE_MESSAGE = 'FEATURE_RETIRED: 习惯打卡与成就奖杯功能已下线；历史记录仅供读取、导出或回收站恢复/清理。'

export function isRetiredHabitTool(name: string): boolean {
  return (RETIRED_HABIT_TOOLS as readonly string[]).includes(name)
}

export function isRetiredFeatureTable(table: string): boolean {
  return ['habits', 'habitLogs', 'trophies'].includes(table)
}

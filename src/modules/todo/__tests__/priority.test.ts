/**
 * 待办四档「重要 × 紧急」优先级回归（Issue #148 后续）
 *
 * 锁定四条纪律：
 *   ① 四档档位与象限文案一一对应（高=重要紧急 / 中=重要不紧急 / 低=不重要紧急 / 无=不重要不紧急）；
 *   ② 存量 P1/P2/P3 读侧归一化（P1→high / P2→mid / P3→low），未知值兜底 mid，绝不抛错；
 *   ③ Agent 写侧入参接受旧档位别名，落库恒为新档位；
 *   ④ 筛选 / 色板 / 权重 / 高优先级判定全部收口在同名函数上，不散落三元表达式。
 */
import { describe, it, expect } from 'vitest'
import {
  TODO_PRIORITY_LEVELS,
  TODO_PRIORITY_META,
  DEFAULT_TODO_PRIORITY,
  normalizeTodoPriority,
  toTodoPriority,
  todoPriorityLabel,
  todoPriorityFullLabel,
  todoPriorityTone,
  todoPriorityWeight,
  isHighPriority,
  matchesPriorityFilter,
} from '../priority'

describe('① 四档档位与象限示意', () => {
  it('档位集合为 高/中/低/无 四档，顺序稳定', () => {
    expect([...TODO_PRIORITY_LEVELS]).toEqual(['high', 'mid', 'low', 'none'])
  })

  it('每档都有中文名与象限示意', () => {
    expect(TODO_PRIORITY_META.high).toMatchObject({ label: '高', quadrant: '重要紧急' })
    expect(TODO_PRIORITY_META.mid).toMatchObject({ label: '中', quadrant: '重要不紧急' })
    expect(TODO_PRIORITY_META.low).toMatchObject({ label: '低', quadrant: '不重要紧急' })
    expect(TODO_PRIORITY_META.none).toMatchObject({ label: '无', quadrant: '不重要不紧急' })
  })

  it('权重随「重要 × 紧急」递减：高 > 中 > 低 > 无', () => {
    expect(todoPriorityWeight('high')).toBeGreaterThan(todoPriorityWeight('mid'))
    expect(todoPriorityWeight('mid')).toBeGreaterThan(todoPriorityWeight('low'))
    expect(todoPriorityWeight('low')).toBeGreaterThan(todoPriorityWeight('none'))
  })

  it('新建缺省档位为「无」（白色卡片，Issue #148 最新口径）', () => {
    expect(DEFAULT_TODO_PRIORITY).toBe('none')
  })
})

describe('② 存量 P1/P2/P3 读侧归一化', () => {
  it('P1→高 / P2→中 / P3→低', () => {
    expect(normalizeTodoPriority('P1')).toBe('high')
    expect(normalizeTodoPriority('P2')).toBe('mid')
    expect(normalizeTodoPriority('P3')).toBe('low')
  })

  it('已是新档位则原样返回', () => {
    for (const p of TODO_PRIORITY_LEVELS) expect(normalizeTodoPriority(p)).toBe(p)
  })

  it('未知值 / 空值兜底「中」，不抛错', () => {
    expect(normalizeTodoPriority('P9')).toBe('mid')
    expect(normalizeTodoPriority('')).toBe('mid')
    expect(normalizeTodoPriority(undefined)).toBe('mid')
    expect(normalizeTodoPriority(null)).toBe('mid')
    expect(normalizeTodoPriority(123)).toBe('mid')
  })

  it('旧数据经过展示函数后不再出现 P1/P2/P3 字样', () => {
    expect(todoPriorityLabel('P1')).toBe('高')
    expect(todoPriorityFullLabel('P1')).toBe('高 · 重要紧急')
    expect(todoPriorityTone('P2')).toBe('amber')
  })
})

describe('③ 写侧别名兼容（Agent 已分发契约不破）', () => {
  it('toTodoPriority 与读侧同口径', () => {
    expect(toTodoPriority('P1')).toBe('high')
    expect(toTodoPriority('none')).toBe('none')
  })
})

describe('④ 判定与筛选收口', () => {
  it('isHighPriority 只为「高」档返回 true（含旧 P1）', () => {
    expect(isHighPriority({ priority: 'high' })).toBe(true)
    expect(isHighPriority({ priority: 'P1' as never })).toBe(true)
    expect(isHighPriority({ priority: 'mid' })).toBe(false)
    expect(isHighPriority({ priority: 'none' })).toBe(false)
  })

  it('matchesPriorityFilter：空筛选全通过，指定档位按归一化后比较', () => {
    expect(matchesPriorityFilter('P1', null)).toBe(true)
    expect(matchesPriorityFilter('P1', 'high')).toBe(true)
    expect(matchesPriorityFilter('high', 'high')).toBe(true)
    expect(matchesPriorityFilter('mid', 'high')).toBe(false)
    expect(matchesPriorityFilter('none', 'none')).toBe(true)
  })
})

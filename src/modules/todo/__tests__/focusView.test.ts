/**
 * 深链定位视图选择（Issue #128 三态口径的连带缺口回归）
 *
 * 背景：`/todo?focus=<id>` 由客户时间线鱼骨 / CRM 活动流穿透进入，
 * 而这两处最常指向**终态**待办（已完成 / 已作废）。
 * 三态口径下「全部待办 / 今天 / 最近七天」只装未完成条目，终态是独立视图——
 * 若一律切到「全部待办」，目标会被挡在视图外，表现为「点进去跳了、但目标行不见」。
 *
 * 本测试锁死 `resolveFocusViewKind` 的口径：
 *   ① 已完成目标 → 'done'；② 已作废目标 → 'voided'；③ 未完成目标 → 'all'；
 *   ④ 目标不存在 / focusId 缺省 → 'all'（调用方据此兜底，不误切视图）。
 * 并验证「切到该视图后目标确实在范围内」——用与页面同源的 matchesSmart 口径复算。
 */
import { describe, it, expect } from 'vitest'
import type { Todo } from '@/db/types'
import { isTodoOpen, isTodoDone, isTodoVoided, resolveFocusViewKind } from '../domain'

const mk = (id: string, status: Todo['status']): Pick<Todo, 'id' | 'status'> => ({ id, status })

type Kind = 'all' | 'done' | 'voided'

/** 与 TodoPage.matchesSmart 同源的口径复算：目标是否落在该视图范围内 */
function inView(target: Pick<Todo, 'id' | 'status'>, kind: Kind): boolean {
  if (kind === 'done') return isTodoDone(target)
  if (kind === 'voided') return isTodoVoided(target)
  return isTodoOpen(target)
}

describe('深链定位：按目标状态切视图（终态可见性）', () => {
  const rows = [mk('o1', 'todo'), mk('d1', 'done'), mk('v1', 'voided')]

  it('① 已完成目标 → 切「已完成」视图，且目标在范围内', () => {
    const kind = resolveFocusViewKind(rows, 'd1')
    expect(kind).toBe('done')
    expect(inView(rows[1], kind)).toBe(true)
  })

  it('② 已作废目标 → 切「已作废」视图，且目标在范围内', () => {
    const kind = resolveFocusViewKind(rows, 'v1')
    expect(kind).toBe('voided')
    expect(inView(rows[2], kind)).toBe(true)
  })

  it('③ 未完成目标 → 「全部待办」，目标在范围内', () => {
    const kind = resolveFocusViewKind(rows, 'o1')
    expect(kind).toBe('all')
    expect(inView(rows[0], kind)).toBe(true)
  })

  it('④ 目标不存在 / focusId 缺省 → all（不误切视图）', () => {
    expect(resolveFocusViewKind(rows, '不存在')).toBe('all')
    expect(resolveFocusViewKind(rows, undefined)).toBe('all')
    expect(resolveFocusViewKind([], 'd1')).toBe('all')
  })

  it('⑤ 反向验证：终态目标在「全部待办」下确实不可见（证明必须切视图）', () => {
    // 这正是修复前的表现——若回归成一律 'all'，终态目标就又不显示了
    expect(inView(rows[1], 'all')).toBe(false)
    expect(inView(rows[2], 'all')).toBe(false)
  })
})

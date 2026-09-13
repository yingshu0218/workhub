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
import {
  isTodoOpen,
  isTodoDone,
  isTodoVoided,
  resolveFocusViewKind,
  resolveFocusAction,
  todoFocusPath,
} from '../domain'

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

describe('待办详情深链收口 todoFocusPath（Issue #162）', () => {
  it('① 生成 /todo?focus=<id> 且对特殊字符做编码', () => {
    expect(todoFocusPath('td1')).toBe('/todo?focus=td1')
    expect(todoFocusPath('a b&c')).toBe('/todo?focus=a%20b%26c')
  })

  it('② 四类入口同源：搜索结果 / 时间线骨刺 / 财务凭证文案指向同一路径口径', () => {
    // 只要都走 todoFocusPath，编码与参数名就不会各写一遍而漂移
    for (const id of ['td-1', 'td_2', 'td 3']) {
      expect(todoFocusPath(id)).toBe(`/todo?focus=${encodeURIComponent(id)}`)
    }
  })
})

/**
 * 深链动作决策（缺陷 D10 / 功能测试 #162 的根因回归）
 *
 * 原缺陷：effect 无论命中与否都清参 —— 首帧 todos 为空时清掉 `?focus=`，
 * 数据回填后 effect 重跑时 focusId 已由 searchParams 派生为 undefined，
 * 开头 `if (!focusId) return` 直接返回，**详情抽屉永不打开**。
 * 表现为「直接开深链 / ⌘K 点结果 → 只跳到列表、不进详情」。
 */
describe('深链动作决策 resolveFocusAction（D10）', () => {
  it('① 目标已在库中 → open（打开详情 + 清参）', () => {
    const rows = [mk('o1', 'todo'), mk('d1', 'done'), mk('v1', 'voided')]
    for (const id of ['o1', 'd1', 'v1']) expect(resolveFocusAction(rows, id)).toBe('open')
  })

  it('② 集合为空（首帧未回填）→ wait，**绝不清参**（这是 D10 的修复点）', () => {
    // 修复前这里会走「清参」路径，直接把深链参数吃掉
    expect(resolveFocusAction([], 'd1')).toBe('wait')
  })

  it('③ 数据已就绪但目标不在 → fallback（滚动兜底后清参收尾）', () => {
    const rows = [mk('o1', 'todo'), mk('d1', 'done')]
    expect(resolveFocusAction(rows, '已删除的id')).toBe('fallback')
  })

  it('④ 时序还原：先 wait、数据回填后转 open（深链最终能打开详情）', () => {
    const focusId = 'd1'
    // 第 1 轮：live query 还没回填
    expect(resolveFocusAction([], focusId)).toBe('wait')
    // 第 2 轮：todos 到达（依赖变化触发 effect 重跑）—— 因为参数没被清，focusId 仍在
    expect(resolveFocusAction([mk('o1', 'todo'), mk('d1', 'done')], focusId)).toBe('open')
  })

  it('⑤ 防回退：任何「有数据 + 目标存在」的组合都不得落到 fallback', () => {
    const rows = [mk('a', 'todo'), mk('b', 'done'), mk('c', 'voided')]
    for (const id of ['a', 'b', 'c']) expect(resolveFocusAction(rows, id)).not.toBe('fallback')
  })
})

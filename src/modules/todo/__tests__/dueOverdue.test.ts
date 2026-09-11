/**
 * 「今日到期 / 逾期」分组口径回归（Issue #134 四轮）
 *
 * 背景：工作台「今日待办日程」与待办中心此前把两类条目混在一列（`isDueToday` = 今日到期 ∪ 逾期）。
 * 逾期条目最需要被看见，却会被「今天还没到点」的条目稀释；指标卡同样只给一个总数。
 * 本轮把它们拆成两个**互斥**分组，故口径必须锁死：
 *   ① 逾期按**时刻**判定（今天 09:00 的待办过了 09:00 就是逾期，不能等明天）；
 *   ② 今日到期不含逾期条目 —— 否则同一条待办会在两列同时出现，计数翻倍；
 *   ③ 两者并集恒等于 isDueToday（拆分不改变「今天」总量，只改变呈现粒度）；
 *   ④ 已完成 / 已作废 / 无截止 / 明天到期 一律不进任何一组（三态口径 + 不催办）。
 */
import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import type { Todo } from '@/db/types'
import { isDueToday, isTodoDueToday, isTodoOverdue } from '../domain'

type Row = Pick<Todo, 'status' | 'dueAt'>

const now = dayjs('2026-09-11T14:00:00')
const todayStr = now.format('YYYY-MM-DD')
const at = (s: string): number => dayjs(s).valueOf()

const open = (dueAt?: number): Row => ({ status: 'todo', dueAt })
const done = (dueAt?: number): Row => ({ status: 'done', dueAt })
const voided = (dueAt?: number): Row => ({ status: 'voided', dueAt })

describe('① 逾期按时刻判定（不是自然日）', () => {
  it('今天 09:00 到期、此刻 14:00 → 已逾期', () => {
    expect(isTodoOverdue(open(at('2026-09-11T09:00:00')), now)).toBe(true)
  })

  it('今天 18:00 到期、此刻 14:00 → 未逾期（还差 4 小时）', () => {
    expect(isTodoOverdue(open(at('2026-09-11T18:00:00')), now)).toBe(false)
  })

  it('昨天到期的条目依然逾期', () => {
    expect(isTodoOverdue(open(at('2026-09-10T09:00:00')), now)).toBe(true)
  })

  it('已完成 / 已作废 / 无截止时间 → 一律不算逾期（不催办终态与无期限条目）', () => {
    expect(isTodoOverdue(done(at('2026-09-01T09:00:00')), now)).toBe(false)
    expect(isTodoOverdue(voided(at('2026-09-01T09:00:00')), now)).toBe(false)
    expect(isTodoOverdue(open(undefined), now)).toBe(false)
  })
})

describe('② 今日到期：未完成 + 截止落在今天（不含逾期）', () => {
  it('今天 18:00 到期（尚未到点）→ 今日到期', () => {
    expect(isTodoDueToday(open(at('2026-09-11T18:00:00')), todayStr)).toBe(true)
  })

  it('今天 09:00 到期（已过点）→ 不算今日到期，归逾期组，两组互斥', () => {
    const t = open(at('2026-09-11T09:00:00'))
    expect(isTodoDueToday(t, todayStr)).toBe(false)
    expect(isTodoOverdue(t, now)).toBe(true)
  })

  it('明天到期 → 既非今日到期也非逾期', () => {
    const t = open(at('2026-09-12T09:00:00'))
    expect(isTodoDueToday(t, todayStr)).toBe(false)
    expect(isTodoOverdue(t, now)).toBe(false)
  })

  it('已完成 / 已作废 / 无截止 → 不进今日到期组', () => {
    expect(isTodoDueToday(done(at('2026-09-11T18:00:00')), todayStr)).toBe(false)
    expect(isTodoDueToday(voided(at('2026-09-11T18:00:00')), todayStr)).toBe(false)
    expect(isTodoDueToday(open(undefined), todayStr)).toBe(false)
  })
})

describe('③ 并集恒等于「今天」口径（拆分不改总量，只改呈现）', () => {
  const rows: Row[] = [
    open(at('2026-09-10T09:00:00')), // 逾期（昨天）
    open(at('2026-09-11T09:00:00')), // 逾期（今天已过点）
    open(at('2026-09-11T18:00:00')), // 今日到期（未到点）
    open(at('2026-09-12T09:00:00')), // 明天
    open(undefined), // 无截止
    done(at('2026-09-11T09:00:00')), // 已完成
    voided(at('2026-09-11T09:00:00')), // 已作废
  ]

  it('isDueToday = isTodoDueToday ∪ isTodoOverdue，且两组不相交', () => {
    for (const t of rows) {
      const due = isTodoDueToday(t, todayStr)
      const over = isTodoOverdue(t, now)
      // 互斥：同一条待办不可能同时出现在两列（否则首页计数翻倍）
      expect(due && over).toBe(false)
      // 并集等价：拆成两列后「今天」总量不变
      expect(due || over).toBe(isDueToday(t, todayStr))
    }
  })

  it('全量复算：今天口径 3 条 = 逾期 2 条 + 今日到期 1 条', () => {
    expect(rows.filter((t) => isDueToday(t, todayStr))).toHaveLength(3)
    expect(rows.filter((t) => isTodoOverdue(t, now))).toHaveLength(2)
    expect(rows.filter((t) => isTodoDueToday(t, todayStr))).toHaveLength(1)
  })
})

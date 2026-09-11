/**
 * 「今日到期 / 逾期」分组口径回归（Issue #134 四轮；五轮改为按天口径）
 *
 * 背景：工作台「今日待办日程」与待办中心此前把两类条目混在一列（`isDueToday` = 今日到期 ∪ 逾期）。
 * 逾期条目最需要被看见，却会被「今天还没到点」的条目稀释；指标卡同样只给一个总数。
 * 四轮把它们拆成两个**互斥**分组，故口径必须锁死：
 *   ① 逾期按**天**判定：截止日是今天之前的一个自然日才算逾期（今天 09:00 的待办，
 *      当天下午仍未完成**不算逾期**——当天钟点过了仍在「今日到期」里按计划推进）；
 *   ② 今日到期 = 未完成 + 截止落在今天（含今日已过点条目），不含逾期；
 *   ③ 两者并集恒等于 isDueToday（拆分不改变「今天」总量，只改变呈现粒度）；
 *   ④ 已完成 / 已作废 / 无截止 / 明天到期 一律不进任何一组（三态口径 + 不催办）。
 *   ⑤ overdueDays：今天 - 截止日，按自然日差，恒 >= 1（仅对逾期条目有意义）。
 */
import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import type { Todo } from '@/db/types'
import { isDueToday, isTodoDueToday, isTodoOverdue, overdueDays } from '../domain'

type Row = Pick<Todo, 'status' | 'dueAt'>

const todayStr = '2026-09-11'
const at = (s: string): number => dayjs(s).valueOf()

const open = (dueAt?: number): Row => ({ status: 'todo', dueAt })
const done = (dueAt?: number): Row => ({ status: 'done', dueAt })
const voided = (dueAt?: number): Row => ({ status: 'voided', dueAt })

describe('① 逾期按天判定（不是按时刻）', () => {
  it('今天 09:00 到期 → 未逾期（当天钟点过了不算跨天欠账）', () => {
    expect(isTodoOverdue(open(at('2026-09-11T09:00:00')), todayStr)).toBe(false)
  })

  it('今天 18:00 到期 → 未逾期', () => {
    expect(isTodoOverdue(open(at('2026-09-11T18:00:00')), todayStr)).toBe(false)
  })

  it('昨天 23:59 到期 → 已逾期（跨天即逾期，与具体钟点无关）', () => {
    expect(isTodoOverdue(open(at('2026-09-10T23:59:00')), todayStr)).toBe(true)
  })

  it('前天到期 → 已逾期', () => {
    expect(isTodoOverdue(open(at('2026-09-09T09:00:00')), todayStr)).toBe(true)
  })

  it('已完成 / 已作废 / 无截止时间 → 一律不算逾期（不催办终态与无期限条目）', () => {
    expect(isTodoOverdue(done(at('2026-09-01T09:00:00')), todayStr)).toBe(false)
    expect(isTodoOverdue(voided(at('2026-09-01T09:00:00')), todayStr)).toBe(false)
    expect(isTodoOverdue(open(undefined), todayStr)).toBe(false)
  })
})

describe('② 今日到期：未完成 + 截止落在今天（含今日已过点）', () => {
  it('今天 18:00 到期（未到点）→ 今日到期', () => {
    expect(isTodoDueToday(open(at('2026-09-11T18:00:00')), todayStr)).toBe(true)
  })

  it('今天 09:00 到期（已过点）→ 仍是今日到期，不算逾期，两组互斥', () => {
    const t = open(at('2026-09-11T09:00:00'))
    expect(isTodoDueToday(t, todayStr)).toBe(true)
    expect(isTodoOverdue(t, todayStr)).toBe(false)
  })

  it('昨天到期 → 不算今日到期，归逾期组', () => {
    const t = open(at('2026-09-10T09:00:00'))
    expect(isTodoDueToday(t, todayStr)).toBe(false)
    expect(isTodoOverdue(t, todayStr)).toBe(true)
  })

  it('明天到期 → 既非今日到期也非逾期', () => {
    const t = open(at('2026-09-12T09:00:00'))
    expect(isTodoDueToday(t, todayStr)).toBe(false)
    expect(isTodoOverdue(t, todayStr)).toBe(false)
  })

  it('已完成 / 已作废 / 无截止 → 不进今日到期组', () => {
    expect(isTodoDueToday(done(at('2026-09-11T18:00:00')), todayStr)).toBe(false)
    expect(isTodoDueToday(voided(at('2026-09-11T18:00:00')), todayStr)).toBe(false)
    expect(isTodoDueToday(open(undefined), todayStr)).toBe(false)
  })
})

describe('③ 并集恒等于「今天」口径（拆分不改总量，只改呈现）', () => {
  const rows: Row[] = [
    open(at('2026-09-09T09:00:00')), // 逾期（前天）
    open(at('2026-09-10T23:59:00')), // 逾期（昨天）
    open(at('2026-09-11T09:00:00')), // 今日到期（已过点）
    open(at('2026-09-11T18:00:00')), // 今日到期（未到点）
    open(at('2026-09-12T09:00:00')), // 明天
    open(undefined), // 无截止
    done(at('2026-09-11T09:00:00')), // 已完成
    voided(at('2026-09-11T09:00:00')), // 已作废
  ]

  it('isDueToday = isTodoDueToday ∪ isTodoOverdue，且两组不相交', () => {
    for (const t of rows) {
      const due = isTodoDueToday(t, todayStr)
      const over = isTodoOverdue(t, todayStr)
      // 互斥：同一条待办不可能同时出现在两列（否则首页计数翻倍）
      expect(due && over).toBe(false)
      // 并集等价：拆成两列后「今天」总量不变
      expect(due || over).toBe(isDueToday(t, todayStr))
    }
  })

  it('全量复算：今天口径 4 条 = 逾期 2 条 + 今日到期 2 条', () => {
    expect(rows.filter((t) => isDueToday(t, todayStr))).toHaveLength(4)
    expect(rows.filter((t) => isTodoOverdue(t, todayStr))).toHaveLength(2)
    expect(rows.filter((t) => isTodoDueToday(t, todayStr))).toHaveLength(2)
  })
})

describe('④ overdueDays：按自然日差（恒 >= 1）', () => {
  it('昨天到期 → 逾期 1 天', () => {
    expect(overdueDays(open(at('2026-09-10T23:59:00')), todayStr)).toBe(1)
  })

  it('前天到期 → 逾期 2 天', () => {
    expect(overdueDays(open(at('2026-09-09T00:10:00')), todayStr)).toBe(2)
  })

  it('10 天前到期 → 逾期 10 天', () => {
    expect(overdueDays(open(at('2026-09-01T09:00:00')), todayStr)).toBe(10)
  })

  it('未逾期（今天/明天/无截止/终态）→ 0', () => {
    expect(overdueDays(open(at('2026-09-11T09:00:00')), todayStr)).toBe(0)
    expect(overdueDays(open(at('2026-09-12T09:00:00')), todayStr)).toBe(0)
    expect(overdueDays(open(undefined), todayStr)).toBe(0)
    expect(overdueDays(done(at('2026-09-01T09:00:00')), todayStr)).toBe(0)
  })
})

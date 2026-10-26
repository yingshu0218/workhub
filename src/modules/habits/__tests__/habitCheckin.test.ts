/**
 * 习惯打卡收口（`repositories/index.ts#checkinHabit / uncheckHabit`）—— 习惯模块的行为锁。
 *
 * 为什么补（2026-10-26 审计）：`modules/habits` 此前**零专属测试**，而打卡是「一键操作 + 跨模块联动」
 * （热力图、连击、奖杯引擎都吃它）。收口前这套逻辑在 3 处内联重复（HabitsPage / HabitLoopCard /
 * 专注联动），幂等与事件口径全靠各自记得写对 —— 正是本仓最忌讳的漂移形态。
 *
 * 锁住的四条不变量：
 * ① **确定性 id**：同日同习惯恒为 `hl-{habitId}-{date}`（幂等的基础，杜绝重复打卡）
 * ② **重复打卡是空操作**：返回 `{created:false}` 且**不发事件**（否则奖杯会被重复评估）
 * ③ **事件在事务之后**：监听器触发时记录**已可读**（§6.1 硬纪律）
 * ④ **取消→再打卡要复活同一条**：不是新建第二条，也不是静默失败（幽灵记录）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { checkinHabit, uncheckHabit, habitLogId } from '@/repositories'
import { eventBus, type AppEvent } from '@/shared/eventBus'

type Captured = { event: keyof AppEvent; payload: unknown }

/** 捕获事件（与 agent/__tests__/eventSink.test.ts 同一手法，不改生产代码） */
function capture(): { events: Captured[]; restore: () => void } {
  const events: Captured[] = []
  const orig = eventBus.emit.bind(eventBus)
  eventBus.emit = (event: keyof AppEvent, payload: unknown) => {
    events.push({ event, payload })
    ;(orig as unknown as (e: keyof AppEvent, p: unknown) => void)(event, payload)
  }
  return { events, restore: () => { eventBus.emit = orig } }
}

const HABIT = 'h-run'
const DATE = '2026-10-26'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('checkinHabit / uncheckHabit', () => {
  it('① 落到确定性 id（同日同习惯只可能有一条）', async () => {
    const res = await checkinHabit(HABIT, DATE, { evidence: '专注联动' })
    expect(res).toEqual({ created: true })

    const rec = await db.habitLogs.get(habitLogId(HABIT, DATE))
    expect(rec).toBeTruthy()
    expect(rec?.habitId).toBe(HABIT)
    expect(rec?.date).toBe(DATE)
    expect(rec?.deleted).toBe(0)
    expect(rec?.completedAt).toBeGreaterThan(0)
    expect(rec?.evidence).toBe('专注联动')
  })

  it('② 重复打卡是空操作：不再落库、不再发事件', async () => {
    await checkinHabit(HABIT, DATE)
    const c = capture()
    try {
      const second = await checkinHabit(HABIT, DATE)
      expect(second).toEqual({ created: false })
      expect(c.events).toEqual([])
      expect(await db.habitLogs.count()).toBe(1)
    } finally {
      c.restore()
    }
  })

  it('③ 事件在事务之后：监听时记录已可读（§6.1）', async () => {
    const readableAtEmit: Array<Promise<{ deleted?: number } | undefined>> = []
    const off = eventBus.on('habit:checked', ({ habitId, date }) => {
      // 同步发起读库 —— 若 emit 在事务 commit 之前，这里会读到 undefined / 旧值
      readableAtEmit.push(db.habitLogs.get(habitLogId(habitId, date)))
    })
    try {
      await checkinHabit(HABIT, DATE)
    } finally {
      off()
    }
    expect(readableAtEmit).toHaveLength(1)
    const rec = await readableAtEmit[0]
    expect(rec?.deleted).toBe(0)
  })

  it('④ 取消打卡：软删同一条，且不发 habit:checked', async () => {
    await checkinHabit(HABIT, DATE)
    const c = capture()
    try {
      await uncheckHabit(HABIT, DATE)
      expect(c.events).toEqual([])
    } finally {
      c.restore()
    }
    const rec = await db.habitLogs.get(habitLogId(HABIT, DATE))
    expect(rec?.deleted).toBe(1) // 墓碑仍在（可恢复语义）
    expect(await db.habitLogs.count()).toBe(1) // 没有第二条
  })

  it('⑤ 取消后重新打卡：复活同一条（不新增、不静默失败）', async () => {
    await checkinHabit(HABIT, DATE)
    await uncheckHabit(HABIT, DATE)

    const c = capture()
    let again: { created: boolean }
    try {
      again = await checkinHabit(HABIT, DATE)
      expect(c.events.map((e) => e.event)).toEqual(['habit:checked'])
    } finally {
      c.restore()
    }
    expect(again.created).toBe(true)

    const rec = await db.habitLogs.get(habitLogId(HABIT, DATE))
    expect(rec?.deleted).toBe(0)
    expect(rec?.restoredAt).toBeTruthy() // 同步层允许复活的唯一凭证
    expect(await db.habitLogs.count()).toBe(1)
  })
})

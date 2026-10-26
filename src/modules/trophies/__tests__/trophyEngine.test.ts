/**
 * 奖杯引擎（`trophies/trophyEngine.ts` + `trophies/hooks.ts` 纯推导）—— 奖杯模块的行为锁。
 *
 * 为什么补（2026-10-26 审计）：`modules/trophies` 此前**零专属测试**，而它是「游戏化闭环」的兑现处
 * —— EXP 读数、等级、奖杯解锁全从这里出。算错不会崩，只会让用户看到错误的等级与永远不亮的奖杯。
 *
 * 锁住：
 * ① 统计口径（总量/单次最大值/多习惯取最长连击/计数一次到位）
 * ② EXP 与等级公式（含 expIntoLevel 的进位边界）
 * ③ 引擎解锁：达标才解锁、解锁即发事件、**事件时记录已可读**（§6.1）
 * ④ 幂等：已解锁不重复评估、不重复发事件（否则每来一个事件就重播解锁弹窗）
 * ⑤ 无条件奖杯（conditionType 缺省）不参与评估
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import dayjs from 'dayjs'
import { db } from '@/db/db'
import type { Customer, HabitLog, Transaction, Trophy } from '@/db/types'
import { trophyRepo } from '@/repositories'
import { eventBus, type AppEvent } from '@/shared/eventBus'
import { evaluateTrophies } from '../trophyEngine'
import {
  computeTrophyStats,
  computeConditionValue,
  deriveExp,
  deriveProfileSummary,
  EXP_PER_LEVEL,
} from '../hooks'

type Captured = { event: keyof AppEvent; payload: unknown }

function capture(): { events: Captured[]; restore: () => void } {
  const events: Captured[] = []
  const orig = eventBus.emit.bind(eventBus)
  eventBus.emit = (event: keyof AppEvent, payload: unknown) => {
    events.push({ event, payload })
    ;(orig as unknown as (e: keyof AppEvent, p: unknown) => void)(event, payload)
  }
  return { events, restore: () => { eventBus.emit = orig } }
}

const today = () => dayjs()
const dayAgo = (n: number) => today().subtract(n, 'day').format('YYYY-MM-DD')

function focusSession(id: string, minutes: number) {
  return { id, startedAt: 1, completedAt: 2, minutes } as never
}

function habitLog(habitId: string, date: string) {
  return { id: `hl-${habitId}-${date}`, habitId, date, completedAt: 1, deleted: 0 } as HabitLog
}

function trophy(id: string, patch: Partial<Trophy> = {}): Trophy {
  return {
    id,
    name: `奖杯 ${id}`,
    tier: '铜',
    rarity: '50%',
    description: '测试奖杯',
    icon: 'emoji_events',
    updatedAt: 0,
    rev: 0,
    deleted: 0,
    ...patch,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('统计口径（computeTrophyStats）', () => {
  it('专注取总和与单次最大值；打卡取总数与「多习惯里最长的那条」连击', () => {
    const stats = computeTrophyStats({
      focusSessions: [focusSession('f1', 30), focusSession('f2', 45)] as never,
      // 习惯 A 连续 3 天，习惯 B 只有 1 天 —— 取最长（3），不是两条相加
      habitLogs: [
        habitLog('hA', dayAgo(0)),
        habitLog('hA', dayAgo(1)),
        habitLog('hA', dayAgo(2)),
        habitLog('hB', dayAgo(0)),
      ],
      transactions: [{ id: 't1' }, { id: 't2' }] as Transaction[],
      customers: [{ id: 'c1' }] as Customer[],
    })

    expect(stats.focusMinutesTotal).toBe(75)
    expect(stats.focusOnceMinutes).toBe(45)
    expect(stats.habitChecksTotal).toBe(4)
    expect(stats.habitStreak).toBe(3)
    expect(stats.habitCurrentStreak).toBe(3)
    expect(stats.transactionsTotal).toBe(2)
    expect(stats.customersTotal).toBe(1)
  })

  it('空数据全 0（不是 NaN）', () => {
    const stats = computeTrophyStats({
      focusSessions: [],
      habitLogs: [],
      transactions: [],
      customers: [],
    })
    expect(Object.values(stats).every((v) => v === 0)).toBe(true)
  })

  it('条件类型 → 统计字段映射；未知/缺省条件返回 0', () => {
    const stats = computeTrophyStats({
      focusSessions: [focusSession('f1', 42)] as never,
      habitLogs: [],
      transactions: [],
      customers: [],
    })
    expect(computeConditionValue('focus_once_minutes', stats)).toBe(42)
    expect(computeConditionValue('focus_minutes_total', stats)).toBe(42)
    expect(computeConditionValue(undefined, stats)).toBe(0)
  })
})

describe('EXP 与等级（deriveExp / deriveProfileSummary）', () => {
  const stats = computeTrophyStats({
    focusSessions: [focusSession('f1', 30), focusSession('f2', 45)] as never, // 75 分钟
    habitLogs: [habitLog('h1', dayAgo(0)), habitLog('h1', dayAgo(1)), habitLog('h1', dayAgo(2)), habitLog('h2', dayAgo(0))],
    transactions: [],
    customers: [],
  })

  it('公式 = 专注分钟×2 + 打卡×10 + 已解锁奖杯×50', () => {
    expect(deriveExp(stats, 0)).toBe(75 * 2 + 4 * 10)
    expect(deriveExp(stats, 2)).toBe(75 * 2 + 4 * 10 + 2 * 50)
  })

  it('等级按 EXP_PER_LEVEL 进位，expIntoLevel 是余数（升满一级归零）', () => {
    const two = [trophy('a', { unlockedAt: 1 }), trophy('b', { unlockedAt: 2 }), trophy('c')]
    const s = deriveProfileSummary(stats, two)
    expect(s.unlockedTrophies).toBe(2)
    expect(s.totalTrophies).toBe(3)
    expect(s.exp).toBe(290)
    expect(s.level).toBe(Math.floor(290 / EXP_PER_LEVEL))
    expect(s.expIntoLevel).toBe(290 % EXP_PER_LEVEL)

    // 精确整除时不出现「99 → 0 却仍是旧等级」的错位
    const exact = { ...stats, focusMinutesTotal: 50 }
    const edge = deriveProfileSummary(exact, [])
    expect(edge.exp).toBe(100 + 4 * 10)
    expect(edge.expIntoLevel).toBe(40)
  })
})

describe('引擎解锁（evaluateTrophies）', () => {
  it('达标即解锁并发事件；事件触发时记录已可读（§6.1）', async () => {
    await db.focusSessions.put(focusSession('f1', 90) as never)
    await trophyRepo.put(trophy('t-60', { conditionType: 'focus_minutes_total', conditionValue: 60 }))

    const readable: Array<Promise<Trophy | undefined>> = []
    const off = eventBus.on('trophy:unlocked', ({ trophyId }) => {
      readable.push(db.trophies.get(trophyId) as Promise<Trophy | undefined>)
    })
    const c = capture()
    try {
      await evaluateTrophies()
      expect(c.events.map((e) => e.event)).toEqual(['trophy:unlocked'])
    } finally {
      off()
      c.restore()
    }

    expect(readable).toHaveLength(1)
    const rec = await readable[0]
    expect(rec?.unlockedAt).toBeTruthy()
  })

  it('未达标不解锁、不发事件', async () => {
    await db.focusSessions.put(focusSession('f1', 10) as never)
    await trophyRepo.put(trophy('t-60', { conditionType: 'focus_minutes_total', conditionValue: 60 }))

    const c = capture()
    try {
      await evaluateTrophies()
      expect(c.events).toEqual([])
    } finally {
      c.restore()
    }
    const rec = await db.trophies.get('t-60')
    expect(rec?.unlockedAt).toBeUndefined()
  })

  it('幂等：已解锁的奖杯再评估不重复发事件、不改动 unlockedAt', async () => {
    await db.focusSessions.put(focusSession('f1', 90) as never)
    await trophyRepo.put(trophy('t-60', { conditionType: 'focus_minutes_total', conditionValue: 60 }))

    await evaluateTrophies()
    const first = (await db.trophies.get('t-60'))?.unlockedAt
    expect(first).toBeTruthy()

    const c = capture()
    try {
      await evaluateTrophies()
      expect(c.events).toEqual([])
    } finally {
      c.restore()
    }
    expect((await db.trophies.get('t-60'))?.unlockedAt).toBe(first)
  })

  it('无条件奖杯（conditionType 缺省）永不自动解锁', async () => {
    await db.focusSessions.put(focusSession('f1', 999) as never)
    await trophyRepo.put(trophy('t-manual'))

    await evaluateTrophies()
    expect((await db.trophies.get('t-manual'))?.unlockedAt).toBeUndefined()
  })
})

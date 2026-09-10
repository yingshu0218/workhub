/**
 * 领域命令层与 UI/AI 同源测试（P1 补强 · §2.1「一个业务动作一处实现」）
 *
 * 背景：第 2 步把**事件**收口到 repositories，但**动作编排**仍是 UI 与 AI 各一份。
 * 典型病灶是记账时间口径与缺省账本策略——两边各写一遍 `startOf('day')`，
 * 一旦一侧改了粒度，AI 记的账与手工记的账就出现字段级差异，
 * 而 §7.1 的验收恰恰要求两者载荷与落库结果逐字段一致。
 *
 * 本测试固定领域层的三件事：
 *   ① 记账时间口径唯一（normalizeOccurredAt）
 *   ② 缺省账本策略唯一（isDefault → 唯一 → 反问）
 *   ③ 默认账本唯一性收口（clearOtherDefaultLedgers 被 UI 与 AI 共用）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import dayjs from 'dayjs'
import { db } from '@/db/db'
import { normalizeOccurredAt, recordTransaction, resolveDefaultLedgerId, createLedger } from '@/domain'
import { clearOtherDefaultLedgers } from '@/repositories'
import { dispatchAgentTool } from '../executor'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function putLedger(id: string, name: string, isDefault = false) {
  await db.ledgers.put({
    id,
    name,
    currency: 'CNY',
    openingBalance: 0,
    closingCycle: '月结',
    sortOrder: 0,
    ...(isDefault ? { isDefault: true } : {}),
    createdAt: 1,
    updatedAt: 1,
    deleted: 0,
    rev: 1,
  } as never)
}

describe('记账时间口径唯一', () => {
  it('缺省=今天 00:00；传日期=该日 00:00（分钟秒毫秒全归零）', () => {
    expect(normalizeOccurredAt()).toBe(dayjs().startOf('day').valueOf())
    expect(normalizeOccurredAt('2026-03-05')).toBe(dayjs('2026-03-05').startOf('day').valueOf())
  })

  it('AI 记账与领域层记账落库的 occurredAt 完全一致', async () => {
    await putLedger('ldg:1', '默认', true)
    await dispatchAgentTool('fin_recordTransaction', {
      ledgerId: 'ldg:1',
      summary: 'AI 记的',
      amount: 10,
      occurredAt: '2026-03-05',
    })
    await recordTransaction({
      ledgerId: 'ldg:1',
      summary: 'UI 记的',
      amount: 20,
      type: 'expense',
      occurredAt: '2026-03-05',
    })
    const rows = await db.transactions.toArray()
    expect(rows).toHaveLength(2)
    const stamps = new Set(rows.map((r) => r.occurredAt))
    expect(stamps.size).toBe(1)
    expect([...stamps][0]).toBe(dayjs('2026-03-05').startOf('day').valueOf())
  })
})

describe('缺省账本策略：isDefault → 唯一 → 反问', () => {
  it('无账本 → 可操作错误「请先创建账本」', async () => {
    const r = await resolveDefaultLedgerId()
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('请先创建账本')
  })

  it('存在默认账本 → 用它', async () => {
    await putLedger('ldg:a', 'A')
    await putLedger('ldg:b', 'B', true)
    const r = await resolveDefaultLedgerId()
    expect(r).toEqual({ ok: true, ledgerId: 'ldg:b' })
  })

  it('无默认但仅一个账本 → 用它（不打扰用户）', async () => {
    await putLedger('ldg:only', '唯一')
    expect(await resolveDefaultLedgerId()).toEqual({ ok: true, ledgerId: 'ldg:only' })
  })

  it('多账本且无默认 → 反问（不猜）', async () => {
    await putLedger('ldg:a', 'A')
    await putLedger('ldg:b', 'B')
    const r = await resolveDefaultLedgerId()
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('未设置默认账本')
  })

  it('AI 不传 ledgerId 时走同一策略（多账本无默认 → 拒绝并提示）', async () => {
    await putLedger('ldg:a', 'A')
    await putLedger('ldg:b', 'B')
    const r = await dispatchAgentTool('fin_recordTransaction', { summary: 'x', amount: 1 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未设置默认账本')
  })
})

describe('默认账本唯一性收口（UI 与 AI 共用 clearOtherDefaultLedgers）', () => {
  it('clearOtherDefaultLedgers 只清非自身账本', async () => {
    await putLedger('ldg:a', 'A', true)
    await putLedger('ldg:b', 'B', true)
    await clearOtherDefaultLedgers('ldg:b')
    expect((await db.ledgers.get('ldg:a'))!.isDefault).toBeFalsy()
    expect((await db.ledgers.get('ldg:b'))!.isDefault).toBe(true)
  })

  it('createLedger(isDefault) 建完只剩一个默认账本', async () => {
    await putLedger('ldg:a', 'A', true)
    await createLedger({
      name: 'B',
      currency: 'CNY',
      openingBalance: 0,
      closingCycle: '月结',
      isDefault: true,
    })
    const defaults = (await db.ledgers.toArray()).filter((l) => !l.deleted && l.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].name).toBe('B')
  })

  it('AI fin_createLedger(isDefault) 与 UI 同口径（不产生双默认）', async () => {
    await putLedger('ldg:a', 'A', true)
    const r = await dispatchAgentTool('fin_createLedger', { name: 'B', isDefault: true })
    expect(r.ok).toBe(true)
    const defaults = (await db.ledgers.toArray()).filter((l) => !l.deleted && l.isDefault)
    expect(defaults).toHaveLength(1)
  })

  it('AI 记的账挂到默认账本上（缺省策略与 UI 一致）', async () => {
    await putLedger('ldg:a', 'A')
    await putLedger('ldg:b', 'B', true)
    const r = await dispatchAgentTool('fin_recordTransaction', { summary: 'x', amount: 1 })
    expect(r.ok).toBe(true)
    const txn = (await db.transactions.toArray())[0]
    expect(txn.ledgerId).toBe('ldg:b')
  })
})

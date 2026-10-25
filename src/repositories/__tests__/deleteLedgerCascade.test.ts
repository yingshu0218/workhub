// @vitest-environment jsdom
/**
 * 账本级联删除回归（T4 收口，2026-10-26）
 *
 * 此前账本删除走 `ledgerRepo.softDelete`（FinancePage 内联），没有 cascade 函数：
 * ① 「有流水的账本禁止删除」守卫只长在 UI 层，绕过 UI 的调用方会静默删掉带流水的账本
 *    —— 而流水.ledgerId 是强归属（恢复侧 pruneDeadRefs 对「所属账本已删除」抛错）；
 * ② 名下的 mention link（笔记 @账本）无人墓碑化，留下指向墓碑的活关联（幽灵纪律③）。
 *
 * `deleteLedgerCascade` 收口两条：守卫进数据层（抛可操作错误、事务回滚）；
 * mention link 随删除同事务墓碑化 + 快照 cascadeLinkIds 留档，恢复时复活。
 * 变异校验：拆掉守卫 → 「有流水删除」用例恰红；拆掉 cascadeSoftDeleteLinks → 快照恰空。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { deleteLedgerCascade } from '@/repositories'
import { restoreTrashRecord } from '@/repositories/trash'

const meta = (over: Record<string, unknown> = {}) => ({
  updatedAt: 100,
  deleted: 0 as const,
  rev: 1,
  ...over,
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('deleteLedgerCascade：守卫收口 + mention 级联', () => {
  it('① 有流水的账本拒绝删除（可操作错误，账本保持原状）', async () => {
    await db.ledgers.put({ id: 'l1', name: '主账本', currency: 'CNY', createdAt: 1, ...meta() } as never)
    await db.transactions.put(
      { id: 't1', ledgerId: 'l1', type: 'expense', amount: 100, summary: '打车', tags: [], status: '已结算', occurredAt: 1, createdAt: 1, ...meta() } as never,
    )

    await expect(deleteLedgerCascade('l1')).rejects.toThrow('下仍有 1 笔流水，无法删除')
    // 事务整体回滚：账本未被删、无墓碑
    expect((await db.ledgers.get('l1'))?.deleted).toBe(0)
  })

  it('② 空账本删除：mention link 墓碑化 + 快照留档；恢复后 link 复活', async () => {
    const { buildLinkId } = await import('@/repositories/linkId')
    await db.ledgers.put({ id: 'l1', name: '备用金', currency: 'CNY', createdAt: 1, ...meta() } as never)
    await db.notes.put({ id: 'n1', title: '纪要', markdown: '', tags: [], createdAt: 1, ...meta() } as never)
    const mentionId = buildLinkId({ type: 'notes', id: 'n1' }, { type: 'ledgers', id: 'l1' }, 'mention')
    await db.links.put(
      { id: mentionId, fromType: 'notes', fromId: 'n1', toType: 'ledgers', toId: 'l1', kind: 'mention', createdAt: 1, updatedAt: 0, rev: 0, deleted: 0 } as never,
    )

    await deleteLedgerCascade('l1')

    const tomb = (await db.ledgers.get('l1')) as unknown as Record<string, unknown>
    expect(tomb.deleted).toBe(1)
    // link 已墓碑化 + 快照精确留档（恢复路径 reviveCascadeLinks 凭它复活）
    expect((await db.links.get(mentionId))!.deleted).toBe(1)
    expect((tomb.trashSnapshot as { cascadeLinkIds: string[] }).cascadeLinkIds).toEqual([mentionId])

    const result = await restoreTrashRecord('ledgers', 'l1')
    expect(result.revivedCascadeLinks).toBe(1)
    expect((await db.links.get(mentionId))!.deleted).toBe(0)
    expect((await db.ledgers.get('l1'))?.deleted).toBe(0)
  })

  it('③ 账本不存在 / 已删：幂等静默', async () => {
    await expect(deleteLedgerCascade('nope')).resolves.toBeUndefined()
    await db.ledgers.put({ id: 'l1', name: 'X', currency: 'CNY', createdAt: 1, ...meta({ deleted: 1 }) } as never)
    await expect(deleteLedgerCascade('l1')).resolves.toBeUndefined()
  })
})

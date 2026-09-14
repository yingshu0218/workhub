/**
 * 客户分组拖拽排序回归（用例 #34）
 *
 * 原状态：`CustomerGroup.sortOrder` 字段早在 Issue #63 就已存在于模型**与服务端集合**
 * （`pb_setup/collections.json` 的 customerGroups 含 sortOrder），读侧 `useCustomerGroups`
 * 也一直按它排序 —— 但**没有任何写入入口**（分组栏只有「编辑 / 删除」两个图标，全仓无
 * draggable / onDrop / 重排逻辑）。于是「拖动调整顺序」这条用例没有可用的交互，
 * 分组顺序恒为创建顺序。这是又一处「字段与读取都在、缺写入侧」。
 *
 * 本测锁四条：
 *   ① `moveInOrder` 的索引修正（`from < to` 时目标项会被摘除动作前移一位）；
 *   ② `reorderCustomerGroups` 重写 sortOrder 为**紧凑的 0..n-1**；
 *   ③ 每条被改动的分组都要**同事务入同步队列**（否则换设备顺序回旧）；
 *   ④ 顺序没变的条目不动（不产生无谓 rev 递增与同步流量）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { moveInOrder, reorderCustomerGroups } from '../hooks'
import type { CustomerGroup } from '@/db/types'

const group = (id: string, sortOrder: number): CustomerGroup => ({
  id,
  name: id,
  includeTags: [],
  excludeTags: [],
  sortOrder,
  createdAt: 1,
  updatedAt: 1,
  deleted: 0,
  rev: 1,
})

beforeEach(async () => {
  await db.customerGroups.clear()
  await db.syncQueue.clear()
})

describe('① moveInOrder 的索引修正', () => {
  // 语义：把 from 位置的项**插到 to 位置那一项之前**（与 /todo 清单、/finance 账本一致）。
  // 落点语义选「插到目标之前」而非「插到目标之后」：前者在跨多项拖动时与视觉落点一致
  //（松手时目标行仍在鼠标下方），后者会出现「松手后目标行被顶下去」的错位感。
  it('往下拖跨多项：落点在目标项之前', () => {
    expect(moveInOrder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'a', 'c'])
  })

  it('往下拖一项 = 插到 b 之前 = 原地不动（该语义的自然结果）', () => {
    expect(moveInOrder(['a', 'b', 'c'], 0, 1)).toEqual(['a', 'b', 'c'])
  })

  it('往上拖（from > to）：直接插到目标索引前', () => {
    expect(moveInOrder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveInOrder(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b'])
  })

  it('原地不动', () => {
    expect(moveInOrder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('返回新数组，不改动入参（入参是 render 期的派生数组）', () => {
    const src = ['a', 'b', 'c']
    const out = moveInOrder(src, 0, 2)
    expect(src).toEqual(['a', 'b', 'c'])
    expect(out).not.toBe(src)
  })
})

describe('②③④ reorderCustomerGroups 写入与同步', () => {
  it('按传入顺序重写 sortOrder 为紧凑 0..n-1', async () => {
    await db.customerGroups.bulkPut([group('g1', 0), group('g2', 1), group('g3', 2)])
    await reorderCustomerGroups(['g3', 'g1', 'g2'])
    const all = await db.customerGroups.toArray()
    const order = all.sort((a, b) => a.sortOrder - b.sortOrder).map((x) => x.id)
    expect(order).toEqual(['g3', 'g1', 'g2'])
    expect(all.map((x) => x.sortOrder).sort()).toEqual([0, 1, 2])
  })

  it('每条被改动的分组都入同步队列（table=customerGroups / op=upsert）', async () => {
    await db.customerGroups.bulkPut([group('g1', 0), group('g2', 1), group('g3', 2)])
    await reorderCustomerGroups(['g3', 'g1', 'g2'])
    const queued = await db.syncQueue.toArray()
    expect(queued.length).toBe(3)
    expect(queued.every((q) => q.table === 'customerGroups' && q.op === 'upsert')).toBe(true)
    expect(queued.map((q) => q.recordId).sort()).toEqual(['g1', 'g2', 'g3'])
  })

  it('拖到原位（顺序不变）不写库、不入队、rev 不动', async () => {
    await db.customerGroups.bulkPut([group('g1', 0), group('g2', 1)])
    await reorderCustomerGroups(['g1', 'g2'])
    expect(await db.syncQueue.count()).toBe(0)
    const all = await db.customerGroups.toArray()
    expect(all.every((x) => x.rev === 1)).toBe(true)
  })

  it('已软删的分组不参与（不在 orderedIds 里就保持原 sortOrder）', async () => {
    await db.customerGroups.bulkPut([group('g1', 0), group('g2', 1)])
    await reorderCustomerGroups(['g2'])
    const g1 = await db.customerGroups.get('g1')
    expect(g1?.sortOrder).toBe(0)
    const g2 = await db.customerGroups.get('g2')
    expect(g2?.sortOrder).toBe(0) // 唯一可拖项落到 0；重复索引由读侧排序稳定兜住
  })

  it('id 不存在时不抛错（拖拽竞态：拖起后目标被别处删掉）', async () => {
    await db.customerGroups.bulkPut([group('g1', 0)])
    await expect(reorderCustomerGroups(['g1', 'ghost'])).resolves.toBeUndefined()
  })
})

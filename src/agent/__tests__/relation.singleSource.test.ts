/**
 * 客户关系写入单一来源回归（审计整改）
 *
 * 背景：`crm_addRelation` 此前**手写** `db.customers.update` + `db.syncQueue.add`，
 * 与 UI 的 `customerRepo.put` 形成两套盖章/入队实现，且**漏了 `syncEngine.requestSync()`**
 * ——落库后不会立即触发推送，只能等 30s 心跳，表现为「AI 建的关系在别的设备上迟迟不出现」。
 * 现收口到 `repositories.addCustomerRelation`，UI 与 agentOps 共用同一实现。
 *
 * 本测试锁死三条：
 *   ① 双向落两侧（A/B 各一条，B 反向指回 A）；
 *   ② 幂等：同 目标+语义 重复调用不重复写（deduped=true，两侧条数不变）；
 *   ③ 落库即入同步队列（每条客户各一条 upsert），证明走的是仓储层而非裸写。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { crm_createCustomer, crm_addRelation } from '../executor'
import { syncEngine } from '@/sync/engine'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function mkCustomer(name: string): Promise<string> {
  const r = await crm_createCustomer({ name })
  expect(r.ok, r.error).toBe(true)
  return (r.data as { customerId: string }).customerId
}

describe('客户关系写入：单一来源 + 双向 + 幂等 + 入队', () => {
  it('① 双向落两侧（B 侧反向指回 A）', async () => {
    const a = await mkCustomer('关系甲')
    const b = await mkCustomer('关系乙')
    const r = await crm_addRelation({ customerId: a, targetId: b, label: '转介绍人' })
    expect(r.ok, r.error).toBe(true)

    const ca = await db.customers.get(a)
    const cb = await db.customers.get(b)
    expect(ca?.relations).toHaveLength(1)
    expect(cb?.relations).toHaveLength(1)
    expect(ca?.relations?.[0].targetId).toBe(b)
    expect(cb?.relations?.[0].targetId).toBe(a)
  })

  it('② 幂等：同 目标+语义 重复调用不重复写，deduped=true', async () => {
    const a = await mkCustomer('幂等甲')
    const b = await mkCustomer('幂等乙')
    const first = await crm_addRelation({ customerId: a, targetId: b, label: '同一公司' })
    expect(first.ok, first.error).toBe(true)
    expect((first.data as { deduped: boolean }).deduped).toBeFalsy()

    const second = await crm_addRelation({ customerId: a, targetId: b, label: '同一公司' })
    expect(second.ok, second.error).toBe(true)
    expect((second.data as { deduped: boolean }).deduped).toBe(true)

    // 两侧都不因重复调用而多写
    expect((await db.customers.get(a))?.relations).toHaveLength(1)
    expect((await db.customers.get(b))?.relations).toHaveLength(1)
  })

  it('③ 落库即入同步队列（走仓储层，非裸写）', async () => {
    const a = await mkCustomer('入队甲')
    const b = await mkCustomer('入队乙')
    // 清掉建档产生的队列，只看本次关系写入
    await db.syncQueue.clear()
    const spy = vi.spyOn(syncEngine, 'requestSync').mockImplementation(() => {})

    const r = await crm_addRelation({ customerId: a, targetId: b, label: '上下游' })
    expect(r.ok, r.error).toBe(true)

    const queued = await db.syncQueue.where('table').equals('customers').toArray()
    const ids = queued.map((q) => q.recordId).sort()
    expect(ids).toEqual([a, b].sort())
    // 关键：必须触发同步（此前裸写实现漏掉这一步，只能等 30s 心跳）
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('④ 与自身建立关系被拒', async () => {
    const a = await mkCustomer('自环')
    const r = await crm_addRelation({ customerId: a, targetId: a, label: '转介绍人' })
    expect(r.ok).toBe(false)
  })
})

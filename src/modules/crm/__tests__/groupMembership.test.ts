// @vitest-environment jsdom
/**
 * Phase 3 集合层 · customers 族（v16）：手动分组归属 → kind='member' link
 *
 * docs/集合层设计方案-20261026.md 裁决 B/C 的语义锁（customers 特化面）：
 * 1. setCustomerGroup：member link 落库（确定性 id）、幽灵分组抛错回滚、幽灵客户静默；
 * 2. 单选 diff：换组 = 旧 link 墓碑化 + 新 link 建立；undefined = 移出（回「全部客户」）；
 * 3. rule 组不落 member（裁决 C）—— deleteCustomerGroup 对 rule 组的清扫是 no-op，
 *    对 manual 组统一墓碑化 + 快照留档；恢复按两端存活复活；
 * 4. customerInGroup 双轨判定：manual 看 manualGroupId 注入、rule 看标签（dragToGroup.test.ts）。
 * 变异校验：拆 syncMemberLinks 旧 link 墓碑化 → ② 恰红（C1 已验，本文件复用同一原语）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { setCustomerGroup, createCustomerWithInit } from '@/repositories'
import { createCustomerGroup, deleteCustomerGroup } from '../hooks'
import { restoreTrashRecord } from '@/repositories/trash'
import { buildLinkId } from '@/repositories/linkId'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

const baseCustomer = (id: string) => ({
  id,
  name: `客户 ${id}`,
  company: '',
  tags: [] as string[],
  relations: [],
  createdAt: 1,
  updatedAt: 1,
  deleted: 0 as const,
  rev: 1,
})

async function memberLinksOf(customerId: string) {
  return db.links
    .filter(
      (l) =>
        l.kind === 'member' && l.fromType === 'customers' && l.fromId === customerId,
    )
    .toArray()
}

describe('手动分组归属（member link）', () => {
  it('① 拖入手动组：member link 落库（确定性 id）；客户行不持 groupId 字段', async () => {
    const group = await createCustomerGroup({ name: '重点', kind: 'manual' })
    await createCustomerWithInit(baseCustomer('c1') as never, {})

    await setCustomerGroup('c1', group.id)

    const links = await memberLinksOf('c1')
    expect(links).toHaveLength(1)
    expect(links[0].toType).toBe('customerGroups')
    expect(links[0].toId).toBe(group.id)
    expect(links[0].id).toBe(
      buildLinkId(
        { type: 'customers', id: 'c1' },
        { type: 'customerGroups', id: group.id },
        'member',
      ),
    )
    expect(await db.customers.get('c1')).not.toHaveProperty('groupId')
  })

  it('② 换组 = 旧 link 墓碑化 + 新 link 建立；undefined = 移出', async () => {
    const m1 = await createCustomerGroup({ name: 'M1', kind: 'manual' })
    const m2 = await createCustomerGroup({ name: 'M2', kind: 'manual' })
    await createCustomerWithInit(baseCustomer('c1') as never, {})
    await setCustomerGroup('c1', m1.id)

    await setCustomerGroup('c1', m2.id)
    let links = await memberLinksOf('c1')
    expect(links.find((l) => l.toId === m1.id)!.deleted).toBe(1)
    expect(links.find((l) => l.toId === m2.id)!.deleted).toBe(0)

    await setCustomerGroup('c1', undefined)
    links = await memberLinksOf('c1')
    expect(links.find((l) => l.toId === m2.id)!.deleted).toBe(1)
  })

  it('③ 幽灵分组抛错回滚；幽灵客户静默', async () => {
    await createCustomerWithInit(baseCustomer('c1') as never, {})
    await expect(setCustomerGroup('c1', 'ghost')).rejects.toThrow('目标容器已不存在')
    expect(await memberLinksOf('c1')).toHaveLength(0)
    await expect(setCustomerGroup('nope', 'ghost')).resolves.toBeUndefined()
  })
})

describe('删除分组（v2 级联）与恢复', () => {
  it('④ 删 manual 组：成员 link 墓碑化 + 快照留档、客户行不动；恢复按两端存活复活', async () => {
    const group = await createCustomerGroup({ name: '重点', kind: 'manual' })
    await createCustomerWithInit(baseCustomer('c1') as never, {})
    await createCustomerWithInit(baseCustomer('c2') as never, {})
    await setCustomerGroup('c1', group.id)
    await setCustomerGroup('c2', group.id)
    const { deleteCustomerCascade } = await import('@/repositories')
    await deleteCustomerCascade('c2') // c2 的 member link 先被其自身级联墓碑化

    await deleteCustomerGroup(group.id)
    const liveLinks = (await memberLinksOf('c1')).filter((l) => !l.deleted)
    expect(liveLinks).toHaveLength(0)
    const tomb = (await db.customerGroups.get(group.id)) as unknown as {
      trashSnapshot: { cascadeLinkIds: string[] }
    }
    expect(tomb.trashSnapshot.cascadeLinkIds).toHaveLength(1) // 只含本次墓碑化的 c1 link

    const result = await restoreTrashRecord('customerGroups', group.id)
    expect(result.revivedCascadeLinks).toBe(1)
    expect((await memberLinksOf('c1')).every((l) => !l.deleted)).toBe(true)
    // c2 的 link 保持墓碑（客户本身仍删着）
    expect((await memberLinksOf('c2')).every((l) => l.deleted)).toBe(true)
  })

  it('⑤ rule 组删除：member 清扫 no-op（裁决 C：rule 组无存储成员）', async () => {
    const group = await createCustomerGroup({ name: '规则组', includeTags: ['重点'] })
    await createCustomerWithInit(baseCustomer('c1') as never, {})
    await setCustomerGroup('c1', undefined) // no-op 边界
    await deleteCustomerGroup(group.id)
    expect(await memberLinksOf('c1')).toHaveLength(0)
  })
})

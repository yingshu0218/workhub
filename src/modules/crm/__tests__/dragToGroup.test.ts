import { describe, expect, it } from 'vitest'
import { tagsForGroupJoin } from '../shared'
import { customerInGroup, matchGroup, type Customer, type CustomerGroup } from '@/db/types'

/**
 * 客户拖入分组（2026-10-16 拖拽功能）：分组是标签规则组，「拖入」= 补齐缺失的 includeTags。
 * 纯函数锁 + matchGroup 联动锁（补齐后客户确实命中分组）。
 */
describe('tagsForGroupJoin：拖入分组的标签补齐', () => {
  const group = (includeTags: string[]): CustomerGroup =>
    ({
      id: 'g1',
      name: '重点',
      includeTags,
      excludeTags: [],
      sortOrder: 1,
      createdAt: 0,
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    })

  it('补齐缺失标签：原标签在前、新增在后', () => {
    expect(tagsForGroupJoin(['老客户'], ['重点', '制造业'])).toEqual(['老客户', '重点', '制造业'])
  })

  it('已命中全部条件：返回 null（拖入无操作）', () => {
    expect(tagsForGroupJoin(['重点', '制造业'], ['重点', '制造业'])).toBeNull()
  })

  it('联动 matchGroup：补齐后的 tags 确实命中分组（AND 语义）', () => {
    const g = group(['重点', '制造业'])
    const before: Pick<Customer, 'tags'> = { tags: ['老客户'] }
    expect(matchGroup(before, g)).toBe(false)
    const merged = tagsForGroupJoin(before.tags, g.includeTags)!
    expect(matchGroup({ tags: merged }, g)).toBe(true)
  })

  it('重复标签不产生重复项', () => {
    expect(tagsForGroupJoin(['重点'], ['重点'])).toBeNull()
  })
})

describe('customerInGroup：双模式分组归属统一口径（2026-10-17）', () => {
  const manual = (id: string): CustomerGroup =>
    ({
      id,
      name: id,
      kind: 'manual',
      includeTags: [],
      excludeTags: [],
      sortOrder: 1,
      createdAt: 0,
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    })

  it('手动组：看 groupId 单选（不看标签）', () => {
    expect(customerInGroup({ groupId: 'm1', tags: [] }, manual('m1'))).toBe(true)
    expect(customerInGroup({ groupId: 'other', tags: [] }, manual('m1'))).toBe(false)
  })

  it('规则组：看标签匹配（不看 groupId）；kind 缺省按 rule 处理（存量兼容）', () => {
    const rule = {
      id: 'r1',
      includeTags: ['重点'],
      excludeTags: [],
    } as unknown as CustomerGroup
    const ruleNoKind = { ...rule } // 无 kind 字段 = 存量数据
    expect(customerInGroup({ groupId: 'm1', tags: ['重点'] }, rule)).toBe(true)
    expect(customerInGroup({ groupId: 'm1', tags: [] }, rule)).toBe(false)
    expect(customerInGroup({ tags: ['重点'] }, ruleNoKind)).toBe(true)
  })

  it('拖入手动组 = groupId 覆盖（单选：自动离开旧手动组）', () => {
    expect(customerInGroup({ groupId: 'm1', tags: [] }, manual('m1'))).toBe(true)
    expect(customerInGroup({ groupId: 'm1', tags: [] }, manual('m2'))).toBe(false)
    // 拖入 m2 后（groupId 覆盖为 m2）：离开 m1、加入 m2
    expect(customerInGroup({ groupId: 'm2', tags: [] }, manual('m1'))).toBe(false)
    expect(customerInGroup({ groupId: 'm2', tags: [] }, manual('m2'))).toBe(true)
  })
})

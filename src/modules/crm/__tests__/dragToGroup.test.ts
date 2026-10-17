import { describe, expect, it } from 'vitest'
import { tagsForGroupJoin } from '../shared'
import { matchGroup, type Customer, type CustomerGroup } from '@/db/types'

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

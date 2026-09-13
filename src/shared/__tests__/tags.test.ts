/**
 * 标签归一化单源 + 分组匹配折叠（功能测试 #32 整改）
 *
 * 背景：`normalizeTags`（CRM）与 `parseTagInput`（控件）是两份几乎相同的实现，
 * 都只做 trim + 去首 `#`、不折大小写 → 「VIP / vip / #VIP」被当成不同标签：
 * 配组时小写写法匹配不上，标签栏还会并存两枚看起来一样的芯片。
 *
 * 本组用例锁三件事：
 *   ① `@/shared/tags` 是标签语义的唯一实现（折叠口径一致）
 *   ② 中文标签与原有顺序不受影响（折叠只对大小写生效）
 *   ③ `matchGroup` 两侧都过 `tagKey` —— 存量未收敛的数据也能正确圈人
 */
import { describe, it, expect } from 'vitest'
import { tagKey, normalizeTags, canonicalTags } from '../tags'
import { matchGroup } from '@/db/types'
import type { Customer, CustomerGroup } from '@/db/types'

const group = (over: Partial<CustomerGroup>): CustomerGroup =>
  ({
    id: 'g1',
    name: '重点客户',
    includeTags: [],
    excludeTags: [],
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
    ...over,
  }) as CustomerGroup

describe('标签归一化（@/shared/tags 单源）', () => {
  it('tagKey 折叠大小写与 # 前缀', () => {
    expect(tagKey(' VIP ')).toBe('vip')
    expect(tagKey('#VIP')).toBe('vip')
    expect(tagKey('vip')).toBe('vip')
    expect(tagKey('VIP')).toBe('vip')
  })

  it('tagKey 对中文标签是恒等操作', () => {
    expect(tagKey(' 华东 ')).toBe('华东')
    expect(tagKey('转介绍')).toBe('转介绍')
  })

  it('normalizeTags：四种写法归一为同一枚（用例 #32 的核心预期）', () => {
    expect(normalizeTags('VIP, #VIP, vip,  VIP ')).toEqual(['vip'])
  })

  it('normalizeTags：中文标签保持原样与顺序', () => {
    expect(normalizeTags('华东, 转介绍, 华东')).toEqual(['华东', '转介绍'])
  })

  it('canonicalTags：数组入口同样折叠去重（客户表单保存路径用）', () => {
    expect(canonicalTags(['VIP', 'vip', '#VIP', '华东'])).toEqual(['vip', '华东'])
  })
})

describe('matchGroup 折叠匹配', () => {
  it('规则与客户两侧写法不同也能圈中', () => {
    const g = group({ includeTags: ['vip'] })
    expect(matchGroup({ tags: ['VIP'] }, g)).toBe(true)
    expect(matchGroup({ tags: ['vip'] }, g)).toBe(true)
    expect(matchGroup({ tags: ['#VIP'] }, g)).toBe(true)
  })

  it('规则侧是大写、客户侧是小写同样圈中（存量未收敛场景）', () => {
    const g = group({ includeTags: ['VIP'] })
    expect(matchGroup({ tags: ['vip'] }, g)).toBe(true)
  })

  it('不含该标签的客户不圈入', () => {
    const g = group({ includeTags: ['vip'] })
    expect(matchGroup({ tags: ['普通', '华东'] }, g)).toBe(false)
    expect(matchGroup({ tags: [] }, g)).toBe(false)
    expect(matchGroup({} as Pick<Customer, 'tags'>, g)).toBe(false)
  })

  it('排除规则同样折叠，且优先于包含', () => {
    const g = group({ includeTags: ['vip'], excludeTags: ['黑名单'] })
    expect(matchGroup({ tags: ['VIP', '黑名单'] }, g)).toBe(false)
    expect(matchGroup({ tags: ['vip', '黑名单'] }, g)).toBe(false)
    expect(matchGroup({ tags: ['VIP', '华东'] }, g)).toBe(true)
  })

  it('空 include 规则不圈人（避免「新建即全量」）', () => {
    expect(matchGroup({ tags: ['vip'] }, group({ includeTags: [] }))).toBe(false)
  })

  it('多标签 AND 语义：需同时含全部 include', () => {
    const g = group({ includeTags: ['vip', '华东'] })
    expect(matchGroup({ tags: ['VIP', '华东'] }, g)).toBe(true)
    expect(matchGroup({ tags: ['VIP'] }, g)).toBe(false)
  })
})

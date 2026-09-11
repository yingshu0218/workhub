// @vitest-environment jsdom
/**
 * 待办标签回归（Issue #148）：
 * - 归一化纪律：去 `#`、trim、去空、去重保序、限长；
 * - 追加 / 移除 / 上限溢出计数（不静默丢弃）；
 * - 正文尾部 `#词` 的保存期结算（只在尾部连续段生效，中间 `#` 不动）。
 */
import { describe, it, expect } from 'vitest'
import {
  TODO_TAG_MAX_COUNT,
  TODO_TAG_MAX_LENGTH,
  normalizeTodoTag,
  normalizeTodoTags,
  appendTodoTags,
  removeTodoTag,
  settleTagsFromText,
} from '../tags'

describe('① 归一化', () => {
  it('去掉前导 # 与首尾空白', () => {
    expect(normalizeTodoTag('  ##客户跟进 ')).toBe('客户跟进')
    expect(normalizeTodoTag('Q3')).toBe('Q3')
  })

  it('去空 + 去重 + 保序', () => {
    expect(normalizeTodoTags(['#A', ' B ', 'A', '', '  ', '#B'])).toEqual(['A', 'B'])
  })

  it('单枚标签超长被截断', () => {
    const long = '乙'.repeat(100)
    expect(normalizeTodoTags([long])[0]).toHaveLength(TODO_TAG_MAX_LENGTH)
  })
})

describe('② 追加 / 移除 / 上限', () => {
  it('追加去重，重复项不产生新签', () => {
    expect(appendTodoTags(['A'], ['#A', 'B']).tags).toEqual(['A', 'B'])
  })

  it('超上限返回 overflow 计数，未加入的条目不计入', () => {
    const base = Array.from({ length: TODO_TAG_MAX_COUNT }, (_, i) => `T${i}`)
    const { tags, overflow } = appendTodoTags(base, ['额外1', '额外2'])
    expect(tags).toHaveLength(TODO_TAG_MAX_COUNT)
    expect(overflow).toBe(2)
    expect(tags).not.toContain('额外1')
  })

  it('移除按归一化值比对（带不带 # 都能删）', () => {
    expect(removeTodoTag(['A', 'B'], '#A')).toEqual(['B'])
  })
})

describe('③ 正文尾部 #词 的保存期结算', () => {
  it('末尾连续 #词 被收成标签并从正文剥离', () => {
    expect(settleTagsFromText('跟进深蓝续约\n#客户 #Q3')).toEqual({
      text: '跟进深蓝续约',
      tags: ['客户', 'Q3'],
    })
  })

  it('同行尾部的 #词 同样生效', () => {
    expect(settleTagsFromText('写周报 #复盘')).toEqual({ text: '写周报', tags: ['复盘'] })
  })

  it('正文中间的 # 不动（如「项目 #3 阶段」）', () => {
    expect(settleTagsFromText('项目 #3 阶段\n继续推进')).toEqual({
      text: '项目 #3 阶段\n继续推进',
      tags: [],
    })
  })

  it('没有 # 时原样返回', () => {
    expect(settleTagsFromText('普通正文')).toEqual({ text: '普通正文', tags: [] })
  })
})

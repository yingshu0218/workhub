/**
 * Issue #130：芯片标签输入的提交时机（不依赖失焦事件）
 *
 * 回归的根因：标签的提交原先挂在输入框 onBlur 上 —— 焦点从未落到输入框
 * （打开抽屉时焦点被姓名框抢走，用户直接点「添加关系」/「客户联想」）时
 * 提交整条不执行，输入被静默丢弃，观感就是「加了关系但保存不生效」。
 */
import { describe, it, expect } from 'vitest'
import { CHIP_SEPARATORS, committedInputValue, parseTagInput } from '../ChipTagInput'

describe('parseTagInput：分隔符拆分（中英文逗号 + 空白）', () => {
  it('英文逗号 / 中文逗号 / 空格都能拆，并去 # 去空去重', () => {
    expect(parseTagInput('高客单, 老朋友，决策链')).toEqual(['高客单', '老朋友', '决策链'])
    expect(parseTagInput('#转介绍人 # 同一公司')).toEqual(['转介绍人', '同一公司'])
    expect(parseTagInput('a,,b  ，c')).toEqual(['a', 'b', 'c'])
    expect(parseTagInput('重复,重复')).toEqual(['重复'])
  })
  it('分隔符集合含中英文逗号与空白', () => {
    expect(CHIP_SEPARATORS.test(',')).toBe(true)
    expect(CHIP_SEPARATORS.test('，')).toBe(true)
    expect(CHIP_SEPARATORS.test(' ')).toBe(true)
    expect(CHIP_SEPARATORS.test('x')).toBe(false)
  })
})

describe('committedInputValue：敲下分隔符即固化（不等失焦）', () => {
  it('输入以分隔符结尾 → 该片段立刻提交，草稿清空', () => {
    expect(committedInputValue('转介绍人,')).toEqual({ committed: ['转介绍人'], draft: '' })
    expect(committedInputValue('转介绍人，')).toEqual({ committed: ['转介绍人'], draft: '' })
  })
  it('连续粘贴多个 → 一次提交全部完整片段，末段留在草稿', () => {
    expect(committedInputValue('a,b,c')).toEqual({ committed: ['a', 'b'], draft: 'c' })
  })
  it('没有分隔符的普通输入 → 不提交（留作草稿，由保存路径结算）', () => {
    expect(committedInputValue('转介绍人')).toBeNull()
  })
  it('只敲了分隔符 → 不产生空标签，仅清掉噪音', () => {
    expect(committedInputValue('   ')).toEqual({ committed: [], draft: '' })
  })
})

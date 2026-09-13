/**
 * Issue #130：芯片标签输入的提交时机（不依赖失焦事件）
 *
 * 回归的根因：标签的提交原先挂在输入框 onBlur 上 —— 焦点从未落到输入框
 * （打开抽屉时焦点被姓名框抢走，用户直接点「添加关系」/「客户联想」）时
 * 提交整条不执行，输入被静默丢弃，观感就是「加了关系但保存不生效」。
 *
 * 分隔符口径（Issue #130 四轮修正）：**只认中英文逗号**。空白不参与拆分 ——
 * 否则「深蓝 科技」「VIP Client」「重要 客户」这类含空格的名字会被静默拆散，
 * 关联客户名被拆段后 resolveTarget 命中不了，关系反而加不进去。
 */
import { describe, it, expect } from 'vitest'
import { CHIP_SEPARATORS, committedInputValue, mergeDraftInto, parseTagInput } from '../ChipTagInput'

describe('parseTagInput：分隔符拆分（仅中英文逗号）', () => {
  it('英文逗号 / 中文逗号都能拆，并去 # 去空去重', () => {
    expect(parseTagInput('高客单, 老朋友，决策链')).toEqual(['高客单', '老朋友', '决策链'])
    expect(parseTagInput('#转介绍人,同一公司')).toEqual(['转介绍人', '同一公司'])
    expect(parseTagInput('a,,b  ，c')).toEqual(['a', 'b', 'c'])
    expect(parseTagInput('重复,重复')).toEqual(['重复'])
  })

  it('含空格的标签 / 客户名不被拆散（回归锁：空白不是分隔符）', () => {
    expect(parseTagInput('VIP Client')).toEqual(['VIP Client'])
    expect(parseTagInput('深蓝 科技')).toEqual(['深蓝 科技'])
    expect(parseTagInput('重要 客户')).toEqual(['重要 客户'])
    expect(parseTagInput('#VIP Client , 深蓝 科技')).toEqual(['VIP Client', '深蓝 科技'])
  })

  it('分隔符集合仅含中英文逗号，不含空白', () => {
    expect(CHIP_SEPARATORS.test(',')).toBe(true)
    expect(CHIP_SEPARATORS.test('，')).toBe(true)
    expect(CHIP_SEPARATORS.test(' ')).toBe(false)
    expect(CHIP_SEPARATORS.test('x')).toBe(false)
  })
})

describe('committedInputValue：敲下逗号即固化（不等失焦）', () => {
  it('输入以逗号结尾 → 该片段立刻提交，草稿清空', () => {
    expect(committedInputValue('转介绍人,')).toEqual({ committed: ['转介绍人'], draft: '' })
    expect(committedInputValue('转介绍人，')).toEqual({ committed: ['转介绍人'], draft: '' })
  })
  it('连续粘贴多个（以逗号结尾）→ 一次提交全部完整片段', () => {
    expect(committedInputValue('a,b,')).toEqual({ committed: ['a', 'b'], draft: '' })
  })
  it('末段未以逗号结尾 → 不提交（整段仍是草稿，由回车或保存路径结算）', () => {
    expect(committedInputValue('a,b,c')).toBeNull()
  })
  it('含空格的片段照原样提交，不被拆散', () => {
    expect(committedInputValue('VIP Client,')).toEqual({ committed: ['VIP Client'], draft: '' })
    expect(committedInputValue('深蓝 科技,')).toEqual({ committed: ['深蓝 科技'], draft: '' })
    expect(committedInputValue('深蓝 科技,王五')).toBeNull()
  })
  it('没有分隔符的普通输入 → 不提交（留作草稿，由保存路径结算）', () => {
    expect(committedInputValue('转介绍人')).toBeNull()
    expect(committedInputValue('VIP Client')).toBeNull()
  })
  it('只敲了分隔符 / 只有空白 → 不产生空标签，也不误判为提交', () => {
    expect(committedInputValue(',')).toEqual({ committed: [], draft: '' })
    expect(committedInputValue('   ')).toBeNull()
  })
})

/**
 * 保存路径的草稿结算口径（缺陷 D8 / 功能测试 #144）
 *
 * 原缺陷：本控件已实现未固化草稿上报（`onDraftChange`），客户表单的**标签区接了**、
 * **关系区两个控件没接** → `settleDrafts` 只读已固化数组，输入框里没回车、没失焦的内容
 * 在保存时被静默丢弃，与表单自带提示「无需点添加关系也行，保存时会自动配对」矛盾。
 *
 * 修复把「已固化片段 + 未固化草稿」的合并收口到 `mergeDraftInto`（与控件回车路径同口径），
 * 本组用例锁死该口径，防止再次出现「接了一处漏了两处」。
 */
describe('mergeDraftInto：保存路径的草稿结算（D8）', () => {
  it('① 关键回归：已固化为空 + 草稿有内容 → 草稿必须被采纳（修复前会丢失）', () => {
    expect(mergeDraftInto([], '孙博')).toEqual(['孙博'])
    expect(mergeDraftInto([], '转介绍人')).toEqual(['转介绍人'])
  })

  it('② 已固化与草稿合并，已固化在前（保持录入顺序）', () => {
    expect(mergeDraftInto(['林晓棠'], '孙博')).toEqual(['林晓棠', '孙博'])
  })

  it('③ 草稿含多个（中英文逗号）→ 全部采纳', () => {
    expect(mergeDraftInto([], '甲,乙，丙')).toEqual(['甲', '乙', '丙'])
  })

  it('④ 含空格的客户名不被拆散（空白不作分隔符）', () => {
    expect(mergeDraftInto([], '南京 团队')).toEqual(['南京 团队'])
    expect(mergeDraftInto(['深蓝 科技'], '')).toEqual(['深蓝 科技'])
  })

  it('⑤ 与已固化重复的草稿片段去重', () => {
    expect(mergeDraftInto(['孙博'], '孙博')).toEqual(['孙博'])
    expect(mergeDraftInto(['孙博'], '孙博,林晓棠')).toEqual(['孙博', '林晓棠'])
  })

  it('⑥ 空草稿 / 纯空白 / 纯分隔符 → 不产生空片段', () => {
    expect(mergeDraftInto(['甲'], '')).toEqual(['甲'])
    expect(mergeDraftInto(['甲'], '   ')).toEqual(['甲'])
    expect(mergeDraftInto(['甲'], ',')).toEqual(['甲'])
    expect(mergeDraftInto([], '')).toEqual([])
  })

  it('⑦ 首尾空白被裁剪、去首 # 与控件口径一致', () => {
    expect(mergeDraftInto([], '  孙博  ')).toEqual(['孙博'])
    expect(mergeDraftInto([], '#VIP')).toEqual(['VIP'])
  })

  it('⑧ 与控件回车路径同口径（草稿结算结果 = 直接回车提交的结果）', () => {
    for (const raw of ['孙博', '甲,乙', '南京 团队', '#VIP']) {
      expect(mergeDraftInto([], raw)).toEqual(parseTagInput(raw))
    }
  })

  it('⑨ 不折叠大小写（关系语义不是标签；大小写折叠由 CRM 标签路径单独负责）', () => {
    expect(mergeDraftInto([], 'VIP')).toEqual(['VIP'])
    expect(mergeDraftInto([], 'vip')).toEqual(['vip'])
  })
})

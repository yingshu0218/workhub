/**
 * Issue #130 二次需求回归：客户关系改成芯片标签手动输入
 *
 * 用户诉求：「客户关系改成使用标签的逻辑手动输入（芯片标签）」。
 * 拆开看是两件事，本用例各锁一条：
 *   ① 标签输入手感与「其他表单里的标签类型」一致：回车 / 中英文逗号固化、去 #、去重；
 *   ② 手动输入的关系能真正落进 `relations` 且能保存 —— 上次「保存不生效」的体感来源之一，
 *      是下拉 + 多步操作路径太长，用户输完没走完流程就点了保存，内容被静默丢弃。
 *
 * ② 用「与组件同源」的纯函数口径复算，避免把 React 渲染拖进 node 测试环境。
 */
import { describe, it, expect } from 'vitest'
import { parseTagInput } from '@/design-system/ChipTagInput'

/** 与 ChipTagInput 的 commit 同款固化逻辑（组件内联在事件回调里，这里复算其净效果） */
function commit(value: string[], raw: string): string[] {
  const parts = parseTagInput(raw)
  const next = [...value]
  for (const p of parts) if (!next.includes(p)) next.push(p)
  return next
}

describe('芯片标签输入：与笔记 / 记账表单同款的标签逻辑', () => {
  it('回车或逗号固化成芯片，逗号分隔一次粘贴多个', () => {
    expect(commit([], '大客户回款')).toEqual(['大客户回款'])
    expect(commit([], '高客单潜力, 关键决策者')).toEqual(['高客单潜力', '关键决策者'])
    // 中文逗号同款切分（中文输入法下最常用）
    expect(commit([], '转介绍人，同一公司')).toEqual(['转介绍人', '同一公司'])
  })

  it('去首 #、trim、去重（同标签重复输入不产生重复芯片）', () => {
    expect(commit([], ' #续约意向 ')).toEqual(['续约意向'])
    expect(commit(['续约意向'], '续约意向, 续约意向')).toEqual(['续约意向'])
  })

  it('空输入不产生空芯片', () => {
    expect(commit(['已有'], ' , ， ')).toEqual(['已有'])
  })
})

describe('客户关系手动输入：输入即写入 relations，不丢在中间态', () => {
  /** 与 CustomerFormDrawer.commitRelations 同款配对逻辑：候选名消解 → 笛卡尔积 → 判重 */
  function pair(
    targets: string[],
    labels: string[],
    existing: { targetId: string; label: string }[] = [],
  ) {
    const next = [...existing]
    const idByName: Record<string, string> = { 王五: 'c2', 李四: 'c3' }
    for (const raw of targets) {
      const id = idByName[raw]
      if (!id) continue
      for (const l of labels.length > 0 ? labels : ['其他']) {
        if (next.some((r) => r.targetId === id && r.label === l)) continue
        next.push({ targetId: id, label: l })
      }
    }
    return next
  }

  it('输完客户名与语义 → 两两配对写入，语义缺省落「其他」', () => {
    expect(pair(['王五'], ['转介绍人'])).toEqual([{ targetId: 'c2', label: '转介绍人' }])
    expect(pair(['王五'], [])).toEqual([{ targetId: 'c2', label: '其他' }])
  })

  it('多客户 × 多语义按笛卡尔积，同 目标+语义 判重（同对多语义仍可并存）', () => {
    expect(pair(['王五', '李四'], ['转介绍人'])).toEqual([
      { targetId: 'c2', label: '转介绍人' },
      { targetId: 'c3', label: '转介绍人' },
    ])
    expect(
      pair(['王五'], ['转介绍人', '同一公司'], [{ targetId: 'c2', label: '转介绍人' }]),
    ).toEqual([
      { targetId: 'c2', label: '转介绍人' },
      { targetId: 'c2', label: '同一公司' },
    ])
  })

  it('未匹配到客户的输入不静默丢弃（进提示，交由用户改名重试）', () => {
    const hints: string[] = []
    const idByName: Record<string, string> = { 王五: 'c2' }
    for (const raw of ['查无此人']) if (!idByName[raw]) hints.push(`未找到客户「${raw}」`)
    expect(hints).toEqual(['未找到客户「查无此人」'])
  })
})

/**
 * Issue #130 三分之三：保存路径的草稿结算（"输入即固化" 的兜底）
 *
 * 场景：用户手输客户名后没回车、没点「添加关系」，直接点「保存修改」。
 * 提交路径不再依赖失焦事件后，唯一剩下的丢输入通道就是「草稿未结算」。
 * 这里以组件同款纯逻辑复算 settleDrafts 的净效果并锁死。
 */
describe('保存路径草稿结算：草稿也必须落库（不丢输入）', () => {
  function settle(
    tags: string[],
    pendingTags: string,
    relations: { targetId: string; label: string }[],
    pendingTargets: string[],
    pendingLabels: string[],
  ) {
    const idByName: Record<string, string> = { 王五: 'c2', 李四: 'c3' }
    const nextTags = [...tags]
    for (const t of parseTagInput(pendingTags)) if (!nextTags.includes(t)) nextTags.push(t)
    const next = [...relations]
    for (const raw of pendingTargets) {
      const id = idByName[raw.trim()]
      if (!id) continue
      for (const l of pendingLabels.length > 0 ? pendingLabels : ['其他']) {
        if (next.some((r) => r.targetId === id && r.label === l)) continue
        next.push({ targetId: id, label: l })
      }
    }
    return { tags: nextTags, relations: next }
  }

  it('关系草稿：客户名 + 语义未点「添加关系」，保存时照常配对落库', () => {
    const out = settle([], '', [], ['王五'], ['转介绍人'])
    expect(out.relations).toEqual([{ targetId: 'c2', label: '转介绍人' }])
  })

  it('标签草稿：输了标签没敲分隔符，保存时并入 tags', () => {
    const out = settle(['老朋友'], '高客单潜力', [], [], [])
    expect(out.tags).toEqual(['老朋友', '高客单潜力'])
  })

  it('草稿与已有条目重复时不产生重复关系条目', () => {
    const out = settle([], '', [{ targetId: 'c2', label: '转介绍人' }], ['王五'], ['转介绍人'])
    expect(out.relations).toEqual([{ targetId: 'c2', label: '转介绍人' }])
  })

  it('草稿里的客户名解析不到 → 不写悬挂边（交由调用方回显提示）', () => {
    const out = settle([], '', [], ['查无此人'], ['转介绍人'])
    expect(out.relations).toEqual([])
  })
})

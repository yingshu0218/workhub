// @vitest-environment jsdom
/**
 * 黑名单「单据选择器排除」：**只滤候选，已关联的必须仍正常回显**（缺陷 D15）
 *
 * 为什么单独立一条断言：`EntityLinkField.selected` 与 `MatchCombobox.selected` 都是从
 * `options` 里 `find` 出来的。若图省事改成「把黑名单客户从 options 里过滤掉」，已关联的客户
 * 芯片/回显条会**直接消失** —— 用户随手一保存就把关联扔了（`onChange` 只回传仍存在的 id）。
 * 而配置卡片自己写着「档案页/关联区始终保留，不丢数据」。
 *
 * 所以这里锁的是**两条方向相反的断言**：
 *   ① 被屏蔽客户**不能**出现在候选里（开关真的生效）；
 *   ② 被屏蔽客户**若已关联**，芯片/回显条照常渲染（数据不丢）。
 *
 * 另有一条「无开关时 c2 照常可选」的反向对照 —— 否则上面第 ① 条可能因为别的原因（比如候选
 * 压根没渲染）而假绿。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import 'fake-indexeddb/auto'
import EntityLinkField from '../EntityLinkField'
import { MatchCombobox } from '../MatchCombobox'

const OPTIONS = [
  { id: 'c1', label: '深蓝科技 · 张三', icon: 'person' },
  { id: 'c2', label: '蓝海传媒 · 李四', icon: 'person' },
]
const HIDDEN_ONE: ReadonlySet<string> = new Set(['c2'])
const HIDDEN_NONE: ReadonlySet<string> = new Set()

afterEach(cleanup)

function renderLink(value: string[], hiddenIds?: ReadonlySet<string>) {
  render(
    <MemoryRouter>
      <EntityLinkField
        type="customer"
        value={value}
        options={OPTIONS}
        {...(hiddenIds ? { hiddenIds } : {})}
        placeholder="搜索客户"
        emptyText="没有可关联的客户"
        onChange={vi.fn()}
      />
    </MemoryRouter>,
  )
}

function renderCombo(value: string, hiddenIds?: ReadonlySet<string>) {
  render(
    <MemoryRouter>
      <MatchCombobox
        value={value}
        options={OPTIONS}
        {...(hiddenIds ? { hiddenIds } : {})}
        placeholder="搜索客户"
        emptyText="没有匹配的客户"
        onChange={vi.fn()}
      />
    </MemoryRouter>,
  )
}

describe('EntityLinkField（多值芯片）', () => {
  it('【对照】没有开关时两个客户都是候选（证明机制本身没坏）', () => {
    renderLink([], HIDDEN_NONE)
    fireEvent.focus(screen.getByPlaceholderText('搜索客户'))
    expect(screen.getByText('深蓝科技 · 张三')).toBeTruthy()
    expect(screen.getByText('蓝海传媒 · 李四')).toBeTruthy()
  })

  it('① 被屏蔽客户不进候选', () => {
    renderLink([], HIDDEN_ONE)
    fireEvent.focus(screen.getByPlaceholderText('搜索客户'))
    expect(screen.getByText('深蓝科技 · 张三')).toBeTruthy()
    expect(screen.queryByText('蓝海传媒 · 李四')).toBeNull()
  })

  it('② 已关联的被屏蔽客户：芯片照常渲染（不丢数据）', () => {
    renderLink(['c2'], HIDDEN_ONE)
    // 芯片文案必须还在 —— options 未被过滤，find 得到
    expect(screen.getAllByText('蓝海传媒 · 李四')).toHaveLength(1)
    // 且它不会作为候选重复出现
    fireEvent.focus(screen.getAllByRole('textbox')[0]!)
    expect(screen.getAllByText('蓝海传媒 · 李四')).toHaveLength(1)
  })

  it('已关联的非屏蔽客户仍照常渲染（回归：新 prop 不影响既有行为）', () => {
    renderLink(['c1'], HIDDEN_NONE)
    expect(screen.getByText('深蓝科技 · 张三')).toBeTruthy()
  })
})

describe('MatchCombobox（单值回显）', () => {
  it('【对照】没有开关时候选齐全', () => {
    renderCombo('', HIDDEN_NONE)
    fireEvent.focus(screen.getByPlaceholderText('搜索客户'))
    expect(screen.getByText('深蓝科技 · 张三')).toBeTruthy()
    expect(screen.getByText('蓝海传媒 · 李四')).toBeTruthy()
  })

  it('① 被屏蔽客户不进候选（未选态）', () => {
    renderCombo('', HIDDEN_ONE)
    fireEvent.focus(screen.getByPlaceholderText('搜索客户'))
    expect(screen.getByText('深蓝科技 · 张三')).toBeTruthy()
    expect(screen.queryByText('蓝海传媒 · 李四')).toBeNull()
  })

  it('② 已选中的被屏蔽客户：回显条照常显示，且不再作为候选重复出现', () => {
    renderCombo('c2', HIDDEN_ONE)
    // 回显条（selected 从完整 options 里 find，未受 hiddenIds 影响）
    const echo = screen.getByTitle('点击重新选择')
    expect(echo.textContent).toContain('蓝海传媒 · 李四')
    // 展开候选：只剩可选的那个，已选的不重复出现
    fireEvent.click(echo)
    expect(screen.getAllByText('蓝海传媒 · 李四')).toHaveLength(1)
    expect(screen.getByText('深蓝科技 · 张三')).toBeTruthy()
  })

  it('候选全被屏蔽时只剩「不关联」项（不白屏、不泄漏被屏蔽客户）', () => {
    renderCombo('', new Set(['c1', 'c2']))
    fireEvent.focus(screen.getByPlaceholderText('搜索客户'))
    // 「不关联」恒在首位（未选态），所以列表不会为空 —— 空态文案不出现属预期
    expect(screen.getByText('不关联')).toBeTruthy()
    expect(screen.queryByText('深蓝科技 · 张三')).toBeNull()
    expect(screen.queryByText('蓝海传媒 · 李四')).toBeNull()
  })
})

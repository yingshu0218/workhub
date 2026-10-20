// @vitest-environment jsdom
/**
 * 下拉浮层「点外部收不回去 / Esc 连表单一起关」回归（Issue #151）
 *
 * 用户反馈：下拉菜单选择之后，点击其他位置收不回去（截图里候选浮层一直挂着）。
 *
 * 根因不是「忘了写点外关闭」——三处浮层都写了 —— 而是**浮层自己吃掉了判定事件**：
 * 浮层 portal 到 body、不在触发器的 `boxRef` 子树里，于是它内部的 `mousedown/pointerdown`
 * 阻断会让文档级监听收不到事件；一旦浮层在 `mousedown` 派发前就同步挂上 handler
 * （React 18 离散事件同步 flush），关闭逻辑就永久失效。
 *
 * 本文件锁三条纪律：
 *   A. 展开 → 点浮层外部必须关闭；
 *   B. Esc 关浮层但**不**关掉外层 Modal（Esc 不能被冒泡给 Modal 的 useEscapeLayer）；
 *   C. 点浮层内部不算「外部点击」（选中生效、浮层正常关闭）。
 *
 * 注：jsdom 无布局引擎，浮层的定位/尺寸全为 0，这不影响本用例 —— 断言只依赖
 * 「浮层节点是否存在」与事件语义，不依赖任何尺寸。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { MemoryRouter } from 'react-router-dom'
import { db } from '@/db/db'
import ChannelSelect from '../ChannelSelect'
import EntityLinkField from '../EntityLinkField'
import { MatchCombobox } from '../MatchCombobox'
import { Modal } from '../ui'

/**
 * ⚠️ 关于「关闭后浮层何时消失」的断言口径（Phase M1 起）
 *
 * 浮层现在带 150ms 出场动画：点外部 / Esc 之后它**不会同步消失**，
 * 而是保持挂载播出场、动画播完才卸载（见 shared/usePresence）。
 * 所以这些用例统一用 `waitFor(() => expect(...).toBeNull())` 而不是直接断言 null ——
 * 直接断言只会锁住「立即消失」这个已经不成立的旧语义。
 * jsdom 不派发 animationend，卸载由 hook 内的定时器兜底，故 waitFor 能稳定等到。
 */

const CHANNELS = [
  { value: '微信', label: '微信 / 微信支付' },
  { value: '支付宝', label: '支付宝' },
]

beforeEach(async () => {
  cleanup()
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => cleanup())

describe('ChannelSelect 浮层关闭', () => {
  it('A 选中渠道即关闭；再次展开后点外部也关闭', async () => {
    render(<ChannelSelect value="" options={CHANNELS} onChange={() => {}} />)
    const trigger = screen.getByRole('combobox', { name: '结算渠道' })

    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: '支付宝' }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())

    // 再次展开：点浮层外部（document.body）必须关闭 —— 这是用户截图里的坏路径
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('B Esc 只关浮层，不关外层 Modal', async () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} title="记一笔账" onClose={onClose}>
        <ChannelSelect value="" options={CHANNELS} onChange={() => {}} />
      </Modal>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: '结算渠道' }))
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('记一笔账')).toBeTruthy()
  })

  it('C 点浮层内的候选项 = 正常选中，不算「外部点击」', async () => {
    render(<ChannelSelect value="微信" options={CHANNELS} onChange={() => {}} />)
    const trigger = screen.getByRole('combobox', { name: '结算渠道' })
    fireEvent.click(trigger)
    // 用 role=option 定位（触发器文案与候选文案重名，纯文本查询有歧义）
    fireEvent.click(screen.getByRole('option', { name: '微信 / 微信支付' }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(trigger.textContent).toContain('微信')
  })
})

describe('EntityLinkField 浮层关闭', () => {
  it('点浮层内部不关，点浮层外部则关闭', async () => {
    render(
      <MemoryRouter>
        <EntityLinkField
          type="customer"
          value={[]}
          options={[{ id: 'c1', label: '深蓝科技 · 张三' }]}
          placeholder="搜索客户"
          emptyText="暂无客户"
          onChange={() => {}}
        />
      </MemoryRouter>,
    )
    const input = screen.getByPlaceholderText('搜索客户')
    fireEvent.focus(input)
    const option = () => screen.queryByRole('button', { name: /深蓝科技 · 张三/ })
    expect(option()).toBeTruthy()

    // 点浮层内部：不关
    fireEvent.mouseDown(option()!)
    expect(option()).toBeTruthy()

    // 点外部：关（等待出场动画播完）
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(option()).toBeNull())
  })
})

describe('MatchCombobox 浮层关闭', () => {
  it('点浮层内部不关，点浮层外部则关闭', async () => {
    render(
      <MatchCombobox
        value=""
        options={[{ id: 'a', label: '选项甲' }]}
        placeholder="搜索"
        emptyText="无候选"
        onChange={() => {}}
      />,
    )
    const input = screen.getByPlaceholderText('搜索')
    fireEvent.focus(input)
    // 浮层里有「不关联」+「选项甲」
    const option = () => screen.queryByRole('button', { name: /选项甲/ })
    expect(option()).toBeTruthy()

    fireEvent.mouseDown(option()!)
    expect(option()).toBeTruthy()

    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(option()).toBeNull())
  })
})

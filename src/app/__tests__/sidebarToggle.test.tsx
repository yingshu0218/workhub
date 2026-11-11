// @vitest-environment jsdom
/**
 * 侧栏伸缩按钮的**渲染级**回归（2026-10-19 用户需求：「最左侧的菜单没有伸缩按钮」）
 *
 * 用户截图指出：左侧菜单固定 232px、没有任何收起入口。本用例把这次补上的入口钉死，
 * 重点覆盖三类容易回归的点：
 *   ① 按钮确实存在，且点击后在「展开 ↔ 图标轨」之间切换（不是只有个装饰图标）；
 *   ② ⚠️ **收起后主内容区不被推挤**：宽度锚点在 slot（占 56px），`<aside>` 是绝对定位
 *      向外叠出的浮层 —— 若有人图省事把 aside 改回流内并靠 `width` 撑开，悬停时
 *      主内容会整体重排（页面左右抖动），这里用「slot 宽度」把该不变式钉住；
 *   ③ ⌘B 快捷键与按钮等价（注册表里能查到 mod+b）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import AppLayout from '../AppLayout'
import { __resetSidebarCollapsedForTest, isSidebarCollapsed } from '../sidebarPref'
import { getShortcut } from '@/shared/shortcuts'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  // ⚠️ 顺序不能反：`__reset*` 现在是「从存储重新读取」（模拟刷新），
  // 若先重置再清存储，会读到上一个用例留下的 '1' → 后续用例一进来就是收起态
  localStorage.clear()
  __resetSidebarCollapsedForTest()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/todo']}>
      <AppLayout>
        <div data-testid="main-content">主内容</div>
      </AppLayout>
    </MemoryRouter>,
  )
}

/** 侧栏宽度锚点（外层 slot） */
function slot(): HTMLElement {
  return document.querySelector('.app-sidebar-slot') as HTMLElement
}
/** 侧栏本体 */
function aside(): HTMLElement {
  return document.querySelector('.app-sidebar') as HTMLElement
}

describe('侧栏伸缩按钮（2026-10-19）', () => {
  it('① 展开态：按钮存在，语义为「收起左侧菜单」', () => {
    renderLayout()
    const btn = screen.getByLabelText('收起左侧菜单')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('①b 点按钮 → 收到图标轨宽度，按钮语义翻转为「展开左侧菜单」', () => {
    renderLayout()
    const before = slot().style.width
    fireEvent.click(screen.getByLabelText('收起左侧菜单'))

    expect(isSidebarCollapsed()).toBe(true)
    const after = slot().style.width
    expect(after).not.toBe(before)
    expect(parseInt(after, 10)).toBeLessThan(parseInt(before, 10))
    // 按钮自身也跟着翻语义（不是靠外部状态暗示）
    expect(screen.getByLabelText('展开左侧菜单')).toBeTruthy()
  })

  it('② ⚠️ 收起后宽度锚点变窄（主内容区跟着让位），且 aside 是绝对定位的浮层', () => {
    renderLayout()
    const expandedWidth = parseInt(slot().style.width, 10)
    fireEvent.click(screen.getByLabelText('收起左侧菜单'))
    const collapsedWidth = parseInt(slot().style.width, 10)

    expect(collapsedWidth).toBeLessThan(expandedWidth)
    // 锚点在 slot 上、aside 绝对定位 → 悬停浮出时只叠不挤（核心不变式）
    expect(slot().className).toContain('relative')
    expect(aside().className).toContain('absolute')
    expect(aside().getAttribute('data-collapsed')).toBe('true')
  })

  it('②b 图标轨态：菜单项只剩图标（文案收起），但名称仍可通过 title 读到', () => {
    renderLayout()
    fireEvent.click(screen.getByLabelText('收起左侧菜单'))
    const todoLink = document.querySelector('a[href="/todo"]') as HTMLElement
    expect(todoLink.textContent?.trim()).toBe('')
    expect(todoLink.getAttribute('title')).toBe('待办')
  })

  it('②c 展开态菜单项带文案、不带冗余 title（不打扰鼠标）', () => {
    renderLayout()
    const todoLink = document.querySelector('a[href="/todo"]') as HTMLElement
    expect(todoLink.textContent).toContain('待办')
    expect(todoLink.getAttribute('title')).toBeNull()
  })

  it('③ ⌘B 已注册为全局快捷键，且与按钮同一动作', () => {
    renderLayout()
    const def = getShortcut('mod+b')
    expect(def).toBeTruthy()
    expect(def!.scope).toBe('global')
    expect(def!.description).toContain('收起')
    // 触发它应等价于点按钮
    def!.handler(new KeyboardEvent('keydown', { key: 'b', metaKey: true }))
    expect(isSidebarCollapsed()).toBe(true)
  })

  it('④ 鼠标悬浮图标轨 → 侧栏浮出（data-rail-open），移开后又收回', async () => {
    renderLayout()
    fireEvent.click(screen.getByLabelText('收起左侧菜单'))
    expect(aside().getAttribute('data-rail-open')).toBe('false')

    fireEvent.mouseEnter(aside())
    // 浮出是同步的（openHover 只清定时器 + 置位）
    await waitFor(() => expect(aside().getAttribute('data-rail-open')).toBe('true'))
    // 浮出时文案回来了
    expect(document.querySelector('a[href="/todo"]')?.textContent).toContain('待办')

    // ⚠️ 用真实计时器 + waitFor 而不是 fakeTimers：收起有 120ms 延迟，
    // 且断言的是 React 状态驱动出的 DOM 属性，两件事叠在一起时假计时器
    // 容易在「计时器已推进但重渲染未提交」的窗口里取到旧值（实测踩过）
    fireEvent.mouseLeave(aside())
    await waitFor(() => expect(aside().getAttribute('data-rail-open')).toBe('false'))
  })

  it('⑤ 展开态不监听悬停（不会莫名浮出）', () => {
    renderLayout()
    fireEvent.mouseEnter(aside())
    expect(aside().getAttribute('data-rail-open')).toBe('false')
  })
})
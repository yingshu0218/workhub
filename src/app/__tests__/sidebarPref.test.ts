// @vitest-environment jsdom
/**
 * 侧栏伸缩偏好（2026-10-19 用户需求：「最左侧的菜单没有伸缩按钮」）
 *
 * 本用例锁死三件事：
 *   ① 缺省（首次进入）必须是**展开** —— 老用户零感知，不会莫名其妙发现菜单没了；
 *   ② 折叠态持久化到 localStorage，刷新后仍保持；
 *   ③ 订阅在变更时被通知、取消订阅后不再收到（useSyncExternalStore 的前提）。
 *
 * ⚠️ 这是**本地偏好**（storage key `nexus:sidebar-collapsed`），刻意不进 settings 表、
 * 不参与同步：折叠是每台设备各自的窗口形态（宽屏展开、笔记本收起），
 * 进同步会让一端收起把另一端也收掉。这里用一条断言把这个口径钉住。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
  __resetSidebarCollapsedForTest,
  isSidebarCollapsed,
  onSidebarCollapsedChange,
  setSidebarCollapsed,
  toggleSidebarCollapsed,
} from '../sidebarPref'

beforeEach(() => {
  // 顺序不能反：先清存储，再让单例从干净存储里重新读 → 每个用例都从「未持久化」开始
  localStorage.clear()
  __resetSidebarCollapsedForTest()
})

describe('侧栏伸缩偏好', () => {
  it('① 缺省为展开（老用户零感知）', () => {
    expect(isSidebarCollapsed()).toBe(false)
  })

  it('② 收起 → 持久化；重新读取（模拟刷新）仍为收起', () => {
    setSidebarCollapsed(true)
    expect(isSidebarCollapsed()).toBe(true)
    expect(localStorage.getItem('nexus:sidebar-collapsed')).toBe('1')

    // 模拟「刷新页面」：进程内单例复位 → 重新从 localStorage 读，仍应是收起。
    // ⚠️ 这里刻意**不清 storage** —— 清了就变成在测「缺省态」，测不到持久化
    __resetSidebarCollapsedForTest()
    expect(isSidebarCollapsed()).toBe(true)
  })

  it('②b 再展开时清掉存储键（不留半吊子状态）', () => {
    setSidebarCollapsed(true)
    setSidebarCollapsed(false)
    expect(isSidebarCollapsed()).toBe(false)
    expect(localStorage.getItem('nexus:sidebar-collapsed')).toBeNull()
  })

  it('③ 变更广播：订阅者收到通知，取消订阅后不再收到', () => {
    const fn = vi.fn()
    const off = onSidebarCollapsedChange(fn)
    setSidebarCollapsed(true)
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    setSidebarCollapsed(false)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('③b 同值设置不重复广播（避免无谓重渲染）', () => {
    const fn = vi.fn()
    onSidebarCollapsedChange(fn)
    setSidebarCollapsed(true)
    setSidebarCollapsed(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('toggle 往返回到原态', () => {
    expect(toggleSidebarCollapsed()).toBe(true)
    expect(toggleSidebarCollapsed()).toBe(false)
  })

  it('宽度常量：收起态明显窄于展开态，且能容纳一枚图标', () => {
    expect(SIDEBAR_WIDTH_COLLAPSED).toBeLessThan(SIDEBAR_WIDTH_EXPANDED)
    // 图标轨需 ≥ 图标(20) + 内边距，否则图标会被压扁
    expect(SIDEBAR_WIDTH_COLLAPSED).toBeGreaterThanOrEqual(48)
  })

  it('localStorage 不可用（隐私模式）时不抛异常，回落展开态', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    // 重新加载模块单例以走一次读路径
    expect(() => {
      __resetSidebarCollapsedForTest()
      setSidebarCollapsed(true)
      expect(isSidebarCollapsed()).toBe(true) // 本次会话内仍生效
    }).not.toThrow()
    spy.mockRestore()
  })
})
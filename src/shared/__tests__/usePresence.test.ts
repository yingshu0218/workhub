// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePresence } from '../usePresence'

/**
 * usePresence 回归锁（Phase M1）
 *
 * 这个 hook 是「弹层有出场动画」的唯一支点，风险面集中在三处：
 *  ① 关闭时必须**保持挂载**一小段（否则出场动画无从播放 —— 这正是改造前的缺陷）；
 *  ② 到点后必须真的卸载（否则弹层永远留在 DOM 上、越堆越多）；
 *  ③ 降级态必须**立即**卸载（无障碍场景不能等，jsdom 环境也不派发 animationend）。
 */
describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    delete document.documentElement.dataset.motion
  })

  afterEach(() => {
    vi.useRealTimers()
    delete document.documentElement.dataset.motion
  })

  it('打开时立即挂载，方向为 in', () => {
    const { result } = renderHook(() => usePresence(true, 200))
    expect(result.current.present).toBe(true)
    expect(result.current.phase).toBe('in')
  })

  it('关闭时保持挂载并切到 out —— 这是「出场动画能播」的前提', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), {
      initialProps: { open: true },
    })
    expect(result.current.present).toBe(true)

    rerender({ open: false })

    // 关键断言：还没到点，仍在树上、方向已转为 out
    expect(result.current.present).toBe(true)
    expect(result.current.phase).toBe('out')
  })

  it('出场时长走完后再卸载（不会永远留在 DOM 上）', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), {
      initialProps: { open: true },
    })

    rerender({ open: false })
    expect(result.current.present).toBe(true)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(result.current.present).toBe(false)
  })

  it('出场未播完就被重新打开 → 直接接管，不会被旧定时器摘掉', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), {
      initialProps: { open: true },
    })

    rerender({ open: false })
    act(() => {
      vi.advanceTimersByTime(100) // 只播了一半
    })
    rerender({ open: true })

    expect(result.current.present).toBe(true)
    expect(result.current.phase).toBe('in')

    // 旧定时器的剩余时间过去后，不应把已重新打开的弹层卸掉
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.present).toBe(true)
  })

  it('降级（data-motion=off）：关闭时立即卸载，不等待', () => {
    document.documentElement.dataset.motion = 'off'
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), {
      initialProps: { open: true },
    })

    rerender({ open: false })

    // 无需推进定时器
    expect(result.current.present).toBe(false)
  })

  it('降级（duration 传 0）：关闭时立即卸载', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 0), {
      initialProps: { open: true },
    })

    rerender({ open: false })
    expect(result.current.present).toBe(false)
  })

  it('组件卸载后定时器不再触发 setState（无泄漏、无 act 警告）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender, unmount } = renderHook(({ open }) => usePresence(open, 200), {
      initialProps: { open: true },
    })

    rerender({ open: false })
    unmount()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
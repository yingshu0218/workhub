// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRowExit, ROW_EXIT_DURATION_MS } from '../useRowExit'
import { isMotionOff } from '../usePresence'

/**
 * `useRowExit` 回归锁（2026-10-20）。
 *
 * 这个 hook 的存在只为一件事：**让「用户主动让某一行消失」这件事有动画可播**。
 * 而它天生带着一个风险 —— 一旦在测试/无障碍环境下也保留存活项，
 * 「打完勾这一行就该没了」这类断言会红。故两侧行为都必须钉住。
 */

const A = { id: 'a' }
const B = { id: 'b' }
const C = { id: 'c' }
const keyOf = (x: { id: string }) => x.id

interface Row {
  item: { id: string }
  leaving: boolean
}

/** 取出「当前应渲染的 key」列表（含正在退场的） */
const keysOf = (rows: Row[]) => rows.map((r) => r.item.id)
/** 取出正在退场的 key */
const leavingOf = (rows: Row[]) => rows.filter((r) => r.leaving).map((r) => r.item.id)

describe('useRowExit · 零时长（测试与非动效场景的安全默认）', () => {
  it('duration=0 时立即移除，不保留任何存活项', () => {
    /**
     * ⚠️ 这条是「既有测试不被破坏」的保证。
     * jsdom 不跑样式引擎、不派发 animationend，若零时长还保留存活项，
     * 所有「点完就不该再查到它」的断言都会红，而红得莫名其妙。
     */
    const { result, rerender } = renderHook(({ items }: { items: typeof A[] }) =>
      useRowExit(items, keyOf, 0),
      { initialProps: { items: [A, B] } },
    )
    expect(keysOf(result.current)).toEqual(['a', 'b'])

    rerender({ items: [B] })
    expect(keysOf(result.current)).toEqual(['b'])
    expect(leavingOf(result.current)).toEqual([])
  })
})

describe('useRowExit · 降级（无障碍 / 应用内关闭动效）', () => {
  const original = document.documentElement.dataset.motion

  afterEach(() => {
    if (original === undefined) delete document.documentElement.dataset.motion
    else document.documentElement.dataset.motion = original
    vi.useRealTimers()
  })

  it('data-motion=off 下即便给了时长也立即移除', () => {
    document.documentElement.dataset.motion = 'off'
    expect(isMotionOff()).toBe(true)

    const { result, rerender } = renderHook(({ items }: { items: typeof A[] }) =>
      useRowExit(items, keyOf, 500),
      { initialProps: { items: [A, B] } },
    )
    rerender({ items: [B] })

    // 无障碍用户不该看到「点完还挂在那里」
    expect(keysOf(result.current)).toEqual(['b'])
    expect(leavingOf(result.current)).toEqual([])
  })
})

describe('useRowExit · 有动效时（mock 掉降级判定）', () => {
  beforeEach(() => {
    // 让 isMotionOff 返回 false —— 不依赖 jsdom 是否提供 matchMedia
    delete document.documentElement.dataset.motion
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('消失的行会以 leaving=true 保留一段，到期后移除', () => {
    const { result, rerender } = renderHook(({ items }: { items: typeof A[] }) =>
      useRowExit(items, keyOf, 200),
      { initialProps: { items: [A, B] } },
    )

    rerender({ items: [B] })
    // 仍在场上，但标成退场中
    expect(keysOf(result.current)).toContain('a')
    expect(leavingOf(result.current)).toEqual(['a'])
    // 顺带确认：留下的那行不是 leaving
    expect(result.current.find((r) => r.item.id === 'b')!.leaving).toBe(false)

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(keysOf(result.current)).toEqual(['b'])
    expect(leavingOf(result.current)).toEqual([])
  })

  it('退场中途该行又回来了 → 立刻中止退场（清掉定时器，不留悬空回调）', () => {
    /**
     * ⚠️ 这条**必须用 spy 验证 clearTimeout**，不能只看返回列表 ——
     * 返回时会按「当前 items 里有没有这个 key」过滤掉退场项，
     * 于是「内部残留了一个陈旧项」在输出上完全看不出来（实测：删掉实现里的
     * `setLeaving(...filter)` 这一行，只看输出的断言照样全绿，是假阳性）。
     * 而内部不清会**逐次累积**：每次「消失→回来」都在 leaving 里留一条永不回收的项。
     */
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const { result, rerender } = renderHook(({ items }: { items: typeof A[] }) =>
        useRowExit(items, keyOf, 200),
        { initialProps: { items: [A, B] } },
      )

      rerender({ items: [B] }) // a 开始退场，起了定时器
      expect(leavingOf(result.current)).toEqual(['a'])

      const before = clearSpy.mock.calls.length
      rerender({ items: [A, B] }) // 撤销打勾，a 回来
      expect(clearSpy.mock.calls.length, 'a 回来时没有清掉它的退场定时器').toBeGreaterThan(before)

      // 输出正确：a 正常在场上、且不标 leaving
      expect(keysOf(result.current)).toEqual(['a', 'b'])
      expect(leavingOf(result.current)).toEqual([])

      // 且旧定时器不该在之后把它摘掉
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(keysOf(result.current)).toEqual(['a', 'b'])
    } finally {
      clearSpy.mockRestore()
    }
  })

  it('同时多行退场互不干扰', () => {
    const { result, rerender } = renderHook(({ items }: { items: typeof A[] }) =>
      useRowExit(items, keyOf, 150),
      { initialProps: { items: [A, B, C] } },
    )

    rerender({ items: [B] })
    expect(leavingOf(result.current).sort()).toEqual(['a', 'c'])

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(keysOf(result.current)).toEqual(['b'])
  })

  it('⚠️ 返回顺序：退场行必须**留在原位**，不得被追加到末尾', () => {
    /**
     * ⚠️ 这条曾经锁的是**错误行为**（2026-10-20 用户实测「点击完成待办没看到
     * 任何交互」后定位到）。当时的写法与理由：
     *   「追加在后 —— 插回原位的话后面的行会整体上移一格」
     * **完全说反了**：
     *   · 插回原位 → 退场行占着原位置淡出+收拢 → 其余行**位置不动** ✅
     *   · 追加到末尾 → 退场行**瞬间跳到列表底部**淡出，且它原位置下方的行
     *     **立刻上移一格** → 用户看到「行突然不见 + 列表跳动」❌
     * 现在改成锁正确行为；实现是「退场行按原索引插回」。
     */
    const { result, rerender } = renderHook(({ items }: { items: typeof A[] }) =>
      useRowExit(items, keyOf, 200),
      { initialProps: { items: [A, B, C] } },
    )

    rerender({ items: [A, C] }) // 中间的 b 消失
    // b 必须仍在**第 2 个位置**（原索引 1），绝不能跑到末尾
    expect(keysOf(result.current), '退场行跑到末尾了 —— 会表现为列表跳动').toEqual([
      'a',
      'b',
      'c',
    ])
    expect(leavingOf(result.current)).toEqual(['b'])
    // 顺带确认 leaving 标志只在该行上
    expect(result.current.find((r) => r.item.id === 'b')!.leaving).toBe(true)
    expect(result.current.find((r) => r.item.id === 'c')!.leaving).toBe(false)
  })

  it('首位行退场留在首位；末位行退场留在末位（边界）', () => {
    // 首位
    const first = renderHook(({ items }: { items: typeof A[] }) => useRowExit(items, keyOf, 200), {
      initialProps: { items: [A, B, C] },
    })
    first.rerender({ items: [B, C] })
    expect(keysOf(first.result.current)).toEqual(['a', 'b', 'c'])

    // 末位
    const last = renderHook(({ items }: { items: typeof A[] }) => useRowExit(items, keyOf, 200), {
      initialProps: { items: [A, B, C] },
    })
    last.rerender({ items: [A, B] })
    expect(keysOf(last.result.current)).toEqual(['a', 'b', 'c'])
  })

  it('同时多行退场：各自留在原位，不互相挤位', () => {
    const { result, rerender } = renderHook(({ items }: { items: typeof A[] }) =>
      useRowExit(items, keyOf, 200),
      { initialProps: { items: [A, B, C] } },
    )

    rerender({ items: [B] }) // a 与 c 同时消失
    expect(keysOf(result.current)).toEqual(['a', 'b', 'c'])
    expect(result.current.find((r) => r.item.id === 'a')!.leaving).toBe(true)
    expect(result.current.find((r) => r.item.id === 'b')!.leaving).toBe(false)
    expect(result.current.find((r) => r.item.id === 'c')!.leaving).toBe(true)
  })

  it('时长取自 ROW_EXIT_DURATION_MS 的语义：与 .anim-row-out 的基时一致', () => {
    // 常量若与 CSS 漂移，会出现「动画还在播、元素已被摘掉」的截断
    expect(ROW_EXIT_DURATION_MS).toBe(200)
  })
})
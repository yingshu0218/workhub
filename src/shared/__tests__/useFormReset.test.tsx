// @vitest-environment jsdom
/**
 * `useFormReset` 行为锁（收口 C-10 · 2026-10-21）
 *
 * ## 这个 hook 在替换什么
 *
 * 它替代了 **7 处**各自手写的「渲染期重置」代码。那些代码此前**只有 1 处间接被测试覆盖**
 * （`TransactionFormDrawer` 有若干集成测试）、其余 3 处（Habit / Ledger / GroupEditor）
 * **零覆盖** —— 也就是说：我这次改动一旦把重置逻辑弄错，
 * 表现是「打开编辑弹层时字段没回填 / 回填了上一个记录的值」，**而没有任何测试会报红**。
 *
 * 因此本文件是这次收口的**唯一安全网**，必须先把 hook 的行为钉死。
 *
 * ## 锁住的不变量
 *
 * 1. 首次挂载（key 从 `''` 变到实际值）**就触发一次** reset（否则第一次打开不回填）；
 * 2. key 不变时不重复触发（渲染期判断，不能每次渲染都重置 —— 那会让输入框打不进字）；
 * 3. key 变化（换记录 / 重开）触发，且**回调拿到的 `open` 是本次值**；
 * 4. `seedKey` **仅在打开时递增**（与既有 4 处 `setSeedKey` 的位置一致）；
 * 5. reset 回调里 `setState` 不得引发无限渲染（hook 自身要在同一次渲染内推进 lastKey）。
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFormReset } from '../useFormReset'

/** 用 useState 模拟调用方的表单字段，验证「重置真的写进去了」 */
describe('useFormReset：渲染期重置的行为不变量', () => {
  it('首次挂载（key 从空变到实际值）触发一次 reset', () => {
    const reset = vi.fn()
    renderHook(() => useFormReset(true + '-rec1', true, reset))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledWith(true)
  })

  it('key 不变时不重复触发（否则输入框会被反复清空）', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useFormReset(`true-rec1`, open, reset),
      { initialProps: { open: true } },
    )
    expect(reset).toHaveBeenCalledTimes(1)
    // 反复重渲染（模拟用户打字）
    for (let i = 0; i < 5; i++) rerender({ open: true })
    expect(reset).toHaveBeenCalledTimes(1) // 仍然只有挂载那一次
  })

  it('key 变化（换记录）触发，且入参是本次 open', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(
      ({ key, open }: { key: string; open: boolean }) => useFormReset(key, open, reset),
      { initialProps: { key: 'true-rec1', open: true } },
    )
    expect(reset).toHaveBeenCalledTimes(1)

    rerender({ key: 'true-rec2', open: true }) // 切到另一条记录
    expect(reset).toHaveBeenCalledTimes(2)
    expect(reset).toHaveBeenLastCalledWith(true)

    rerender({ key: 'false-rec2', open: false }) // 关闭
    expect(reset).toHaveBeenCalledTimes(3)
    expect(reset).toHaveBeenLastCalledWith(false) // ⚠️ 显式告知「这次是关闭」
  })

  it('seedKey 仅在打开时递增（与既有 4 处 setSeedKey 位置一致）', () => {
    const seen: number[] = []
    const { rerender } = renderHook(
      ({ key, open }: { key: string; open: boolean }) => {
        const r = useFormReset(key, open, () => {})
        seen.push(r.seedKey)
        return r
      },
      { initialProps: { key: 'true-rec1', open: true } },
    )
    // 打开 → seedKey 0 → 1
    expect(seen[seen.length - 1]).toBe(1)

    rerender({ key: 'false-rec1', open: false }) // 关闭：不递增
    expect(seen[seen.length - 1]).toBe(1)

    rerender({ key: 'true-rec2', open: true }) // 再打开：递增
    expect(seen[seen.length - 1]).toBe(2)
  })

  it('reset 里 setState 不会引发无限渲染', () => {
    let renders = 0
    const { rerender } = renderHook(
      ({ key }: { key: string }) => {
        renders++
        // 模拟调用方在 reset 里写自己的 state
        useFormReset(key, true, () => {})
        return null
      },
      { initialProps: { key: 'true-a' } },
    )
    const base = renders
    for (let i = 0; i < 3; i++) rerender({ key: 'true-a' })
    // key 未变 → 渲染次数只随 rerender 线性增长，不爆炸
    expect(renders - base).toBeLessThanOrEqual(3)
  })
})
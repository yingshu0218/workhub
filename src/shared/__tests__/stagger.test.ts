import { describe, expect, it } from 'vitest'
import { STAGGER_CAP, STAGGER_STEP_MS, staggerStyle } from '../stagger'

/**
 * staggerStyle 回归锁。
 *
 * 这个 helper 的价值全在「封顶」与「越界不写 style」两点上 —— 一旦被人
 * 「顺手简化」成 `{ animationDelay: `${i * 20}ms` }`，长列表（月历 28~31 格、
 * 奖杯墙、时间线）的入场会拖到 600ms+，观感立刻从「顺滑」变「漏项」，
 * 而这种退化没有任何运行时错误、只能靠肉眼发现。故在此钉死。
 */
describe('staggerStyle', () => {
  it('封顶内按下标线性递增', () => {
    expect(staggerStyle(0)).toEqual({ animationDelay: '0ms' })
    expect(staggerStyle(1)).toEqual({ animationDelay: `${STAGGER_STEP_MS}ms` })
    expect(staggerStyle(9)).toEqual({ animationDelay: '180ms' })
  })

  it('到达封顶即停止 —— 不写 style（而非给一个 0ms）', () => {
    expect(staggerStyle(STAGGER_CAP)).toBeUndefined()
    expect(staggerStyle(STAGGER_CAP + 1)).toBeUndefined()
    expect(staggerStyle(999)).toBeUndefined()
  })

  it('非法输入一律返回 undefined（不抛错、不产出 NaNms）', () => {
    expect(staggerStyle(-1)).toBeUndefined()
    expect(staggerStyle(NaN)).toBeUndefined()
    expect(staggerStyle(Infinity)).toBeUndefined()
    expect(staggerStyle(-Infinity)).toBeUndefined()
  })

  it('index 缺省 = 不参与错峰（子组件行渲染时的可选 prop 语义）', () => {
    expect(staggerStyle(undefined)).toBeUndefined()
  })

  it('cap / step 可覆写（长列表想更快收敛时用）', () => {
    expect(staggerStyle(2, 3, 10)).toEqual({ animationDelay: '20ms' })
    expect(staggerStyle(3, 3, 10)).toBeUndefined()
    expect(staggerStyle(0, 5, 50)).toEqual({ animationDelay: '0ms' })
    expect(staggerStyle(4, 5, 50)).toEqual({ animationDelay: '200ms' })
  })

  it('入场总时长恒定：与列表长度无关（封顶的意义）', () => {
    const worstDelay = (length: number) => {
      let max = 0
      for (let i = 0; i < length; i++) {
        const s = staggerStyle(i)
        if (s?.animationDelay) max = Math.max(max, Number.parseInt(String(s.animationDelay), 10))
      }
      return max
    }
    // 3 条 / 30 条 / 300 条，最大延迟都停在 (cap-1) × step
    expect(worstDelay(3)).toBe(40)
    expect(worstDelay(30)).toBe(180)
    expect(worstDelay(300)).toBe(180)
  })

  it('纯确定性：同输入必得同输出（无随机 / 无时间依赖）', () => {
    const a = JSON.stringify(staggerStyle(5))
    const b = JSON.stringify(staggerStyle(5))
    expect(a).toBe(b)
  })
})
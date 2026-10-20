// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/db/types'
import { MOTION_PRESETS } from '@/shared/theme'
import { applySettingsToDom } from '@/shared/effects'

/**
 * 「动效强度」设置项的接线回归锁（2026-10-19）。
 *
 * 这一项横跨四处（types 字段 / DEFAULT 默认值 / theme 档位常量 / effects 写 DOM），
 * 而 CSS 侧的降级规则本身已有 `motion.tokens.test.ts` 锁住 ——
 * 缺的正是「设置改下去，DOM 真的跟着变」这一段。故这里补上。
 */

const ROOT = path.resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

/** 取一份可改的默认设置深拷贝 */
function settingsWith(motion?: 'full' | 'reduced' | 'off') {
  return {
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, motion },
  }
}

describe('动效强度 · 设置接线', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.motion
  })

  it('缺省（full）不写 data-motion 属性', () => {
    /**
     * ⚠️ 这是最容易被「顺手改成 data-motion="full"」的地方。
     * CSS 只定义了 reduced / off 两个选择器、**没有 full** ——
     * 写上 full 虽然表面上也回落到默认 scale:1，但会让 DOM 撒谎
     * （DevTools 里看着像有设置、实际没有对应规则）。
     * 正确的「回到缺省」表达是**删属性**。
     */
    applySettingsToDom(settingsWith('full') as never)
    expect(document.documentElement.dataset.motion).toBeUndefined()
  })

  it('motion 字段缺失时按 full 处理（老库没有这个字段）', () => {
    applySettingsToDom(settingsWith(undefined) as never)
    expect(document.documentElement.dataset.motion).toBeUndefined()
  })

  it('reduced / off 如实写到 <html data-motion>', () => {
    applySettingsToDom(settingsWith('reduced') as never)
    expect(document.documentElement.dataset.motion).toBe('reduced')

    applySettingsToDom(settingsWith('off') as never)
    expect(document.documentElement.dataset.motion).toBe('off')
  })

  it('从 off 切回 full 会摘掉属性（不能残留上一个档位）', () => {
    applySettingsToDom(settingsWith('off') as never)
    expect(document.documentElement.dataset.motion).toBe('off')

    applySettingsToDom(settingsWith('full') as never)
    expect(document.documentElement.dataset.motion).toBeUndefined()
  })

  it('不影响同一函数里写的 data-skin（两件事互不干扰）', () => {
    applySettingsToDom(settingsWith('off') as never)
    expect(document.documentElement.dataset.skin).toBeTruthy()
    expect(document.documentElement.dataset.motion).toBe('off')
  })
})

describe('动效强度 · 档位与 CSS 选择器必须一一对应', () => {
  const css = read('src/styles/index.css').replace(/\/\*[\s\S]*?\*\//g, '')

  it('MOTION_PRESETS 恰好覆盖 CSS 定义的选择器集合', () => {
    const ids = MOTION_PRESETS.map((m) => m.id)
    expect(ids).toEqual(['full', 'reduced', 'off'])
    // reduced / off 必须在 CSS 里有对应选择器；full 刻意没有（= 缺省态）
    expect(css).toContain("[data-motion='reduced']")
    expect(css).toContain("[data-motion='off']")
    expect(css).not.toContain("[data-motion='full']")
  })

  it('DEFAULT_SETTINGS 默认全效（老用户升级即改造前手感，零突变）', () => {
    expect(DEFAULT_SETTINGS.appearance.motion).toBe('full')
  })
})
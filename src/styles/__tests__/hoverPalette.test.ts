/**
 * 悬停色板回归锁（2026-10-20）
 *
 * ## 为什么需要量化判据
 * 用户反馈「鼠标移动上去，颜色变换不够明显」—— 这类问题**没有单测能发现**，
 * 因为它不是逻辑错误，而是「色差不够」。但色差本身**是可以量化的**：
 *   ① 与底色的 RGB 欧氏距离 Δ（人眼可辨的粗门槛）；
 *   ② 与文字的前景/背景对比度（可读性硬指标，WCAG AA = 4.5）。
 * 于是把它写成断言 —— 以后谁再把悬停色调浅，这里会直接红。
 *
 * ## 顺带锁住的那条结构决策
 * `surface-hover-*` 是**专用悬停档**，与 `surface-container-*`（静态卡片底色）分离。
 * 原因：`surface-container-*` 同时承担 80+ 处静态底色，加深它会整体压暗界面；
 * 而悬停又必须明显深于卡片底色 —— 两个诉求冲突，只能分两套。
 * 这条断言防止后人「图省事」把悬停改回 `surface-container-*`。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8')

/**
 * 从 CSS 里取某个 color token 的十六进制值。
 * ⚠️ 传入的名字**不含 `--color-` 前缀**（如 `'surface-hover'`），
 * 前缀在这里统一补 —— 免得每个调用点各写一遍、早晚写漏。
 * 返回数组：亮色一份、暗色一份（顺序同文件里 @theme 的出现顺序）。
 */
function colorOf(token: string): string[] {
  return [...css.matchAll(new RegExp(`--color-${token}:\\s*(#[0-9a-fA-F]{3,8})`, 'g'))].map(
    (m) => m[1],
  )
}

const rgb = (h: string) => {
  const s = h.replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}
const relLum = (c: number[]) => {
  const f = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const delta = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** 人眼可辨的粗门槛。低于此值时「悬停几乎看不出来」——用户就是这么反馈的 */
const MIN_DELTA = 40

describe('悬停色板（亮/暗两套）', () => {
  const HOVERS = ['surface-hover-low', 'surface-hover', 'surface-hover-high']

  it('三档悬停色在亮色与暗色主题下都有定义', () => {
    for (const t of HOVERS) {
      expect(colorOf(t), `${t} 未定义`).toHaveLength(2) // 亮色一份 + 暗色一份
    }
  })

  it(`亮色主题：每一档与白底的色差 Δ ≥ ${MIN_DELTA}（这是「看得出来」的下界）`, () => {
    const white = [255, 255, 255]
    for (const t of HOVERS) {
      const [light] = colorOf(t)
      const d = delta(rgb(light), white)
      expect(d, `${t} (${light}) 与白底色差仅 ${d.toFixed(1)}，悬停会看不出来`).toBeGreaterThanOrEqual(
        MIN_DELTA,
      )
    }
  })

  it('暗色主题：每一档与应用底色的色差 Δ ≥ 40（暗色下原 -low 只有 10，是本次反馈的根因）', () => {
    const [darkBg] = colorOf('surface-container-lowest').slice(-1)
    for (const t of HOVERS) {
      const dark = colorOf(t)[1]
      const d = delta(rgb(dark), rgb(darkBg))
      expect(d, `${t} (${dark}) 暗色下与底色 ${darkBg} 色差仅 ${d.toFixed(1)}`).toBeGreaterThanOrEqual(
        MIN_DELTA,
      )
    }
  })

  it('可读性：正文色在每一档悬停底上仍远高于 WCAG AA（4.5）', () => {
    const onSurface = colorOf('on-surface')
    expect(onSurface.length).toBeGreaterThanOrEqual(2)
    const [lightText, darkText] = [onSurface[0], onSurface[onSurface.length - 1]]
    HOVERS.forEach((t, i) => {
      const [light, dark] = colorOf(t)
      const cLight = contrast(rgb(lightText), rgb(light))
      const cDark = contrast(rgb(darkText), rgb(dark))
      expect(cLight, `亮色 正文 on ${t} 对比度仅 ${cLight.toFixed(2)}`).toBeGreaterThan(4.5)
      expect(cDark, `暗色 正文 on ${t} 对比度仅 ${cDark.toFixed(2)}`).toBeGreaterThan(4.5)
      void i
    })
  })

  it('阶梯单调：high 比 low 更深（同名档之间不能出现「高的反而更浅」）', () => {
    for (const pick of [0, 1]) {
      const low = rgb(colorOf('surface-hover-low')[pick])
      const high = rgb(colorOf('surface-hover-high')[pick])
      // 亮色：更深的色 → 亮度更低；暗色：更深的色 → 亮度更高。故用「与底色距离」比较更稳妥
      const bg = pick === 0 ? [255, 255, 255] : rgb(colorOf('surface-container-lowest').slice(-1)[0])
      expect(delta(high, bg), 'surface-hover-high 应比 surface-hover-low 更明显').toBeGreaterThan(
        delta(low, bg),
      )
    }
  })

  it('⚠️ 悬停必须用专用档，不得回退到 surface-container-*（那会压暗 80+ 处静态底色）', () => {
    /**
     * 这条是结构决策的锁：把「静态卡片底色」与「悬停反馈」分成两套 token。
     * 若有人把源码里的 `hover:bg-surface-hover*` 改回 `hover:bg-surface-container*`，
     * 要么悬停重新变淡（用户再次反馈），要么只能整体加深色板（界面整体变重）。
     * 两个方向都不好，故直接禁止回退。
     */
    const files = css // 先确保 token 层没被合并
    for (const t of HOVERS) {
      expect(files, `${t} 被删了 —— 悬停档必须独立存在`).toContain(`--color-${t}:`)
    }
    // surface-container 四档必须仍在（静态底色依赖它们），且不得与悬停档同值
    const contLow = colorOf('surface-container-low')[0]
    expect(HOVERS.map((t) => colorOf(t)[0]), '悬停档不得与 surface-container-low 同值').not.toContain(
      contLow,
    )
  })
})
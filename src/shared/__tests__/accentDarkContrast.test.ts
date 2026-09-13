import { describe, it, expect } from 'vitest'
import {
  ACCENT_PRESETS,
  THEME_STYLES,
  DARK_PRIMARY_KEEP_PCT,
  DARK_ON_PRIMARY_KEEP_PCT,
} from '../theme'

/**
 * 深色模式下强调色的可访问性回归锁（功能测试 #79 / 缺陷 D9）。
 *
 * 原缺陷：`--color-primary` 在深色下仍是 ACCENT_PRESETS 的浅色底主色（≈tone 40），
 * 压在 `surface(#0b1220)` 上对比度 ≈2.5、压在 `primary-fixed`（深色派生的深蓝容器底）
 * 上仅 ≈1.8 —— 侧栏选中项与链接几乎看不清。
 *
 * 修复口径：深色下 `--color-primary` 混白提亮（Material 3 tonality 提升），
 * 同时 `--color-on-primary` 混黑反转（提亮后的主色上必须压深字）。
 * 本测试对「12 套强调色 × 12 套配色主题」全组合验算，任何常量调整都必须先过这一关。
 */

/* ---------- 颜色工具：与 CSS `color-mix(in srgb, A p%, B)` 同口径（sRGB 编码值线性插值） ---------- */

type Rgb = [number, number, number]

function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}

function mixAtPct(aHex: string, bHex: string, aPct: number): Rgb {
  const a = parseHex(aHex)
  const b = parseHex(bHex)
  const p = aPct / 100
  return [0, 1, 2].map((i) => Math.round(p * a[i] + (1 - p) * b[i])) as Rgb
}

function relLum([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/* ---------- 深色侧底色的取值口径（与 effects.ts / index.css 保持一致） ---------- */

/** 主题未覆盖 surface 时回退 index.css 的 .dark token */
const CSS_DARK_SURFACE = '#0b1220'
/** primary-fixed 的混合底：effects.ts 用 `styleVars['surface-container'] ?? '#0f172a'` */
const CSS_DARK_CONTAINER_FALLBACK = '#0f172a'

/** 深色下该主题的 primary-fixed 实际背景（= color-mix(container 16%, 容器底)） */
function darkPrimaryFixed(accentContainer: string, themeDark: { [k: string]: string | undefined }) {
  const base = themeDark['surface-container'] ?? CSS_DARK_CONTAINER_FALLBACK
  return mixAtPct(accentContainer, base, 16)
}

function darkSurface(themeDark: { [k: string]: string | undefined }): Rgb {
  return parseHex(themeDark.surface ?? CSS_DARK_SURFACE)
}

const AA = 4.5
/** 全部「强调色 × 配色主题」组合 */
const combos = ACCENT_PRESETS.flatMap((accent) =>
  THEME_STYLES.map((theme) => ({ accent, theme, dark: theme.dark as Record<string, string | undefined> })),
)

describe('深色模式强调色对比度（D9）', () => {
  it('常量处于「全组合达标」的口径上（改动请重跑本文件）', () => {
    expect(DARK_PRIMARY_KEEP_PCT).toBe(45)
    expect(DARK_ON_PRIMARY_KEEP_PCT).toBe(22)
    expect(combos.length).toBe(ACCENT_PRESETS.length * THEME_STYLES.length)
  })

  it('主色压在深色 surface 上均达 AA（链接 / 图标 / 强调文字）', () => {
    const bad: string[] = []
    for (const { accent, theme, dark } of combos) {
      const primary = mixAtPct(accent.primary, '#ffffff', DARK_PRIMARY_KEEP_PCT)
      const r = contrast(primary, darkSurface(dark))
      if (r < AA) bad.push(`${theme.id}/${accent.id} = ${r.toFixed(2)}`)
    }
    expect(bad).toEqual([])
  })

  it('主色压在 primary-fixed（选中项底）上均达 AA —— 缺陷 D9 的直接断言', () => {
    const bad: string[] = []
    for (const { accent, theme, dark } of combos) {
      const primary = mixAtPct(accent.primary, '#ffffff', DARK_PRIMARY_KEEP_PCT)
      const r = contrast(primary, darkPrimaryFixed(accent.container, dark))
      if (r < AA) bad.push(`${theme.id}/${accent.id} = ${r.toFixed(2)}`)
    }
    expect(bad).toEqual([])
  })

  it('on-primary 压在提亮后的主色上均达 AA（按钮 / 导航激活项）', () => {
    const bad: string[] = []
    for (const { accent, theme } of combos) {
      const primary = mixAtPct(accent.primary, '#ffffff', DARK_PRIMARY_KEEP_PCT)
      const onPrimary = mixAtPct(accent.primary, '#000000', DARK_ON_PRIMARY_KEEP_PCT)
      const r = contrast(onPrimary, primary)
      if (r < AA) bad.push(`${theme.id}/${accent.id} = ${r.toFixed(2)}`)
    }
    expect(bad).toEqual([])
  })

  it('回归说明：修复前的口径（深色下直接用浅色主色）本就不达标', () => {
    // 记录缺陷数值，防止有人把深色分支去掉后误以为「原本也能看」
    const fixed = darkPrimaryFixed('#2563eb', {})
    expect(contrast(parseHex('#004ac6'), fixed)).toBeLessThan(2.5)
    expect(contrast(parseHex('#004ac6'), parseHex(CSS_DARK_SURFACE))).toBeLessThan(3)
  })

  it('提亮方向正确：修后主色比修前更亮（不是反向调暗）', () => {
    for (const accent of ACCENT_PRESETS) {
      const refined = mixAtPct(accent.primary, '#ffffff', DARK_PRIMARY_KEEP_PCT)
      expect(relLum(refined)).toBeGreaterThan(relLum(parseHex(accent.primary)))
    }
  })
})

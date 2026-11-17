import { describe, expect, it } from 'vitest'
import { feedAppearance, MODULE_THEMES, moduleForPath } from '../moduleTheme'
import { THEME_STYLES } from '../theme'

describe('页面与事件共用模块配色', () => {
  it.each([
    ['/', 'dashboard'], ['/todo', 'todo'], ['/notes/folder', 'notes'],
    ['/crm/contact/timeline', 'crm'], ['/record/transactions/1', 'finance'],
    ['/records/projects/1', 'projects'], ['/module-config/crm/intimacy', 'crm'],
    ['/operations/1', 'timeline'], ['/todo-archive', 'dashboard'],
    ['/record/constructor/1', 'timeline'], ['/__proto__', 'dashboard'],
  ])('深链 %s 继承所属模块，不进行任意前缀匹配', (path, module) => {
    expect(moduleForPath(path)).toBe(module)
  })

  it('事实来源优先，任意类别不能把待办变化或独立收支误涂成其他模块', () => {
    expect(feedAppearance({ sourceType: 'task_change', record: { category: 'finance' } }).module).toBe('todo')
    expect(feedAppearance({ sourceType: 'legacy_finance', record: { category: 'note', type: 'expense' } }))
      .toMatchObject({ module: 'finance', label: '独立收支 · 支出' })
    expect(feedAppearance({ sourceType: 'activity', record: { category: 'expense' } }))
      .toMatchObject({ module: 'finance', label: '经历 · 支出' })
  })

  it('活动分类与模块颜色一致，未知类别保留原文字并安全回退', () => {
    expect(feedAppearance({ record: { category: ' Communication ' } })).toMatchObject({ module: 'crm', label: '联系沟通' })
    expect(feedAppearance({ record: { category: '笔记' } }).module).toBe('notes')
    for (const category of ['散步', 'constructor', '__proto__']) {
      expect(feedAppearance({ record: { category } })).toMatchObject({ module: 'timeline', label: category })
    }
    expect(feedAppearance({ record: { table: 'constructor' } })).toMatchObject({ module: 'timeline', label: '经历' })
  })
})

type Rgb = number[]
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
function contrast(a: Rgb, b: Rgb) {
  const luminance = (color: Rgb) => color.map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
  const light = luminance(a), dark = luminance(b)
  return (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05)
}

it('模块色在各主题明暗背景、类型徽章和主按钮上保持可读', () => {
  const bad: string[] = []
  for (const [module, colors] of Object.entries(MODULE_THEMES)) {
    for (const mode of ['light', 'dark'] as const) {
      const primary = rgb(colors[mode])
      const foreground = rgb(mode === 'dark' ? '#111827' : '#ffffff')
      if (contrast(primary, foreground) < 4.5) bad.push(`${module}/${mode}/button`)
      for (const theme of THEME_STYLES) {
        const vars = theme[mode] as Record<string, string>
        const surface = rgb(vars.surface || (mode === 'dark' ? '#0b1220' : '#f8f9ff'))
        const card = rgb(vars['surface-container-lowest'] || (mode === 'dark' ? '#101828' : '#ffffff'))
        const pct = mode === 'dark' ? .14 : .12
        const badge = card.map((v, i) => primary[i] * pct + v * (1 - pct))
        for (const [name, bg] of [['surface', surface], ['card', card], ['badge', badge]] as const) {
          const ratio = contrast(primary, bg)
          if (ratio < 4.5) bad.push(`${module}/${mode}/${theme.id}/${name}: ${ratio.toFixed(2)}`)
        }
      }
    }
  }
  expect(bad).toEqual([])
})

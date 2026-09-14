/**
 * 选中态文本对比度回归（缺陷 D14 的同源问题）
 *
 * 现象（2026-09-14 线上实测，玻璃风格）：
 *   记账抽屉里资金渠道下拉的「未指定」行是**选中行**，父按钮已按选中态给了
 *   `bg-primary-fixed text-primary`（实测 6.0:1 浅 / 6.12:1 暗，达标），
 *   但内层标签 span 又硬编码了一个 `text-outline`，把父级的 primary 覆盖掉 ——
 *   实测降到 **3.92:1（浅）/ 3.25:1（暗），低于 AA 4.5**。
 *
 * 这是「父子两级都写颜色、子级把父级的语义盖掉」的典型形状：父级表达「我是选中态」，
 * 子级却按「我是次要文字」上色，两者冲突时以子级为准，于是选中态的可读性被悄悄削掉。
 *
 * 本测做**源码扫描**（jsdom 算不了 CSS 对比度，故锁写法而不锁数值）：
 *   ① 「未指定」选项行的标签不得硬编码 `text-outline`（应继承按钮态）；
 *   ② 触发器空态用的是 `text-on-surface-variant` 而不是 `text-outline`
 *      —— 空态显示的是**该字段当前生效的值**（`''` = 未指定），属正文内容，
 *      不能按 CSS 占位符的灰度处理（占位符那套灰度在玻璃深色下只有 4.44:1）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(process.cwd(), 'src/design-system/ChannelSelect.tsx'), 'utf8')

describe('ChannelSelect 选中态 / 空态的配色纪律（D14）', () => {
  it('① 「未指定」选项行的标签不自带颜色类（继承按钮的选中态 text-primary）', () => {
    const lines = SRC.split('\n')
    const idx = lines.findIndex((l) => l.includes('{placeholder}') && l.includes('truncate'))
    expect(idx).toBeGreaterThan(-1)
    const line = lines[idx]
    expect(line).not.toContain('text-outline')
    expect(line).not.toContain('text-on-surface')
  })

  it('② 触发器的空态文本用 text-on-surface-variant（正文语义，不能按占位符灰度）', () => {
    expect(SRC).toMatch(/selected \? '' : 'text-on-surface-variant'/)
    expect(SRC).not.toMatch(/selected \? '' : 'text-outline'/)
  })

  it('③ 选中态的底色与字色仍在父按钮上成对出现（bg-primary-fixed + text-primary）', () => {
    // 两处（未指定行 / 各渠道选项行）都应保留这对组合；少一处就说明有人把选中态样式拆散了
    const hits = SRC.match(/bg-primary-fixed text-primary/g) || []
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })
})

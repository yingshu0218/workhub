/**
 * 功能配置注册表（`moduleConfig/registry.ts`）—— 配置页的结构锁。
 *
 * 为什么补（2026-10-26 审计）：`modules/moduleConfig` 此前零专属测试，而它是
 * `/module-config/:moduleId/:itemId` 深链的**唯一路由事实源** —— 注册表里 id 重名，
 * 深链就会落到错的配置面板且不报错；item 缺 label/desc，左栏会出现空条目。
 * 这些都不是「看起来像 bug」的失败，而是「看起来正常但内容不对」。
 */
import { describe, it, expect } from 'vitest'
import { MODULE_CONFIGS, firstModuleItem } from '../registry'

describe('MODULE_CONFIGS 结构不变量', () => {
  it('至少有一个模块且每个模块至少有一个子项（空模块会让左栏出现死条目）', () => {
    expect(MODULE_CONFIGS.length).toBeGreaterThan(0)
    for (const m of MODULE_CONFIGS) {
      expect(m.items.length, `模块 ${m.id} 无子项`).toBeGreaterThan(0)
    }
  })

  it('模块 id 全局唯一（URL 第一段）', () => {
    const ids = MODULE_CONFIGS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('同一模块内子项 id 唯一（URL 第二段）', () => {
    for (const m of MODULE_CONFIGS) {
      const ids = m.items.map((i) => i.id)
      expect(new Set(ids).size, `模块 ${m.id} 内子项 id 重复`).toBe(ids.length)
    }
  })

  it('每个子项的展示字段齐备（label/icon/desc 非空）', () => {
    for (const m of MODULE_CONFIGS) {
      expect(m.label.trim()).not.toBe('')
      expect(m.icon.trim()).not.toBe('')
      for (const item of m.items) {
        expect(item.label.trim(), `${m.id}/${item.id} label 为空`).not.toBe('')
        expect(item.icon.trim(), `${m.id}/${item.id} icon 为空`).not.toBe('')
        expect(item.desc.trim(), `${m.id}/${item.id} desc 为空`).not.toBe('')
      }
    }
  })

  it('每个子项都挂着可渲染的组件（深链不会白屏）', () => {
    for (const m of MODULE_CONFIGS) {
      for (const item of m.items) {
        expect(['function', 'object'], `${m.id}/${item.id} component 非法`).toContain(typeof item.component)
      }
    }
  })
})

describe('firstModuleItem：空路由兜底', () => {
  it('返回第一个模块的第一个子项，且能在注册表里定位（深链可达）', () => {
    const first = firstModuleItem()
    expect(first).toBeTruthy()
    const mod = MODULE_CONFIGS.find((m) => m.id === first!.moduleId)
    expect(mod).toBeTruthy()
    const item = mod!.items.find((i) => i.id === first!.itemId)
    expect(item).toBeTruthy()
  })

  it('兜底目标就是注册表原文（不是另一套硬编码）', () => {
    const first = firstModuleItem()
    expect(first!.moduleId).toBe(MODULE_CONFIGS[0].id)
    expect(first!.itemId).toBe(MODULE_CONFIGS[0].items[0].id)
  })
})

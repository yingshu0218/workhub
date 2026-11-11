/**
 * 移动端底部导航选中态判定。
 *
 * 口径与桌面侧栏（navActive.test.ts）同构，但**刻意不是同一份实现**：
 * 侧栏是「一个菜单 vs 一个路径」，底部导航是「一个 Tab vs 一组路径前缀」。
 * 这里钉住三类容易错的边界：
 * 1. `'/'` 必须精确匹配 —— 否则「工作台」在任何页面都高亮
 * 2. 二级页（/todo、/notes、/projects）必须归到「工作台」—— 否则点了谁都不亮
 * 3. `/crm-extra` 这种「同类前缀」不能误判为「客户」
 */
import { describe, it, expect } from 'vitest'
import { isMobileTabActive, MOBILE_TABS } from '../MobileTabBar'

const WORKBENCH = MOBILE_TABS[0].matches
const CRM = MOBILE_TABS[2].matches
const PROFILE = MOBILE_TABS[4].matches

describe('移动端底部导航：Tab 选中判定', () => {
  it('「工作台」只认根路径，别的页面不误高亮', () => {
    expect(isMobileTabActive('/', WORKBENCH)).toBe(true)
    expect(isMobileTabActive('/finance', WORKBENCH)).toBe(false)
    expect(isMobileTabActive('/crm', WORKBENCH)).toBe(false)
  })

  it('二级页归到「工作台」：待办 / 笔记 / 项目（含子路由）', () => {
    expect(isMobileTabActive('/todo', PROFILE)).toBe(true)
    expect(isMobileTabActive('/notes/n1', PROFILE)).toBe(true)
    expect(isMobileTabActive('/projects/p1', PROFILE)).toBe(true)
  })

  it('「客户」含画布 / 详情 / 时间线等子路由', () => {
    expect(isMobileTabActive('/crm', CRM)).toBe(true)
    expect(isMobileTabActive('/crm/canvas', CRM)).toBe(true)
    expect(isMobileTabActive('/crm/c1/timeline', CRM)).toBe(true)
    expect(isMobileTabActive('/crm-extra', CRM)).toBe(false)
  })

  it('「我的」收拢个人主页 / 奖杯 / 设置 / 功能配置', () => {
    expect(isMobileTabActive('/profile', PROFILE)).toBe(true)
    expect(isMobileTabActive('/trophies', PROFILE)).toBe(true)
    expect(isMobileTabActive('/settings', PROFILE)).toBe(true)
    expect(isMobileTabActive('/module-config/crm/intimacy', PROFILE)).toBe(true)
  })

  it('灵感收拢到更多，事件详情归时间线',()=>{expect(isMobileTabActive('/inspiration',PROFILE)).toBe(true);expect(isMobileTabActive('/activities/a',MOBILE_TABS[1].matches)).toBe(true)})

  it('任一页面只点亮一个 Tab（防止一个路径点亮两个）', () => {
    const paths = [
      '/',
      '/todo',
      '/notes/n1',
      '/projects/p1',
      '/crm',
      '/crm/c1',
      '/crm/canvas',
      '/finance',
      '/habits',
      '/profile',
      '/trophies',
      '/settings',
      '/module-config',
    ]
    for (const p of paths) {
      const hits = MOBILE_TABS.filter((t) => isMobileTabActive(p, t.matches))
      expect(hits.length, `路径 ${p} 命中了 ${hits.length} 个 Tab`).toBe(1)
    }
  })
})

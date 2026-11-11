/**
 * 侧栏选中态判定对照测试（Issue #128：「菜单选中以后色块高亮效果一直存在」）
 *
 * 根因回归：NavLink 默认 isActive 为前缀匹配，进入 /module-config、/crm/canvas 等
 * 更长路径时，已离开的菜单仍被判为 active，色块一直挂着。
 * 此处直接对手写判定函数做断言（组件内使用同一函数）。
 */
import { describe, it, expect } from 'vitest'
import { isNavItemActive } from '../AppLayout'

describe('侧栏选中判定：跨模块不再误高亮', () => {
  it('待办事项在进入功能配置/系统设置后必须失去高亮', () => {
    expect(isNavItemActive('/todo', '/todo')).toBe(true)
    expect(isNavItemActive('/module-config', '/todo')).toBe(false)
    expect(isNavItemActive('/module-config/crm/intimacy', '/todo')).toBe(false)
    expect(isNavItemActive('/settings', '/todo')).toBe(false)
  })

  it('「/todo/xxx」这类历史更深路径也不再高亮待办（精确口径）', () => {
    expect(isNavItemActive('/todo/detail', '/todo')).toBe(false)
  })

  it('工作台仅根路径高亮', () => {
    expect(isNavItemActive('/', '/')).toBe(true)
    expect(isNavItemActive('/todo', '/')).toBe(false)
  })

  it('受控子路径菜单：客户管理 / 项目 保留子路由高亮', () => {
    expect(isNavItemActive('/crm', '/crm')).toBe(true)
    expect(isNavItemActive('/crm/canvas', '/crm')).toBe(true)
    expect(isNavItemActive('/crm/c1/timeline', '/crm')).toBe(true)
    expect(isNavItemActive('/notes/n1', '/notes')).toBe(true)
    // 但不越界到「同类前缀」的其它模块
    expect(isNavItemActive('/crm-extra', '/crm')).toBe(false)
  })

  it('功能配置子路由仍高亮功能配置，且不与其它菜单互串', () => {
    expect(isNavItemActive('/module-config', '/module-config')).toBe(true)
    expect(isNavItemActive('/module-config/crm/intimacy', '/module-config')).toBe(true)
    expect(isNavItemActive('/module-config', '/settings')).toBe(false)
  })
})

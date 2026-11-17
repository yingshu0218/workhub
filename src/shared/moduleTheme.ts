import type { CSSProperties } from 'react'

/** 同一模块在导航、页面和时间线中沿用同一个色相；状态色仍由原有 success/danger 表达。 */
export const MODULE_THEMES = {
  dashboard: { label: '工作台', icon: 'dashboard', light: '#1d4ed8', dark: '#93c5fd' },
  todo: { label: '待办事项', icon: 'check_circle', light: '#854d0e', dark: '#fcd34d' },
  finance: { label: '收支管理', icon: 'account_balance_wallet', light: '#047857', dark: '#6ee7b7' },
  crm: { label: '联系人', icon: 'group', light: '#be185d', dark: '#f9a8d4' },
  notes: { label: '笔记', icon: 'description', light: '#7e22ce', dark: '#d8b4fe' },
  projects: { label: '事项', icon: 'folder', light: '#4338ca', dark: '#a5b4fc' },
  timeline: { label: '时间线', icon: 'timeline', light: '#0e7490', dark: '#67e8f9' },
  graph: { label: '关系图谱', icon: 'hub', light: '#0f766e', dark: '#5eead4' },
  inspiration: { label: '灵感闪现', icon: 'bolt', light: '#9a3412', dark: '#fdba74' },
  settings: { label: '系统设置', icon: 'settings', light: '#475569', dark: '#cbd5e1' },
  profile: { label: '个人主页', icon: 'person', light: '#6d28d9', dark: '#c4b5fd' },
  trash: { label: '回收站', icon: 'settings_backup_restore', light: '#4b5563', dark: '#d1d5db' },
  more: { label: '更多', icon: 'menu_book', light: '#475569', dark: '#cbd5e1' },
} as const

export type ModuleThemeId = keyof typeof MODULE_THEMES

const TABLE_MODULES: Record<string, ModuleThemeId> = {
  todos: 'todo', todoLists: 'todo', transactions: 'finance', ledgers: 'finance',
  customers: 'crm', customerGroups: 'crm', notes: 'notes', noteFolders: 'notes',
  projects: 'projects', projectMilestones: 'projects', activities: 'timeline', interactions: 'timeline',
}

export function moduleForPath(pathname: string): ModuleThemeId {
  const [, first, second] = pathname.split('/')
  if (!first) return 'dashboard'
  if (first === 'record' || first === 'records') return Object.hasOwn(TABLE_MODULES, second) ? TABLE_MODULES[second] : 'timeline'
  if (first === 'activities' || first === 'operations' || first === 'interactions') return 'timeline'
  if (first === 'module-config') return second === 'crm' ? 'crm' : 'settings'
  return Object.hasOwn(MODULE_THEMES, first) ? first as ModuleThemeId : 'dashboard'
}

export function moduleThemeStyle(module: ModuleThemeId): CSSProperties {
  const theme = MODULE_THEMES[module]
  return { '--module-light': theme.light, '--module-dark': theme.dark } as CSSProperties
}

const ACTIVITY_CATEGORIES: Record<string, { module: ModuleThemeId; label: string }> = {
  communication: { module: 'crm', label: '联系沟通' },
  沟通: { module: 'crm', label: '沟通' }, 联系: { module: 'crm', label: '联系' },
  拜访: { module: 'crm', label: '拜访' }, meeting: { module: 'crm', label: '会面' },
  finance: { module: 'finance', label: '收支' }, 收支: { module: 'finance', label: '收支' },
  income: { module: 'finance', label: '收入' }, expense: { module: 'finance', label: '支出' },
  收款: { module: 'finance', label: '收款' }, 付款: { module: 'finance', label: '付款' },
  task: { module: 'todo', label: '待办' }, 待办: { module: 'todo', label: '待办' },
  commitment: { module: 'todo', label: '承诺' }, 承诺: { module: 'todo', label: '承诺' },
  note: { module: 'notes', label: '笔记' }, 笔记: { module: 'notes', label: '笔记' },
  project: { module: 'projects', label: '事项' }, 项目: { module: 'projects', label: '项目' },
  事项: { module: 'projects', label: '事项' }, milestone: { module: 'projects', label: '里程碑' },
  inspiration: { module: 'inspiration', label: '灵感' }, 灵感: { module: 'inspiration', label: '灵感' },
}

export function feedAppearance(item: Record<string, unknown>) {
  const record = (item.record || item) as Record<string, unknown>
  if (item.sourceType === 'task_change') return { module: 'todo' as const, label: '承诺变化', icon: 'check_circle' }
  if (item.sourceType === 'legacy_finance' || record.table === 'transactions') {
    return { module: 'finance' as const, label: record.type === 'income' ? '独立收支 · 收入' : record.type === 'expense' ? '独立收支 · 支出' : '独立收支', icon: 'account_balance_wallet' }
  }
  const category = typeof record.category === 'string' ? record.category.trim() : ''
  const key = category.toLowerCase()
  const known = Object.hasOwn(ACTIVITY_CATEGORIES, key) ? ACTIVITY_CATEGORIES[key] : undefined
  const label = (value: string) => item.sourceType === 'activity' || record.table === 'activities' ? `经历 · ${value}` : value
  if (known) return { ...known, label: label(known.label), icon: MODULE_THEMES[known.module].icon }
  const table = String(record.table)
  const module = Object.hasOwn(TABLE_MODULES, table) ? TABLE_MODULES[table] : 'timeline'
  return { module, label: category ? label(category) : (module === 'timeline' ? '经历' : MODULE_THEMES[module].label), icon: MODULE_THEMES[module].icon }
}

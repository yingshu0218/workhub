import type { ComponentType } from 'react'
import CrmIntimacyConfig from './CrmIntimacyConfig'

/**
 * 功能配置注册表（Issue #86）—— 业务模块的规则配置统一入口。
 * 每个业务模块一条注册项，模块下可挂多个配置子项（子菜单），新增模块只加注册项，页面骨架零改动。
 *
 * 边界（与系统设置 /settings 硬切分）：
 * - 功能配置 = 「数据怎么算 / 怎么显示」→ 写 moduleConfigs 同步表，换设备必须一致
 * - 系统设置 = 「应用长什么样 / 怎么跑」→ 写 settings singleton，本地偏好不进同步
 * 判据一句话：改它会不会改变数据算出来的结果？会 → 功能配置；只是界面/通道/存储策略 → 系统设置。
 */

export interface ModuleConfigItem {
  /** 子项 id（URL 段，如 intimacy → /module-config/crm/intimacy） */
  id: string
  /** 子菜单显示名 */
  label: string
  /** Material Symbols 图标名（须已存在于 src/assets/icons） */
  icon: string
  /** 子项一句话说明 */
  desc: string
  /** 配置面板组件 */
  component: ComponentType
}

export interface ModuleConfigEntry {
  /** 模块 id（URL 段，与侧栏业务模块对齐） */
  id: string
  /** 模块显示名 */
  label: string
  icon: string
  /** 子菜单（配置子项），空则整模块不渲染 */
  items: ModuleConfigItem[]
}

export const MODULE_CONFIGS: ModuleConfigEntry[] = [
  {
    id: 'crm',
    label: '客户管理',
    icon: 'group',
    items: [
      {
        id: 'intimacy',
        label: '亲密度',
        icon: 'favorite',
        desc: '等级名称与判据、黑名单屏蔽范围、算法兜底权重与切档阈值',
        component: CrmIntimacyConfig,
      },
    ],
  },
]

/** 首个可直达的配置项（空态兜底 / 默认选中） */
export function firstModuleItem(): { moduleId: string; itemId: string } | undefined {
  for (const m of MODULE_CONFIGS) {
    const item = m.items[0]
    if (item) return { moduleId: m.id, itemId: item.id }
  }
  return undefined
}

export function findModule(id: string | undefined): ModuleConfigEntry | undefined {
  return MODULE_CONFIGS.find((m) => m.id === id)
}

export function findItem(
  moduleId: string | undefined,
  itemId: string | undefined,
): ModuleConfigItem | undefined {
  return findModule(moduleId)?.items.find((i) => i.id === itemId)
}

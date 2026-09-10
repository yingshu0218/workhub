import type { ComponentType } from 'react'
import CrmIntimacyConfig from './CrmIntimacyConfig'

/**
 * 功能配置模块注册表（Issue #86 收敛稿）
 *
 * 「功能配置」承载各业务模块的业务判据配置（亲密度权重、黑名单策略等），
 * 存 moduleConfigs 同步表（多端一致）；与「系统设置」（应用全局偏好，
 * 存本地 settings singleton）严格分开。
 *
 * 边界判据：改它会影响「数据算出来的结果」且需多端一致 → 功能配置；
 * 只是界面外观 / 通道 / 本机存储策略 → 系统设置。
 *
 * 新增模块配置 = 在这里追加一条注册项 + 一个子页组件，路由 / 页面骨架零改动；
 * 模块数 ≥2 且出现真实二级配置域时，顶部 Tab 再升级为左侧列表（纯增量）。
 */
export interface ModuleConfigItem {
  /** 配置域 key，与 moduleConfigs 表记录 id 一致（点分：模块名.配置域） */
  key: string
  /** 侧栏 Tab 与页头展示名 */
  label: string
  desc: string
  icon: string
  component: ComponentType
}

export const MODULE_CONFIGS: ModuleConfigItem[] = [
  {
    key: 'crm.intimacy',
    label: '亲密度 · 客户管理',
    desc: '等级名称 / 黑名单屏蔽范围 / 算法兜底权重与切档阈值',
    icon: 'favorite',
    component: CrmIntimacyConfig,
  },
]

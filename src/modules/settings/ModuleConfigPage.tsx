import { useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { PageHeader } from '@/design-system/ui'
import CrmIntimacyConfig from './CrmIntimacyConfig'

/**
 * 功能配置（Issue #86）：独立一级页 /module-config，统一管理各业务模块的业务规则配置，
 * 与「系统设置」（应用全局偏好）严格区分。
 *
 * 结构：注册表 MODULE_CONFIGS 驱动 —— 模块数 =1 时顶部 Tab 退化为单段（不渲染导航条），
 * 右侧/下方直接渲染该模块的全部配置域（当前为三块纵向 Section）。
 * 后续模块数 ≥2 且出现真实二级配置域时，将 Tab 容器升级为左侧列表（纯增量，非重写）。
 * 数据层零改动：moduleConfigs 同步表 / crm.intimacy / hooks / 订阅全部沿用。
 */

/** 模块配置注册表：新增模块只加一条，页面骨架不动 */
const MODULE_CONFIGS = [
  {
    key: 'crm.intimacy',
    label: '客户管理',
    icon: 'group',
    desc: '亲密度等级、黑名单屏蔽、算法兜底与权重',
    render: () => <CrmIntimacyConfig />,
  },
] as const

type ModuleKey = (typeof MODULE_CONFIGS)[number]['key']

export default function ModuleConfigPage() {
  // 单模块起步：注册表长度 >1 才出现模块 Tab（YAGNI，不为假想的第二模块预占导航）
  const [module, setModule] = useState<ModuleKey>(MODULE_CONFIGS[0].key)
  const current = MODULE_CONFIGS.find((m) => m.key === module) ?? MODULE_CONFIGS[0]

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="功能配置"
        subtitle="各业务模块的业务规则配置（随同步多端一致）· 界面主题、快捷键等应用全局偏好请前往系统设置"
      />

      {/* 模块导航：起步单模块不渲染（与「系统设置」的 8→7 Tab 同理，空导航不占位） */}
      {MODULE_CONFIGS.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-1.5 surface-card-xl p-1.5">
          {MODULE_CONFIGS.map((m) => (
            <button
              key={m.key}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[0.9286rem] transition-colors ${
                module === m.key
                  ? 'bg-primary font-semibold text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
              onClick={() => setModule(m.key)}
            >
              <Icon name={m.icon} size={16} />
              {m.label}
            </button>
          ))}
        </div>
      )}

      <p className="mb-4 text-[0.8214rem] text-on-surface-variant">{current.desc}</p>
      {current.render()}
    </div>
  )
}

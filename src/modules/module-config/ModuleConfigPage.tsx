import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import { PageHeader } from '@/design-system/ui'
import { MODULE_CONFIGS } from './registry'

/**
 * 功能配置（Issue #86 收敛稿）
 *
 * 独立一级页面，与「系统设置」职责严格分开：
 * - 功能配置（本页）= 业务模块的业务判据（亲密度权重、黑名单策略…），写 moduleConfigs 同步表
 * - 系统设置 = 应用全局偏好（主题、排版、快捷键、同步…），写本地 settings singleton
 *
 * 导航：模块注册表（registry.ts）派生顶部 Tab。当前仅 CRM 一个配置域，
 * 故只渲染单个 Tab（无假导航）；注册表扩充后 Tab 自动增多。
 */
export default function ModuleConfigPage() {
  const [activeKey, setActiveKey] = useState(MODULE_CONFIGS[0]?.key ?? '')
  const active = MODULE_CONFIGS.find((m) => m.key === activeKey) ?? MODULE_CONFIGS[0]

  // 注册表收缩（如热更/回滚导致当前 key 不存在）时回落到首项
  useEffect(() => {
    if (MODULE_CONFIGS.length && !MODULE_CONFIGS.some((m) => m.key === activeKey)) {
      setActiveKey(MODULE_CONFIGS[0]!.key)
    }
  }, [activeKey])

  if (!active) return null

  const ActivePanel = active.component

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="功能配置"
        subtitle="管理各业务模块的业务规则与判据（如亲密度权重），配置多端同步 · 应用外观 / 快捷键 / 云端同步等全局偏好请在「系统设置」中调整"
      />

      {/* 模块 Tab：注册表派生；单模块时同样渲染，保持结构与后续扩展形态一致 */}
      <div className="mb-5 flex flex-wrap gap-1.5 surface-card-xl p-1.5">
        {MODULE_CONFIGS.map((m) => (
          <button
            key={m.key}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[0.9286rem] transition-colors ${
              m.key === active.key
                ? 'bg-primary font-semibold text-on-primary'
                : 'text-on-surface-variant hover:bg-surface-container'
            }`}
            onClick={() => setActiveKey(m.key)}
          >
            <Icon name={m.icon} size={16} />
            {m.label}
          </button>
        ))}
      </div>

      <ActivePanel />
    </div>
  )
}

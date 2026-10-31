import { Icon } from '@/design-system/Icon'
import { EmptyState, PageHeader } from '@/design-system/ui'
import { NavLink, Navigate, useParams } from 'react-router-dom'
import { MODULE_CONFIGS, findItem, findModule, firstModuleItem } from './registry'

/**
 * 功能配置页（Issue #86）：左栏模块 → 配置子菜单，右侧配置面板。
 * 与「系统设置 /settings」严格区分：这里只管各业务模块的规则配置（写 moduleConfigs 同步表，多端一致），
 * 系统设置只管应用级外观/通知/同步/数据导出等本地偏好（写 settings singleton，不进同步）。
 *
 * 路由 /module-config/:moduleId/:itemId —— 子菜单可直达（书签/⌘K 深链友好）；
 * 只给模块或空路由时重定向到首个可用子项，不留历史垃圾（replace）。
 *
 * 路径命名：页面标题「功能配置」、路径 /module-config（同 /settings 标题「系统设置」）。
 * 不是「谁先提谁赢」——是 /module-config 已随 PR #90/#91 合入主干并写进 README/PROGRESS/开发计划，
 * 后续 PR 改名的边际成本 > 沿用；且三份并行 PR 各用一个名字会在合并顺序变化时造成路由分裂。
 */

export default function ModuleConfigPage() {
  const { moduleId, itemId } = useParams()

  // 补齐路由：只给 moduleId → 首个 itemId；都没给 → 注册表首项
  if (moduleId && !itemId) {
    const first = findModule(moduleId)?.items[0]
    if (first) return <Navigate to={`/module-config/${moduleId}/${first.id}`} replace />
  }
  if (!moduleId || !itemId) {
    const first = firstModuleItem()
    if (first) return <Navigate to={`/module-config/${first.moduleId}/${first.itemId}`} replace />
  }

  const activeModule = findModule(moduleId)
  const activeItem = findItem(moduleId, itemId)
  const ActivePanel = activeItem?.component

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="功能配置"
      />

      {/* ⚠️ 双栏必须带响应式断点（2026-10-21 与待办页同批修）：原为无条件的
          `grid-cols-[232px_1fr]`，窄屏时左栏仍占 232px、右栏被压到百来像素。
          窄屏改单栏堆叠，`lg:` 起恢复双栏（与 TodoPage 同一断点口径）。 */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[232px_1fr]">
        {/* 左栏：模块分组 + 配置子菜单 */}
        <nav className="surface-card-xl sticky top-0 p-2">
          {MODULE_CONFIGS.length === 0 ? (
            <div className="px-3 py-6 text-center text-[0.8571rem] text-outline">
              暂无可配置的模块
            </div>
          ) : (
            MODULE_CONFIGS.map((m) => (
              <div key={m.id} className="mb-2 last:mb-0">
                <div className="flex items-center gap-2 px-2.5 py-2 text-[0.9286rem] font-semibold text-on-surface-variant">
                  <Icon name={m.icon} size={18} className="text-primary" />
                  {m.label}
                </div>
                <div className="space-y-0.5">
                  {m.items.map((it) => (
                    <NavLink
                      key={it.id}
                      to={`/module-config/${m.id}/${it.id}`}
                      className={({ isActive }) =>
                        `block rounded-lg py-2 pl-8 pr-2.5 text-[0.9286rem] transition-colors ${
                          isActive
                            ? 'bg-primary-fixed font-semibold text-primary'
                            : 'text-on-surface-variant hover:bg-surface-hover'
                        }`
                      }
                    >
                      <span className="flex items-center gap-2">
                        <Icon name={it.icon} size={16} />
                        {it.label}
                      </span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* 右侧：当前子项配置面板 */}
        <div className="min-w-0">
          {ActivePanel ? (
            /* key 随路由子项变化 → 换配置项时整块重挂、anim-enter 淡入重播 */
            <div key={`${moduleId}/${itemId}`} className="anim-enter">
              {activeModule && activeItem && (
                <div className="mb-4 flex items-center gap-2 text-[0.9286rem] text-on-surface-variant">
                  <Icon name={activeModule.icon} size={16} className="text-outline" />
                  {activeModule.label}
                  <Icon name="chevron_right" size={16} className="text-outline" />
                  <span className="font-semibold text-on-surface">{activeItem.label}</span>
                </div>
              )}
              <ActivePanel />
            </div>
          ) : (
            <EmptyState
              icon="tune"
              title="该模块暂无可配置项"
              description="业务模块接入功能配置后，这里会出现对应的设置子菜单"
            />
          )}
        </div>
      </div>
    </div>
  )
}

import { Section } from './settingsUi'
import { Button, inputCls } from '@/design-system/ui'
import { listShortcuts } from '@/shared/shortcuts'
import { useNoteFolders } from '@/modules/notes/hooks'
import { DEFAULT_IDENTITY, resetIdentity, setIdentity, useIdentity } from '@/modules/identity'
import type { Settings } from '@/db/types'

/**
 * 「通用与快捷键」tab（**自 SettingsPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 依赖说明：`identity` 与 `noteFolders` 都是**全局单例**（`useIdentity` / `useNoteFolders`），
 * 故本组件自行订阅，不从父组件透传（避免父组件为了透传而持有与自己无关的 state）。
 * 语义与拆分前逐行一致（仅移动代码 + 补齐 import）。
 */
export function ShortcutsTab({
  settings,
  save,
}: {
  settings: Settings
  save: (patch: Partial<Settings>) => void
}) {
  const identity = useIdentity()
  const noteFolders = useNoteFolders()
  // 快捷键清单是静态数据（listShortcuts() 纯函数），随本组件一起搬来
  const shortcuts = listShortcuts()
  return (
        <div className="anim-enter space-y-4">
          {/* 用户身份（Issue #123）：画布「我」节点、侧栏、首页问候、个人主页统一读这里 */}
          <Section
            icon="badge"
            title="用户身份"
            desc="你是谁 —— 画布中心的「我」节点、侧栏账号、首页问候、个人主页都取这里的显示名"
            badge="实时生效"
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <label className="block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  显示名（画布「我」节点标题）
                </div>
                <input
                  className={inputCls}
                  value={identity.name}
                  placeholder={DEFAULT_IDENTITY.name}
                  onChange={(e) => setIdentity({ name: e.target.value })}
                  onBlur={(e) => {
                    // 空值回落默认名，避免把节点文案改成空串
                    if (!e.target.value.trim()) setIdentity({ name: DEFAULT_IDENTITY.name })
                  }}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  工作区名
                </div>
                <input
                  className={inputCls}
                  value={identity.workspace}
                  placeholder={DEFAULT_IDENTITY.workspace}
                  onChange={(e) => setIdentity({ workspace: e.target.value })}
                  onBlur={(e) => {
                    if (!e.target.value.trim())
                      setIdentity({ workspace: DEFAULT_IDENTITY.workspace })
                  }}
                />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIdentity({ name: DEFAULT_IDENTITY.name })}
              >
                恢复默认名（{DEFAULT_IDENTITY.name}）
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resetIdentity()}>
                全部重置
              </Button>
              <span className="text-[0.7857rem] text-outline">
                默认身份：{DEFAULT_IDENTITY.name} · {DEFAULT_IDENTITY.workspace}
              </span>
            </div>
          </Section>

          <Section
            icon="tune"
            title="通用偏好设定"
            desc="General Preferences & Regional Formatting"
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <label className="block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  系统语言 (Language)
                </div>
                <input className={inputCls} value="简体中文 (Simplified Chinese)" readOnly />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  每周起始日
                </div>
                <input className={inputCls} value="星期一 (Monday) · 工作日标配" readOnly />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  时区与时间制
                </div>
                <div className="flex items-center gap-2">
                  <input className={inputCls} value="(GMT+08:00) 北京 · 上海 · 香港" readOnly />
                  <span className="shrink-0 rounded bg-success-container/60 px-2 py-1.5 text-[0.7857rem] font-medium text-success">
                    ● 自动对齐网络授时
                  </span>
                </div>
              </label>
              <label className="block">
                <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                  启动时默认进入的模块
                </div>
                <input className={inputCls} value="工作台专注主页 (Nexus Workbench)" readOnly />
              </label>
            </div>
          </Section>

          <Section
            icon="description"
            title="笔记偏好"
            desc="侧栏快速便签保存笔记时的默认目录（数据流 Issue #70）"
            badge="实时生效"
          >
            <label className="block max-w-md">
              <div className="mb-1.5 text-[0.8571rem] font-medium text-on-surface-variant">
                默认速记目录
              </div>
              <select
                className={inputCls}
                value={settings.notes?.defaultFolderId ?? ''}
                onChange={(e) =>
                  save({
                    notes: {
                      defaultFolderId: e.target.value ? e.target.value : undefined,
                    },
                  })
                }
              >
                <option value="">未归档（根层）</option>
                {noteFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[0.7857rem] leading-snug text-on-surface-variant">
                快速便签每次保存会落一条正式笔记到所选目录，未设则落在「未归档」根层。
              </p>
            </label>
          </Section>

          <Section
            icon="keyboard_command_key"
            title="全局高频热键映射"
            desc="Global Hotkeys Map · 快捷键走统一注册表（listShortcuts 实时读取，Phase 6 只读展示）"
          >
            <table className="w-full text-[0.9286rem]">
              <thead>
                <tr className="border-b border-outline-variant/40 text-left text-[0.8214rem] uppercase tracking-wide text-outline">
                  <th className="pb-2 pr-4 font-semibold">动作名称</th>
                  <th className="pb-2 pr-4 font-semibold">功能描述</th>
                  <th className="pb-2 text-right font-semibold">快捷键绑定</th>
                </tr>
              </thead>
              <tbody>
                {shortcuts.map((s, i) => (
                  <tr
                    key={`${s.combo}-${i}`}
                    className="border-b border-outline-variant/20 last:border-0"
                  >
                    <td className="py-2.5 pr-4 font-medium">{s.description}</td>
                    <td className="py-2.5 pr-4 text-on-surface-variant">
                      {s.scope === 'global' ? '任何页面生效' : '激活页面内生效'}
                    </td>
                    <td className="py-2.5 text-right">
                      <kbd className="rounded-md bg-surface-container-high px-2.5 py-1 text-[0.8571rem] font-semibold text-primary">
                        {s.combo === 'mod+k'
                          ? '⌘ K'
                          : s.combo === 'space'
                            ? 'Space'
                            : s.combo === 'enter'
                              ? 'Enter'
                              : s.combo === 'esc'
                                ? 'Esc'
                                : s.combo}
                      </kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
  )
}

import { useEffect, useState } from 'react'
import { settingsRepo } from '@/repositories/localAdmin'
import { DEFAULT_SETTINGS, type Settings } from '@/db/types'
import { Icon } from '@/design-system/Icon'
import { Section, SkinThumb } from './settingsUi'
import { THEME_STYLES, SKIN_STYLES } from '@/shared/theme'
import { DensityTab, TypographyTab } from './AppearanceTabs'
import { ShortcutsTab } from './ShortcutsTab'
const TABS = [
  ['appearance', '外观与主题'],
  ['density', '色彩与密度'],
  ['typography', '字体与排版'],
  ['shortcuts', '通用与快捷键'],
]
export default function PreferencesPanel() {
  const [tab, setTab] = useState('appearance'),
    [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void settingsRepo
      .get()
      .then((s) => {
        if (active) setSettings(s)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [])
  const save = (patch: Partial<Settings>) => {
    void settingsRepo
      .save(patch)
      .then(setSettings)
      .catch((e) => setError(String(e)))
  }
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="外观与偏好分组">
        {TABS.map(([id, label]) => (
          <button
            aria-pressed={tab === id}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${tab === id ? 'border-primary/30 bg-primary-fixed/40 font-medium text-primary' : 'border-transparent text-on-surface-variant hover:bg-surface-hover'}`}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error ? <p role="alert">{error}</p> : null}
      {/* ── 外观与主题 ── */}
      {tab === 'appearance' && (
        <div className="anim-enter space-y-4">
          <Section icon="texture" title="界面风格" badge="实时生效">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {SKIN_STYLES.map((sk) => {
                const active = (settings.appearance.style ?? 'none') === sk.id
                return (
                  <button
                    key={sk.id}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? 'border-primary bg-primary-fixed/40'
                        : 'border-outline-variant/50 hover:border-primary/50'
                    }`}
                    onClick={() => {
                      const radius =
                        ('radius' in sk ? sk.radius : undefined) ?? settings.appearance.radius
                      save({ appearance: { ...settings.appearance, style: sk.id, radius } })
                    }}
                  >
                    {/* 风格缩略预览：用形态而非色带表达风格差异 */}
                    <div className="mb-3 flex h-16 items-center justify-center overflow-hidden surface-card !bg-transparent">
                      <SkinThumb id={sk.id} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[0.9286rem] font-semibold">{sk.label}</span>
                      {active && (
                        <Icon name="check_circle" fill className="text-[1.2857rem] text-primary" />
                      )}
                    </div>
                    <p className="mt-1 text-[0.7857rem] leading-snug text-on-surface-variant">
                      {sk.desc}
                    </p>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section icon="auto_awesome" title="配色主题" badge="实时生效">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {THEME_STYLES.map((t) => {
                const active = (settings.appearance.theme ?? 'classic') === t.id
                return (
                  <button
                    key={t.id}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? 'border-primary bg-primary-fixed/40'
                        : 'border-outline-variant/50 hover:border-primary/50'
                    }`}
                    onClick={() => {
                      const mode = t.mode === 'dark' ? 'dark' : 'light'
                      save({ appearance: { ...settings.appearance, theme: t.id, mode } })
                    }}
                  >
                    <div className="mb-3 flex h-16 overflow-hidden surface-card !bg-transparent">
                      {t.swatch.map((c, i) => (
                        <div key={i} className="flex-1" style={{ background: c }} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[0.9286rem] font-semibold">{t.label}</span>
                      {active && (
                        <Icon name="check_circle" fill className="text-[1.2857rem] text-primary" />
                      )}
                    </div>
                    <p className="mt-1 text-[0.7857rem] leading-snug text-on-surface-variant">
                      {t.desc}
                    </p>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section icon="palette" title="外观显示模式" badge="实时生效">
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  {
                    id: 'light',
                    label: '浅色模式 (Light)',
                    desc: '经典亮色画布，长时间可视的最佳性与低瞳感',
                  },
                  {
                    id: 'dark',
                    label: '深色模式 (Dark)',
                    desc: '沉浸式暗调素材，大幅降低夜间光线刺激与屏幕能耗',
                  },
                  {
                    id: 'system',
                    label: '跟随系统 (System Sync)',
                    desc: '与 macOS / Windows 系统的深浅日自动同步',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    settings.appearance.mode === opt.id
                      ? 'border-primary bg-primary-fixed/40'
                      : 'border-outline-variant/50 hover:border-primary/50'
                  }`}
                  onClick={() => save({ appearance: { ...settings.appearance, mode: opt.id } })}
                >
                  <div className="mb-3 flex h-16 overflow-hidden surface-card !bg-transparent">
                    {(opt.id === 'light'
                      ? ['#ffffff', '#dbe1ff', '#004ac6']
                      : opt.id === 'dark'
                        ? ['#0b1220', '#1a2438', '#60a5fa']
                        : ['#ffffff', '#0b1220', '#004ac6']
                    ).map((c, i) => (
                      <div key={i} className="flex-1" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[0.9286rem] font-semibold">{opt.label}</span>
                    {settings.appearance.mode === opt.id && (
                      <Icon name="check_circle" fill className="text-[1.2857rem] text-primary" />
                    )}
                  </div>
                  <p className="mt-1 text-[0.7857rem] leading-snug text-on-surface-variant">
                    {opt.desc}
                  </p>
                </button>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* ── 色彩与密度 ── */}
      {tab === 'density' && <DensityTab settings={settings} save={save} />}

      {/* ── 字体与排版 ── */}
      {tab === 'typography' && <TypographyTab settings={settings} save={save} />}

      {/* ── 通用与快捷键 ── */}
      {tab === 'shortcuts' && <ShortcutsTab settings={settings} save={save} />}

      {/* ── 提醒与协同 ── */}
    </div>
  )
}

import { Section, Segmented } from './settingsUi'
import { Icon } from '@/design-system/Icon'
import {
  ACCENT_PRESETS,
  RADIUS_PRESETS,
  MOTION_PRESETS,
  FONT_SIZE_STEPS,
  LINE_HEIGHT_STEPS,
  FONT_PRESETS,
  FONT_STACKS,
} from '@/shared/theme'
import type { Settings } from '@/db/types'

/**
 * 「色彩与密度」「字体与排版」两个 tab（**自 SettingsPage.tsx 拆出** · 审计 C-7 · 2026-10-21）
 *
 * 为何两个 tab 放同一文件：二者同属「外观层配置」，依赖完全一致
 * （只需 `settings` / `save` + 同一组 `@/shared/theme` 预设），拆成两个文件反而不便于对照维护。
 * 语义与拆分前逐行一致（仅移动代码 + 补齐 import）。
 */
export function DensityTab({
  settings,
  save,
}: {
  settings: Settings
  save: (patch: Partial<Settings>) => void
}) {
  return (
        <div className="anim-enter space-y-4">
          <Section
            icon="format_color_fill"
            title="强调色"
            desc="覆盖主按钮、选中态与链接色的品牌强调色"
            badge="实时生效"
          >
            <div className="flex flex-wrap gap-3">
              {ACCENT_PRESETS.map((a) => (
                <button
                  key={a.id}
                  className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 transition-colors ${
                    settings.appearance.accent === a.id
                      ? 'border-primary bg-primary-fixed/40'
                      : 'border-outline-variant/50 hover:border-primary/50'
                  }`}
                  onClick={() => save({ appearance: { ...settings.appearance, accent: a.id } })}
                >
                  <span className="h-5 w-5 rounded-full" style={{ background: a.container }} />
                  <span className="text-[0.8929rem] font-medium">{a.label}</span>
                  {settings.appearance.accent === a.id && (
                    <Icon name="check" fill className="text-[1.1429rem] text-primary" />
                  )}
                </button>
              ))}
            </div>
          </Section>

          <Section
            icon="rounded_corner"
            title="圆角与信息密度"
            desc="调整卡片圆角档位与全局间距基数，营造工作台氛围"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[0.9286rem] font-medium">卡片圆角</span>
              <Segmented
                options={RADIUS_PRESETS.map((r) => r.id)}
                value={settings.appearance.radius}
                format={(v) => RADIUS_PRESETS.find((r) => r.id === v)!.label}
                onChange={(v) => save({ appearance: { ...settings.appearance, radius: v } })}
              />
            </div>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[0.9286rem] font-medium">信息密度</span>
              <Segmented
                options={['comfortable', 'compact'] as const}
                value={settings.appearance.density}
                format={(v) => (v === 'comfortable' ? '舒适（4px 基线）' : '紧凑（3.5px 基线）')}
                onChange={(v) => save({ appearance: { ...settings.appearance, density: v } })}
              />
            </div>
            {/* 动效强度：与圆角/密度同区（都是「手感」而非「配色」）。
                系统级 prefers-reduced-motion 优先于本档位，故说明里点出这一层。 */}
            <div className="flex items-center justify-between">
              <span className="text-[0.9286rem] font-medium">动效强度</span>
              <Segmented
                options={MOTION_PRESETS.map((m) => m.id)}
                value={settings.appearance.motion ?? 'full'}
                format={(v) => MOTION_PRESETS.find((m) => m.id === v)!.label}
                onChange={(v) => save({ appearance: { ...settings.appearance, motion: v } })}
              />
            </div>
          </Section>
        </div>
  )
}

export function TypographyTab({
  settings,
  save,
}: {
  settings: Settings
  save: (patch: Partial<Settings>) => void
}) {
  return (
        <div className="anim-enter space-y-4">
          <Section
            icon="text_fields"
            title="字体组合"
            desc="切换全局 font-sans 字体栈，12 组风格预设（黑体/衬线/楷体/等宽/仿宋/草体等）"
            badge="实时生效"
          >
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {FONT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    (settings.typography.fontPreset ?? 'inter') === p.id
                      ? 'border-primary bg-primary-fixed/40'
                      : 'border-outline-variant/50 hover:border-primary/50'
                  }`}
                  onClick={() => save({ typography: { ...settings.typography, fontPreset: p.id } })}
                >
                  <div
                    className="truncate text-[1.0714rem] font-semibold"
                    style={{ fontFamily: FONT_STACKS[p.id] }}
                  >
                    字体预设 Aa
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[0.9286rem] font-medium">
                    {p.label}
                    {(settings.typography.fontPreset ?? 'inter') === p.id && (
                      <Icon name="check_circle" fill className="text-[1.0714rem] text-primary" />
                    )}
                  </div>
                  <p className="mt-1 text-[0.7857rem] leading-snug text-on-surface-variant">
                    {p.desc}
                  </p>
                </button>
              ))}
            </div>
          </Section>

          {/* ⚠️ 双栏必须带响应式断点（2026-10-21 与待办页同批修）。
              原为无条件的 `grid-cols-[1fr_380px]` —— 右栏固定 380px，
              窄屏时左栏（表单本体）被压到极窄、输入控件变形。
              窄屏改单栏堆叠：说明在上、示例在下，`xl:` 起才并排
              （这处右栏要 380px，比另两处的 240px 更宽，故断点取更大的一档）。 */}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_380px]">
            <Section
              icon="text_fields"
              title="基准字号与阅读间距"
              desc="调整全局文本物理渲染阶梯与行距倍数"
              badge="实时生效"
            >
              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[0.9286rem] font-medium">
                    基准字体大小 (Base Font Size)
                  </span>
                  <span className="text-[0.8571rem] font-semibold text-primary">
                    {settings.typography.fontSize} px
                  </span>
                </div>
                <Segmented
                  options={FONT_SIZE_STEPS}
                  value={settings.typography.fontSize}
                  format={(v) => `${v}px${v === 14 ? ' · 默认' : ''}`}
                  onChange={(v) => save({ typography: { ...settings.typography, fontSize: v } })}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[0.9286rem] font-medium">
                    行高与纵向韵律 (Line Height Ratio)
                  </span>
                  <span className="text-[0.8571rem] font-semibold text-primary">
                    {settings.typography.lineHeight}x
                  </span>
                </div>
                <Segmented
                  options={LINE_HEIGHT_STEPS}
                  value={settings.typography.lineHeight}
                  format={(v) => `${v}x${v === 1.6 ? ' · 推荐' : ''}`}
                  onChange={(v) => save({ typography: { ...settings.typography, lineHeight: v } })}
                />
              </div>
            </Section>

            <Section
              icon="visibility"
              title="实时排版预览"
              desc="下方预览块即当前全局生效值"
              badge="Live Rendering"
            >
              <div
                className="surface-card-low rounded-xl/60 p-5"
                style={{
                  fontSize: settings.typography.fontSize,
                  lineHeight: settings.typography.lineHeight,
                }}
              >
                <div className="mb-1 text-[0.75rem] font-semibold uppercase tracking-widest text-primary">
                  # 核心里程碑 · Q3 Milestone
                </div>
                <div className="text-[1.35em] font-bold">多维穿透工作流与团队协作网格</div>
                <p className="mt-2 text-on-surface-variant">
                  在团队协作中，沉浸式记录与待办任务可无缝联动。寻鸽工作台深度集成 Inter
                  字体内核与表格间距韵律，使每次会议纪要、OKR
                  对齐与财务中心之间实现零损耗上下文传递。当前预览即所保存后的全局正文渲染效果。
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between text-[0.7857rem] text-outline">
                <span>
                  阅读舒适度评级 <b className="text-success">99.4%</b>
                </span>
                <span>
                  字符高宽比 <b>0.72 : 1</b>
                </span>
              </div>
            </Section>
          </div>
        </div>
  )
}

import { eventBus } from './eventBus'
import { habitRepo, habitLogRepo, habitLogId, settingsRepo } from '@/repositories'
import { installTrophyEngine } from '@/modules/trophies/trophyEngine'
import { ACCENT_PRESETS, THEME_STYLES, FONT_STACKS, type FontPresetId } from './theme'
import dayjs from 'dayjs'

/**
 * 跨模块联动订阅（开发计划 2.4）
 * 深度专注完成 → 自动打卡「深度专注」习惯（若开启跨模块联动且时长达标）
 */
let installed = false

/**
 * 设置应用初始化（Phase 6）：
 * 启动时读取 settings singleton 应用到 DOM；写后由 settingsRepo 广播 settings:changed 实时生效。
 * token 全部走 CSS 变量覆盖（Tailwind v4 工具类引用 --color-* / --spacing / --radius-* 变量）。
 */
let lastSettings: import('@/db/types').Settings | undefined
let mediaHandler: (() => void) | undefined

export function applySettingsToDom(settings: import('@/db/types').Settings): void {
  const root = document.documentElement
  lastSettings = settings

  // 深浅模式（system 跟随 prefers-color-scheme）
  const dark =
    settings.appearance.mode === 'dark' ||
    (settings.appearance.mode === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)

  // 风格主题包（Issue #14）：整套界面气质——容器色阶/灰阶轮廓/情绪色按所选风格覆盖；
  // mode=system 时仍按当前深浅取对应侧变量。classic 为默认（light/dark 均为空覆盖，回退 index.css token）。
  // 切换前先清掉上一主题写入的 --color-* inline 变量，防止浅色/深色侧键数不一致时残留污染。
  const style = THEME_STYLES.find((t) => t.id === settings.appearance.theme) ?? THEME_STYLES[0]

  // 主题样式包（Issue #43）：造型语言挂 <html data-skin>，与配色正交、不入 settings 持久化
  root.dataset.skin = ('skin' in style ? style.skin : undefined) ?? 'none'
  const VARS = [
    'surface',
    'surface-container-lowest',
    'surface-container-low',
    'surface-container',
    'surface-container-high',
    'on-surface',
    'on-surface-variant',
    'outline',
    'outline-variant',
    'primary-fixed',
    'success',
    'success-container',
    'warning',
    'warning-container',
    'danger',
    'danger-container',
    'samesite-success',
    'samesite-warning',
    'samesite-danger',
  ] as const
  for (const name of VARS) root.style.removeProperty(`--color-${name}`)
  const styleVars = (dark ? style.dark : style.light) as Partial<
    Record<(typeof VARS)[number], string>
  >
  for (const [name, value] of Object.entries(styleVars)) {
    if (value) root.style.setProperty(`--color-${name}`, value)
  }

  // 强调色 → 覆盖 primary 系变量（fixed 为浅色容器底，用 color-mix 派生）
  const accent =
    ACCENT_PRESETS.find((a) => a.id === settings.appearance.accent) ?? ACCENT_PRESETS[0]
  root.style.setProperty('--color-primary', accent.primary)
  root.style.setProperty('--color-primary-container', accent.container)
  const mixBase = dark
    ? (styleVars['surface-container'] ?? '#0f172a')
    : (styleVars['surface-container-lowest'] ?? '#ffffff')
  root.style.setProperty(
    '--color-primary-fixed',
    `color-mix(in srgb, ${accent.container} 16%, ${mixBase})`,
  )

  // 圆角档位 → 覆盖 rounded-lg/rounded-xl 引用的半径变量（.card 用 rounded-lg）
  const radius = { sharp: '4px', medium: '8px', large: '14px' }[settings.appearance.radius]
  root.style.setProperty('--radius-lg', radius)
  root.style.setProperty('--radius-xl', radius)

  // 信息密度 → Tailwind v4 spacing 基数（4px 基线；紧凑 3.5px）
  root.style.setProperty(
    '--spacing',
    settings.appearance.density === 'compact' ? '0.21875rem' : '0.25rem',
  )

  // 字体排版 → html 基准字号 / 行高 / font-sans 字体栈（字体组合预设）
  root.style.fontSize = `${settings.typography.fontSize}px`
  root.style.lineHeight = String(settings.typography.lineHeight)
  const preset = (settings.typography.fontPreset ?? 'inter') as FontPresetId
  root.style.setProperty('--font-sans', FONT_STACKS[preset] ?? FONT_STACKS.inter)
}

function watchSystemTheme(): void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  if (mediaHandler) mql.removeEventListener('change', mediaHandler)
  mediaHandler = () => {
    if (lastSettings?.appearance.mode === 'system') applySettingsToDom(lastSettings)
  }
  mql.addEventListener('change', mediaHandler)
}

export function installModuleEffects() {
  if (installed) return
  installed = true

  eventBus.on('focus:completed', async ({ minutes }) => {
    try {
      const habits = await habitRepo.list()
      const focusHabit = habits.find(
        (h) => h.crossModuleSync && h.targetMinutes > 0 && h.category === '工作',
      )
      if (!focusHabit || minutes < focusHabit.targetMinutes) return
      const date = dayjs().format('YYYY-MM-DD')
      // 确定性 id 幂等：同日同习惯恒为同一条记录，存在即跳过
      const logId = habitLogId(focusHabit.id, date)
      const existing = await habitLogRepo.get(logId)
      if (existing) return
      await habitLogRepo.put({
        id: logId,
        habitId: focusHabit.id,
        date,
        completedAt: Date.now(),
        evidence: `深度专注 ${minutes} 分钟`,
      })
      eventBus.emit('habit:checked', { habitId: focusHabit.id, date })
    } catch (err) {
      console.error('[effects] focus→habit 联动失败', err)
    }
  })

  // 设置实时生效：启动应用一次 + 监听变更广播 + 跟随系统主题
  eventBus.on('settings:changed', ({ settings }) => applySettingsToDom(settings))
  void settingsRepo
    .get()
    .then(applySettingsToDom)
    .catch((err) => console.error('[effects] 设置应用失败', err))
  watchSystemTheme()

  // 奖杯引擎（幂等安装）：监听 focus:completed / habit:checked + 启动全量检查
  installTrophyEngine()
}

import { eventBus } from './eventBus'
import { habitRepo, checkinHabit } from '@/repositories'
import { settingsRepo } from '@/repositories/localAdmin'
import { installTrophyEngine } from '@/modules/trophies/trophyEngine'
import { ACCENT_PRESETS, THEME_STYLES, SKIN_STYLES, FONT_STACKS, DARK_PRIMARY_KEEP_PCT, DARK_ON_PRIMARY_KEEP_PCT, type FontPresetId, type SkinStyleId } from './theme'
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

  // 界面风格包（Issue #54）：与配色解耦的独立造型语言，挂 <html data-skin> 独立持久化。
  // 切换配色不动风格，反之亦然；首次升级用户无 style 字段时回退主题推荐风格，老视觉零突变。
  const legacyRecommend = 'recommendStyle' in style ? (style.recommendStyle as SkinStyleId) : undefined
  const styleId = settings.appearance.style ?? legacyRecommend ?? 'none'
  root.dataset.skin = SKIN_STYLES.some((sk) => sk.id === styleId) ? styleId : 'none'
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
  // ⚠️ 深色模式下主色必须提亮（Material 3 的 tonality 提升口径）。
  // ACCENT_PRESETS 给的是「浅色底上的主色」（约 tone 40），直接用在深色底上：
  //   · 压在 surface(#0b1220) 上对比度 ≈2.5
  //   · 压在 primary-fixed（深色下是 color-mix(container 16%, 深底)）上仅 ≈1.8
  // 表现就是侧栏选中项 / 链接 / 图标在深色下几乎看不清（功能测试 #79 实测 1.84）。
  // 混白 55%（= primary 占 45%，约 tone 80）经 12 套强调色 × 12 套配色主题全组合验算，
  // 对两种底最坏情形分别 5.4 / 4.6，全部达 WCAG AA（45% 是临界达标点，故取此值）。
  // 随之 on-primary 必须反转为深色 —— 提亮后的主色若仍压白字，按钮与导航激活项同样不可读。
  root.style.setProperty(
    '--color-primary',
    dark
      ? `color-mix(in srgb, ${accent.primary} ${DARK_PRIMARY_KEEP_PCT}%, #ffffff)`
      : accent.primary,
  )
  if (dark) {
    root.style.setProperty(
      '--color-on-primary',
      `color-mix(in srgb, ${accent.primary} ${DARK_ON_PRIMARY_KEEP_PCT}%, #000000)`,
    )
  } else {
    // 浅色侧回落到 index.css 的 token（#ffffff），不在这里复制一份常量
    root.style.removeProperty('--color-on-primary')
  }
  root.style.setProperty('--color-primary-container', accent.container)
  const mixBase = dark
    ? (styleVars['surface-container'] ?? '#0f172a')
    : (styleVars['surface-container-lowest'] ?? '#ffffff')
  root.style.setProperty(
    '--color-primary-fixed',
    `color-mix(in srgb, ${accent.container} 16%, ${mixBase})`,
  )

  // 圆角档位 → 覆盖全部 Tailwind 半径档变量（Issue #54 半径治理：
  // rounded-md/lg/xl/2xl 全量走 --radius-*，风格/主题切换时全 App 圆角一致生效）
  const radius = { sharp: '4px', medium: '8px', large: '14px' }[settings.appearance.radius]
  root.style.setProperty('--radius-sm', `calc(${radius} / 2)`)
  root.style.setProperty('--radius-md', `calc(${radius} * 0.75)`)
  root.style.setProperty('--radius-lg', radius)
  root.style.setProperty('--radius-xl', radius)
  root.style.setProperty('--radius-2xl', `calc(${radius} * 2)`)
  root.style.setProperty('--radius-3xl', `calc(${radius} * 2.5)`)

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
      // 走领域命令单点收口（§9.6.1）：checkinHabit 内建确定性 id 幂等，
      // 已存在即 { created: false } 且不 emit（原「存在即跳过」语义等价）
      await checkinHabit(focusHabit.id, date, { evidence: `深度专注 ${minutes} 分钟` })
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

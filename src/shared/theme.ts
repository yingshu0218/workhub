/** 强调色预设（Phase 6 设置页 · 色彩与密度）—— 应用逻辑见 shared/effects.ts applySettingsToDom */
export interface AccentPreset {
  id: string
  label: string
  /** --color-primary */
  primary: string
  /** --color-primary-container */
  container: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'blue', label: '经典蓝', primary: '#004ac6', container: '#2563eb' },
  { id: 'violet', label: '智性紫', primary: '#6d28d9', container: '#7c3aed' },
  { id: 'green', label: '稳态绿', primary: '#0f6e56', container: '#0f9d76' },
  { id: 'amber', label: '暖橙', primary: '#b45309', container: '#d97706' },
  { id: 'rose', label: '能量红', primary: '#be123c', container: '#e11d48' },
  { id: 'cyan', label: '青海蓝', primary: '#0e7490', container: '#06b6d4' },
  { id: 'indigo', label: '静夜靛', primary: '#4338ca', container: '#6366f1' },
  { id: 'lime', label: '草木青', primary: '#3f6212', container: '#65a30d' },
  { id: 'fuchsia', label: '霞光粉', primary: '#a21caf', container: '#d946ef' },
  { id: 'teal', label: '湖水青', primary: '#0f766e', container: '#14b8a6' },
  { id: 'brown', label: '大地棕', primary: '#78350f', container: '#b45309' },
  { id: 'slate', label: '石墨灰', primary: '#334155', container: '#64748b' },
]

export const RADIUS_PRESETS = [
  { id: 'sharp', label: '利落 4px' },
  { id: 'medium', label: '标准 8px' },
  { id: 'large', label: '柔和 14px' },
] as const

export const FONT_SIZE_STEPS = [13, 14, 15, 16]
export const LINE_HEIGHT_STEPS = [1.4, 1.6, 1.8]

/**
 * 风格主题包（Issue #14）：不只是换强调色，而是整套界面气质——
 * 底色基调 / 容器色阶 / 灰阶轮廓 / 情绪色（success/warning/danger）/ 明暗默认值 / 圆角字体倾向。
 * 应用逻辑见 shared/effects.ts applySettingsToDom。
 */
export interface ThemeStylePreset {
  id: string
  label: string
  desc: string
  /** 预览色带（设置卡片缩略图） */
  swatch: [string, string, string]
  /** 默认深浅模式（选风格后自动切换，可再手动改） */
  mode: 'light' | 'dark'
  /** 浅色模式变量覆盖 */
  light: Partial<ThemeVars>
  /** 深色模式变量覆盖 */
  dark: Partial<ThemeVars>
  /** 选中该风格时的推荐圆角 */
  radius?: 'sharp' | 'medium' | 'large'
}

export interface ThemeVars {
  surface: string
  'surface-container-lowest': string
  'surface-container-low': string
  'surface-container': string
  'surface-container-high': string
  'on-surface': string
  'on-surface-variant': string
  outline: string
  'outline-variant': string
  'primary-fixed': string
  success: string
  'success-container': string
  warning: string
  'warning-container': string
  danger: string
  'danger-container': string
}

export const THEME_STYLES: ThemeStylePreset[] = [
  {
    id: 'classic',
    label: '经典晴空',
    desc: '清爽蓝调浅色画布，工作台默认',
    swatch: ['#f8f9ff', '#dce9ff', '#004ac6'],
    mode: 'light',
    light: {},
    dark: {},
  },
  {
    id: 'warm',
    label: '暖阳米白',
    desc: '奶油底 + 暖灰文字，柔和不刺眼',
    swatch: ['#fdfaf3', '#f5e9d3', '#b45309'],
    mode: 'light',
    light: {
      surface: '#fdfaf3',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#faf3e3',
      'surface-container': '#f6ecd7',
      'surface-container-high': '#f0e2c5',
      'on-surface': '#2b2115',
      'on-surface-variant': '#5d5245',
      outline: '#857a68',
      'outline-variant': '#e0d5bf',
      'primary-fixed': '#f6e7cd',
      success: '#5c7a29',
      'success-container': '#e4edc3',
      warning: '#9a5b13',
      'warning-container': '#ffe3bd',
      danger: '#a33725',
      'danger-container': '#ffdad2',
    },
    dark: {
      surface: '#1c1811',
      'surface-container-lowest': '#241f16',
      'surface-container-low': '#2b251a',
      'surface-container': '#332c1f',
      'surface-container-high': '#3d3425',
      'on-surface': '#eddcbf',
      'on-surface-variant': '#cfc0a3',
      outline: '#998d74',
      'outline-variant': '#4a4030',
      'primary-fixed': '#3d3425',
      success: '#b3cd5c',
      'success-container': '#3a451a',
      warning: '#ffb861',
      'warning-container': '#4d2e08',
      danger: '#ffb4a1',
      'danger-container': '#5d180b',
    },
  },
  {
    id: 'forest',
    label: '森林薄荷',
    desc: '冷调绿灰基底，自然疗愈感',
    swatch: ['#f4faf6', '#d3ecdd', '#0f6e56'],
    mode: 'light',
    light: {
      surface: '#f4faf6',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#ebf5ee',
      'surface-container': '#ddefe3',
      'surface-container-high': '#cde7d8',
      'on-surface': '#14211b',
      'on-surface-variant': '#42544a',
      outline: '#6f8377',
      'outline-variant': '#bed8c7',
      'primary-fixed': '#d0e9dc',
      success: '#166534',
      'success-container': '#bbf7d0',
      warning: '#a16207',
      'warning-container': '#fef3c7',
      danger: '#b91c1c',
      'danger-container': '#fecaca',
    },
    dark: {
      surface: '#0e1613',
      'surface-container-lowest': '#131d18',
      'surface-container-low': '#182420',
      'surface-container': '#1e2c26',
      'surface-container-high': '#26362f',
      'on-surface': '#dce8e0',
      'on-surface-variant': '#a8bcb0',
      outline: '#748c7e',
      'outline-variant': '#2c3f36',
      'primary-fixed': '#24352d',
      success: '#66d99a',
      'success-container': '#0c3d22',
      warning: '#fbbf24',
      'warning-container': '#3f2305',
      danger: '#f87171',
      'danger-container': '#450a0a',
    },
  },
  {
    id: 'paper',
    label: '纸墨书卷',
    desc: '米纸底 + 衬线倾向，阅读氛围',
    swatch: ['#faf8f2', '#e8e2d0', '#43382b'],
    mode: 'light',
    radius: 'sharp',
    light: {
      surface: '#faf8f2',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#f3f0e6',
      'surface-container': '#ece7d8',
      'surface-container-high': '#e4ddc9',
      'on-surface': '#2a2419',
      'on-surface-variant': '#5b5342',
      outline: '#847a64',
      'outline-variant': '#d6cfba',
      'primary-fixed': '#e8e0ca',
      success: '#4d7c0f',
      'success-container': '#d9f99d',
      warning: '#b45309',
      'warning-container': '#fed7aa',
      danger: '#9f1239',
      'danger-container': '#fecdd3',
    },
    dark: {
      surface: '#17150f',
      'surface-container-lowest': '#1e1c15',
      'surface-container-low': '#25231a',
      'surface-container': '#2d2a1f',
      'surface-container-high': '#363225',
      'on-surface': '#e8e2cf',
      'on-surface-variant': '#c0b89f',
      outline: '#8b8369',
      'outline-variant': '#3e3a2c',
      'primary-fixed': '#332f22',
      success: '#a3e635',
      'success-container': '#2c4105',
      warning: '#fbbf24',
      'warning-container': '#3f2305',
      danger: '#fb7185',
      'danger-container': '#4c0519',
    },
  },
  {
    id: 'ocean',
    label: '深海静谧',
    desc: '墨蓝暗调 + 高对比文字，沉浸夜间',
    swatch: ['#0b1220', '#16233d', '#38bdf8'],
    mode: 'dark',
    dark: {
      surface: '#0a101c',
      'surface-container-lowest': '#0f1727',
      'surface-container-low': '#131e31',
      'surface-container': '#18253c',
      'surface-container-high': '#1e2e4a',
      'on-surface': '#dfe8f6',
      'on-surface-variant': '#9db0cc',
      outline: '#64789a',
      'outline-variant': '#263550',
      'primary-fixed': '#1d2c47',
      success: '#38bdf8',
      'success-container': '#0c3b56',
      warning: '#fbbf24',
      'warning-container': '#3f2305',
      danger: '#f87171',
      'danger-container': '#450a0a',
    },
    light: {
      surface: '#f0f6ff',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#e6effc',
      'surface-container': '#d8e7fa',
      'surface-container-high': '#cadef7',
      'on-surface': '#101f33',
      'on-surface-variant': '#45536a',
      outline: '#6f7f99',
      'outline-variant': '#bcd0e8',
      'primary-fixed': '#cfe2fa',
    },
  },
  {
    id: 'grape',
    label: '薄暮紫罗兰',
    desc: '紫罗兰暗调，优雅复古的霓虹感',
    swatch: ['#14101f', '#241b3a', '#a78bfa'],
    mode: 'dark',
    dark: {
      surface: '#120e1c',
      'surface-container-lowest': '#191327',
      'surface-container-low': '#1f1830',
      'surface-container': '#271e3b',
      'surface-container-high': '#30254a',
      'on-surface': '#e6dff5',
      'on-surface-variant': '#ae9fca',
      outline: '#7a6b99',
      'outline-variant': '#332749',
      'primary-fixed': '#282040',
      success: '#86efac',
      'success-container': '#14532d',
      warning: '#fbbf24',
      'warning-container': '#3f2305',
      danger: '#fb7185',
      'danger-container': '#4c0519',
    },
    light: {
      surface: '#faf7ff',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#f2ecfb',
      'surface-container': '#eae1f8',
      'surface-container-high': '#e2d6f5',
      'on-surface': '#1d1430',
      'on-surface-variant': '#4c4360',
      outline: '#776e8c',
      'outline-variant': '#d4c9e8',
      'primary-fixed': '#e4d9f9',
    },
  },
  {
    id: 'rose',
    label: '玫瑰花园',
    desc: '粉调基底 + 玫瑰强调，轻盈柔和',
    swatch: ['#fdf5f6', '#f8dfe4', '#be123c'],
    mode: 'light',
    light: {
      surface: '#fdf5f6',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#faeaed',
      'surface-container': '#f6dce1',
      'surface-container-high': '#f2cfd6',
      'on-surface': '#2c1218',
      'on-surface-variant': '#5c3b43',
      outline: '#8c616b',
      'outline-variant': '#e5c3cb',
      'primary-fixed': '#f6d5dc',
      success: '#15803d',
      'success-container': '#bbf7d0',
      warning: '#c2410c',
      'warning-container': '#ffedd5',
      danger: '#be123c',
      'danger-container': '#fecdd3',
    },
    dark: {
      surface: '#1b1013',
      'surface-container-lowest': '#231618',
      'surface-container-low': '#2a1b1e',
      'surface-container': '#322125',
      'surface-container-high': '#3d292e',
      'on-surface': '#f3dfe3',
      'on-surface-variant': '#cdb3ba',
      outline: '#99767f',
      'outline-variant': '#43282e',
      'primary-fixed': '#3d2830',
      success: '#66d99a',
      'success-container': '#0c3d22',
      warning: '#fbbf24',
      'warning-container': '#3f2305',
      danger: '#fb7185',
      'danger-container': '#4c0519',
    },
  },
  {
    id: 'carbon',
    label: '碳黑极简',
    desc: '纯灰无彩暗调，开发者硬核质感',
    swatch: ['#111111', '#1f1f1f', '#e5e5e5'],
    mode: 'dark',
    radius: 'sharp',
    dark: {
      surface: '#101010',
      'surface-container-lowest': '#171717',
      'surface-container-low': '#1c1c1c',
      'surface-container': '#222222',
      'surface-container-high': '#2a2a2a',
      'on-surface': '#ededed',
      'on-surface-variant': '#a3a3a3',
      outline: '#737373',
      'outline-variant': '#2e2e2e',
      'primary-fixed': '#262626',
      success: '#4ade80',
      'success-container': '#053b26',
      warning: '#fbbf24',
      'warning-container': '#3f2305',
      danger: '#f87171',
      'danger-container': '#450a0a',
    },
    light: {
      surface: '#f5f5f5',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#efefef',
      'surface-container': '#e8e8e8',
      'surface-container-high': '#e0e0e0',
      'on-surface': '#171717',
      'on-surface-variant': '#525252',
      outline: '#737373',
      'outline-variant': '#d4d4d4',
      'primary-fixed': '#e5e5e5',
    },
  },
  {
    id: 'pixel',
    label: '像素复古',
    desc: '8-bit 复古游戏机配色 + 利落直角 + 点阵字体，硬核像素党',
    swatch: ['#1a1c2c', '#5d275d', '#41a6f6'],
    mode: 'dark',
    radius: 'sharp',
    light: {
      surface: '#f4f4f4',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#e4e4e4',
      'surface-container': '#d8d8d8',
      'surface-container-high': '#c4c4c4',
      'on-surface': '#1a1c2c',
      'on-surface-variant': '#566c86',
      outline: '#3b5dc9',
      'outline-variant': '#94b0c2',
      'primary-fixed': '#cdedff',
      success: '#38b764',
      'success-container': '#c8f0d0',
      warning: '#f7a41d',
      'warning-container': '#ffe9b0',
      danger: '#e64539',
      'danger-container': '#ffd0cc',
    },
    dark: {
      surface: '#1a1c2c',
      'surface-container-lowest': '#22233a',
      'surface-container-low': '#282a44',
      'surface-container': '#2f314e',
      'surface-container-high': '#383a5e',
      'on-surface': '#f4f4f4',
      'on-surface-variant': '#94b0c2',
      outline: '#41a6f6',
      'outline-variant': '#3a3d5e',
      'primary-fixed': '#2b3a52',
      success: '#63c74d',
      'success-container': '#1c4023',
      warning: '#feae34',
      'warning-container': '#4d2f04',
      danger: '#ee4266',
      'danger-container': '#4e0f1e',
    },
  },
  {
    id: 'chibi',
    label: 'Q版卡通',
    desc: '马卡龙糖果色 + 圆润高饱和，元气满满的贴纸感',
    swatch: ['#fff7fb', '#ffd6ec', '#f472b6'],
    mode: 'light',
    radius: 'large',
    light: {
      surface: '#fff7fb',
      'surface-container-lowest': '#ffffff',
      'surface-container-low': '#ffedf6',
      'surface-container': '#ffe3f0',
      'surface-container-high': '#ffd6ea',
      'on-surface': '#4a1942',
      'on-surface-variant': '#8c4a7d',
      outline: '#d061a8',
      'outline-variant': '#ffcbe4',
      'primary-fixed': '#ffd9ef',
      success: '#16a34a',
      'success-container': '#d3f8df',
      warning: '#f59e0b',
      'warning-container': '#ffedc4',
      danger: '#f43f5e',
      'danger-container': '#ffdbe3',
    },
    dark: {
      surface: '#2b1526',
      'surface-container-lowest': '#351b2f',
      'surface-container-low': '#3d2137',
      'surface-container': '#47283f',
      'surface-container-high': '#542f4a',
      'on-surface': '#ffe4f3',
      'on-surface-variant': '#d9a4c6',
      outline: '#f472b6',
      'outline-variant': '#4a2b41',
      'primary-fixed': '#4b2340',
      success: '#4ade80',
      'success-container': '#14532d',
      warning: '#fbbf24',
      'warning-container': '#3f2305',
      danger: '#fb7185',
      'danger-container': '#4c0519',
    },
  },
]

/** 字体组合预设（Phase 6 设置页 · 字体与排版）—— 映射 --font-sans 栈，应用逻辑见 shared/effects.ts */
export const FONT_PRESETS = [
  { id: 'inter', label: 'Inter 优先', desc: '西文 Inter 内核 + 中文黑体，工作台默认' },
  { id: 'system', label: '系统优先', desc: '跟随系统 UI 字体（苹方 / 鸿蒙黑体），原生质感' },
  { id: 'serif', label: '衬线书卷', desc: '宋体 / Noto Serif，长文阅读的书卷氛围' },
  { id: 'hei', label: '现代黑体', desc: '鸿蒙黑体 / 微软雅黑优先，笔画硬朗清晰' },
  { id: 'kai', label: '楷体手写', desc: '楷体 / Kaiti SC，温润亲和的手写气质' },
  { id: 'rounded', label: '圆润可爱', desc: '圆体 / 幼圆优先，轻松愉悦的圆润风格' },
] as const

export type FontPresetId = (typeof FONT_PRESETS)[number]['id']

/** 各字体预设 → --font-sans 字体栈（effects.ts 与设置页预览共用） */
export const FONT_STACKS: Record<FontPresetId, string> = {
  inter: `'Inter', 'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif`,
  system: `system-ui, -apple-system, 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', sans-serif`,
  serif: `'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif`,
  hei: `'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei', 'PingFang SC', sans-serif`,
  kai: `'Kaiti SC', 'STKaiti', 'KaiTi', 'DFKai-SB', 'serif'`,
  rounded: `'Yuanti SC', 'YouYuan', 'Hiragino Maru Gothic ProN', 'PingFang SC', sans-serif`,
}

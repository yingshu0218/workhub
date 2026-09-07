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
]

export const RADIUS_PRESETS = [
  { id: 'sharp', label: '利落 4px' },
  { id: 'medium', label: '标准 8px' },
  { id: 'large', label: '柔和 14px' },
] as const

export const FONT_SIZE_STEPS = [13, 14, 15, 16]
export const LINE_HEIGHT_STEPS = [1.4, 1.6, 1.8]

/** 字体组合预设（Phase 6 设置页 · 字体与排版）—— 映射 --font-sans 栈，应用逻辑见 shared/effects.ts */
export const FONT_PRESETS = [
  { id: 'inter', label: 'Inter 优先', desc: '西文 Inter 内核 + 中文黑体，工作台默认' },
  { id: 'system', label: '系统优先', desc: '跟随系统 UI 字体（苹方 / 鸿蒙黑体），原生质感' },
  { id: 'serif', label: '衬线优先', desc: '宋体 / Noto Serif，长文阅读的书卷氛围' },
] as const

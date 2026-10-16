import { useEffect, useState } from 'react'
import type { Settings } from '@/db/types'
import { DEFAULT_SETTINGS } from '@/db/types'
import { eventBus } from '@/shared/eventBus'
import { settingsRepo } from '@/repositories/localAdmin'

/**
 * 客户关系画布的**主题系统**（2026-10-16 用户拍板）。
 *
 * 设计逻辑：布局/连线/交互零改动，只换一组固定的「语义槽位」颜色——
 * bg（画布背景）/ self / customer / project / income / expense / todo / note /
 * relation / bridge，每槽 {stroke, fill, text}（relation/bridge 无 fill）。
 * 无论切哪套：「我」永远最醒目、类别色板保持相同色相间距（只按底色调明度饱和度）、
 * 文字对比度可读 —— 这就是「不同配色方案只是调整颜色」的可执行含义。
 *
 * 偏好存 `settings.appearance.canvasTheme`（本地偏好，不进同步）；`'auto'` 跟随
 * 应用深浅模式（亮 → morning / 暗 → night），手动选过则固定该套。
 *
 * ⚠️ 渲染层消费方式：主题**不进** useForceGraph 的依赖（切色不重建仿真、节点不乱跳），
 * 颜色在 GraphCanvas 渲染时按 kind 查表上色。
 */

export type CanvasThemeId = 'morning' | 'night' | 'paper' | 'celadon'
export type CanvasThemePref = CanvasThemeId | 'auto'

export interface CanvasThemeSlot {
  stroke: string
  fill: string
  text: string
}

export interface CanvasTheme {
  id: CanvasThemeId
  name: string
  /** 画布背景 */
  bg: string
  /** 节点标签主文字色（客户名） */
  label: string
  /** 节点标签次要文字色（mixed 小节点） */
  labelMuted: string
  self: CanvasThemeSlot
  customer: CanvasThemeSlot
  project: CanvasThemeSlot
  income: CanvasThemeSlot
  expense: CanvasThemeSlot
  todo: CanvasThemeSlot
  note: CanvasThemeSlot
  /** 客户间关系边（虚线曲线） */
  relation: { stroke: string; text: string }
  /** 二跳桥接弱边 */
  bridge: { stroke: string; text: string }
}

/** 晨蓝：默认主题 = 既有 Team Blue 亮色系（历史值原样迁移，零回归） */
const morning: CanvasTheme = {
  id: 'morning',
  name: '晨蓝',
  bg: '#f8f9ff',
  label: '#0b1c30',
  labelMuted: '#434655',
  self: { stroke: '#004ac6', fill: '#004ac6', text: '#ffffff' },
  customer: { stroke: '#004ac6', fill: '#dbe1ff', text: '#004ac6' },
  project: { stroke: '#6d43c4', fill: '#e9ddff', text: '#6d43c4' },
  income: { stroke: '#006c49', fill: '#6cf8bb', text: '#006c49' },
  expense: { stroke: '#ba1a1a', fill: '#ffdad6', text: '#ba1a1a' },
  todo: { stroke: '#943700', fill: '#ffede6', text: '#943700' },
  note: { stroke: '#4a4458', fill: '#e8def8', text: '#4a4458' },
  relation: { stroke: '#943700', text: '#943700' },
  bridge: { stroke: '#8a94a6', text: '#6f7987' },
}

/** 墨夜：深蓝黑底 + 高亮青蓝（深色模式；类别色整体提亮降饱和，保持底上可读） */
const night: CanvasTheme = {
  id: 'night',
  name: '墨夜',
  bg: '#0f172a',
  label: '#e2e8f0',
  labelMuted: '#94a3b8',
  self: { stroke: '#22d3ee', fill: '#0e7490', text: '#ecfeff' },
  customer: { stroke: '#38bdf8', fill: '#0c4a6e', text: '#7dd3fc' },
  project: { stroke: '#c4b5fd', fill: '#2e1065', text: '#c4b5fd' },
  income: { stroke: '#34d399', fill: '#064e3b', text: '#6ee7b7' },
  expense: { stroke: '#f87171', fill: '#7f1d1d', text: '#fca5a5' },
  todo: { stroke: '#fb923c', fill: '#7c2d12', text: '#fdba74' },
  note: { stroke: '#94a3b8', fill: '#1e293b', text: '#cbd5e1' },
  relation: { stroke: '#fdba74', text: '#fdba74' },
  bridge: { stroke: '#475569', text: '#94a3b8' },
}

/** 纸墨：纸白底 + 墨黑（极简档案感；类别只保留极淡的冷暖倾向，整体近单色） */
const paper: CanvasTheme = {
  id: 'paper',
  name: '纸墨',
  bg: '#faf9f7',
  label: '#292524',
  labelMuted: '#57534e',
  self: { stroke: '#1c1917', fill: '#1c1917', text: '#fafaf9' },
  customer: { stroke: '#44403c', fill: '#f5f5f4', text: '#292524' },
  project: { stroke: '#57534e', fill: '#e7e5e4', text: '#44403c' },
  income: { stroke: '#3f6212', fill: '#ecfccb', text: '#3f6212' },
  expense: { stroke: '#7f1d1d', fill: '#fee2e2', text: '#7f1d1d' },
  todo: { stroke: '#78350f', fill: '#fef3c7', text: '#78350f' },
  note: { stroke: '#57534e', fill: '#e7e5e4', text: '#44403c' },
  relation: { stroke: '#57534e', text: '#57534e' },
  bridge: { stroke: '#a8a29e', text: '#78716c' },
}

/** 青瓷：淡青白底 + 青瓷蓝绿（国风；类别色冷暖均衡，绿为主调） */
const celadon: CanvasTheme = {
  id: 'celadon',
  name: '青瓷',
  bg: '#f0f7f4',
  label: '#134e4a',
  labelMuted: '#475569',
  self: { stroke: '#0f766e', fill: '#0f766e', text: '#f0fdfa' },
  customer: { stroke: '#0f766e', fill: '#ccfbf1', text: '#115e59' },
  project: { stroke: '#7c3aed', fill: '#ede9fe', text: '#7c3aed' },
  income: { stroke: '#15803d', fill: '#dcfce7', text: '#15803d' },
  expense: { stroke: '#b91c1c', fill: '#fee2e2', text: '#b91c1c' },
  todo: { stroke: '#b45309', fill: '#fef3c7', text: '#b45309' },
  note: { stroke: '#475569', fill: '#e2e8f0', text: '#475569' },
  relation: { stroke: '#b45309', text: '#b45309' },
  bridge: { stroke: '#94a3b8', text: '#64748b' },
}

/** 节点的颜色槽名（buildGraph 嵌到节点上，渲染层按当前主题查值） */
export type CanvasColorSlot = Exclude<keyof CanvasTheme, 'id' | 'name' | 'bg' | 'label' | 'labelMuted'>

export const CANVAS_THEMES: Record<CanvasThemeId, CanvasTheme> = {
  morning,
  night,
  paper,
  celadon,
}

/** 解析偏好：'auto' 跟随应用深浅模式（亮 → morning / 暗 → night） */
export function resolveCanvasTheme(pref: CanvasThemePref, appearanceMode: Settings['appearance']['mode']): CanvasTheme {
  if (pref !== 'auto') return CANVAS_THEMES[pref]
  let dark = false
  if (appearanceMode === 'dark') dark = true
  else if (appearanceMode === 'system' && typeof window !== 'undefined') {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return dark ? CANVAS_THEMES.night : CANVAS_THEMES.morning
}

/**
 * 画布主题 hook：读 settings（appearance.canvasTheme + mode）→ 解析出主题对象。
 * 订阅 settings:changed 实时响应切换。**theme 恒为常量表中的引用**（稳定引用，
 * 切主题不重建 d3 仿真 —— 色变位置不变）。
 */
export function useCanvasTheme(): { pref: CanvasThemePref; theme: CanvasTheme; setPref: (id: CanvasThemePref) => void } {
  const [pref, setPrefState] = useState<CanvasThemePref>('auto')
  const [theme, setTheme] = useState<CanvasTheme>(CANVAS_THEMES.morning)
  useEffect(() => {
    let alive = true
    const apply = (s?: Settings) => {
      if (!alive) return
      const appearance = { ...DEFAULT_SETTINGS.appearance, ...s?.appearance }
      const pref = (appearance.canvasTheme ?? 'auto') as CanvasThemePref
      setPrefState(pref)
      setTheme(resolveCanvasTheme(pref, appearance.mode))
    }
    void settingsRepo.get().then(apply)
    const off = eventBus.on('settings:changed', (p) => apply(p.settings))
    return () => {
      alive = false
      off()
    }
  }, [])
  const setPref = (id: CanvasThemePref) => {
    void settingsRepo.save({ appearance: { canvasTheme: id } })
  }
  return { pref, theme, setPref }
}

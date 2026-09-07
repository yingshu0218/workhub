import type { Trophy, TrophyTier } from '@/db/types'

/**
 * 奖杯分享海报（审计 Phase 4/5 P2-12「奖杯海报未实装」）：
 * Canvas 绘制 —— tier 渐变底 + 奖杯图标 + 名称 + 解锁日期 + Lv 徽章 + 应用名，下载 PNG。
 * 图标复用打包内的 Material Symbols SVG 资产（与 Icon 组件同源），转 data URL 光栅化绘制。
 */

/** tier → 海报渐变端色（与 TIER_THEME 的 Tailwind 渐变视觉对齐，Canvas 需要 hex） */
const TIER_COLORS: Record<TrophyTier, [string, string, string]> = {
  '铜': ['#92400e', '#f59e0b', '#fde68a'],
  '银': ['#94a3b8', '#cbd5e1', '#f1f5f9'],
  '金': ['#f59e0b', '#facc15', '#fef3c7'],
  '白金': ['#0891b2', '#7dd3fc', '#e0e7ff'],
}

/** 与 Icon 组件同一资产源：按需懒加载原始 SVG 字符串 */
const iconModules = import.meta.glob<string>('../../assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
})

/** SVG 字符串 → Image（指定渲染色；源 SVG 未带 fill，注入目标色） */
async function loadIcon(name: string, color: string, size: number): Promise<HTMLImageElement | null> {
  const loader = iconModules[`../../assets/icons/${name}.svg`]
  if (!loader) return null
  const raw = await loader()
  const colored = raw.replace('<svg ', `<svg fill="${color}" width="${size}" height="${size}" `)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(colored)}`
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 生成分享海报并触发 PNG 下载 */
export async function downloadTrophyPoster(trophy: Trophy, level: number): Promise<void> {
  const W = 800
  const H = 1000
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 Canvas 绘制')
  const [c1, c2, c3] = TIER_COLORS[trophy.tier]

  // 深色底 + tier 渐变光晕
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0b1220')
  bg.addColorStop(1, '#1e293b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 380, 60, W / 2, 380, 420)
  glow.addColorStop(0, `${c2}55`)
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // 顶栏：应用名
  ctx.fillStyle = 'rgba(255,255,255,0.65)'
  ctx.font = '600 26px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('寻鸽工作台 · Nexus Workspace', W / 2, 88)

  // 奖杯图标底座（tier 渐变圆角方块）
  const boxSize = 200
  const boxX = (W - boxSize) / 2
  const boxY = 200
  const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxSize, boxY + boxSize)
  grad.addColorStop(0, c1)
  grad.addColorStop(0.5, c2)
  grad.addColorStop(1, c3)
  ctx.fillStyle = grad
  roundRect(ctx, boxX, boxY, boxSize, boxSize, 36)
  ctx.fill()

  // 奖杯图标（SVG 资产白色光栅化；加载失败回退绘制奖杯 emoji 文本）
  const icon = await loadIcon(trophy.unlockedAt ? trophy.icon : 'lock', '#ffffff', 120)
  if (icon) {
    ctx.drawImage(icon, (W - 120) / 2, boxY + (boxSize - 120) / 2, 120, 120)
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.font = '96px system-ui'
    ctx.fillText('🏆', W / 2, boxY + boxSize / 2 + 34)
  }

  // tier 标签 + 稀有度
  const tierLabel = { '铜': '铜杯', '银': '银杯', '金': '金杯', '白金': '白金' }[trophy.tier]
  ctx.fillStyle = c3
  ctx.font = 'bold 22px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(`${tierLabel} · 稀有度 ${trophy.rarity}`, W / 2, 470)

  // 奖杯名称
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 52px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(trophy.name, W / 2, 550)

  // 描述（最多两行截断）
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '24px system-ui, -apple-system, "PingFang SC", sans-serif'
  const maxChars = 20
  const desc = trophy.description
  const lines = desc.length <= maxChars ? [desc] : [desc.slice(0, maxChars), desc.slice(maxChars, maxChars * 2)]
  lines.forEach((line, i) => ctx.fillText(line, W / 2, 604 + i * 36))

  // Lv 徽章（圆形徽章 + 等级数字）
  const badgeX = W / 2
  const badgeY = 740
  const badgeR = 56
  const badgeGrad = ctx.createLinearGradient(badgeX - badgeR, badgeY - badgeR, badgeX + badgeR, badgeY + badgeR)
  badgeGrad.addColorStop(0, c1)
  badgeGrad.addColorStop(1, c3)
  ctx.fillStyle = badgeGrad
  ctx.beginPath()
  ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.font = '600 18px system-ui, sans-serif'
  ctx.fillText('LEVEL', badgeX, badgeY - 12)
  ctx.font = 'bold 34px system-ui, sans-serif'
  ctx.fillText(String(level), badgeX, badgeY + 16)
  ctx.textBaseline = 'alphabetic'

  // 解锁日期
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '24px system-ui, -apple-system, "PingFang SC", sans-serif'
  const date = trophy.unlockedAt
    ? new Date(trophy.unlockedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : '未解锁'
  ctx.fillText(`解锁于 ${date}`, W / 2, 856)

  // 底部署名
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '20px system-ui, sans-serif'
  ctx.fillText('成就殿堂 · Trophies', W / 2, 936)

  // 下载 PNG
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('海报导出失败')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `trophy-${trophy.name}-${new Date(trophy.unlockedAt ?? Date.now()).toISOString().slice(0, 10)}.png`
  a.click()
  URL.revokeObjectURL(url)
}

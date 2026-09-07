import type { CSSProperties } from 'react'

/**
 * 内联 SVG 图标（替代 4.6MB Material Symbols 图标字体）
 * 图标源：@material-symbols/svg-400/rounded，构建期按需打包进 JS（无字体、无 FOUC）
 * 用法：<Icon name="dashboard" size={20} />；尺寸跟随 1em，可用 className 的 text-[Npx] 控制
 */
const modules = import.meta.glob('../assets/icons/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const ICONS: Record<string, string> = {}
for (const [path, svg] of Object.entries(modules)) {
  const name = path.replace('../assets/icons/', '').replace('.svg', '')
  ICONS[name] = svg
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace('<svg ', '<svg fill="currentColor" width="1em" height="1em" ')
}

export function Icon({
  name,
  className = '',
  size,
  fill = false,
  style,
}: {
  name: string
  className?: string
  size?: number
  fill?: boolean
  style?: CSSProperties
}) {
  const svg = (fill && ICONS[name + '-fill']) || ICONS[name]
  if (!svg) return null
  return (
    <span
      className={`inline-block shrink-0 align-[-0.15em] ${className}`}
      style={{ fontSize: size, width: '1em', height: '1em', lineHeight: 1, ...style }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

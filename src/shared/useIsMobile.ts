import { useEffect, useState } from 'react'

/**
 * 桌面 / 移动分界。
 *
 * 三处必须一致，改一处要同时改另外两处：
 * 1. 本文件
 * 2. `AppLayout` 里 Tailwind 的 `md` 断点（= `min-width: 48rem` = **768px**）
 * 3. `styles/index.css` 里移动壳 / 移动弹层的 `@media (max-width: 47.99rem)`
 *
 * 为什么查询串写 `47.99rem` 而不是 `767px`：媒体查询里的 rem 取**浏览器默认字号**
 * （实测：页面设了 `html{font-size:14px}`，48rem 仍解析为 768px），与 Tailwind 的
 * `md` 同单位才能永远互补。用户调大浏览器默认字号时两边一起走，不会裂出夹缝。
 */
const QUERY = '(max-width: 47.99rem)'

/** 人眼可读的分界值，仅供注释与测试断言引用，**不参与查询** */
export const MOBILE_MAX_WIDTH = 768

function matches(): boolean {
  // 测试环境（happy-dom / jsdom）与 SSG 场景可能没有 matchMedia，退化到桌面形态而不是抛错
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

/**
 * 当前是否处于**移动形态**（视口宽 ≤ 767px）。
 *
 * 为什么需要它 ——「能用 CSS 就别用 JS」是本仓库的既定顺序：
 * 侧栏显隐、栅格降列、内边距这类差异一律用 Tailwind 断点类表达，避免 JS 判定带来的首帧跳变。
 * 只有**结构真的不同**的地方（表格 → 卡片列表、某控件在窄屏不适用）没法只靠类名切换，
 * 这时才用本 hook。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(matches)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = () => setIsMobile(mql.matches)
    onChange() // 首帧之后视口可能已变（如旋转屏幕），挂载时对齐一次
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

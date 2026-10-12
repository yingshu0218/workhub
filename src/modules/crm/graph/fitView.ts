import { clampScale, type ViewState } from '../usePanZoom'

/**
 * 「适应画布」视图变换的纯函数（从 GraphCanvas.fitView 抽出，2026-10-12）
 *
 * 抽出来的唯一理由：这段数学出过一次**真实缺陷**，而它埋在组件闭包里根本没有单测能碰到。
 * 缺陷：存进 view 的 scale 被 clamp 进 [0.5, 2]，但 tx/ty 仍按**未钳制**的原始 scale 反算，
 * 缩放与平移不自洽 → 图形整体偏离视口中心，偏离量 = |原始 scale − 钳制 scale| × 包围盒中心距。
 * 大图（需缩到 <0.5）与小图（需放大到 >2）都会中招，表现为「视图基准定位总是出错」。
 *
 * 不变式（单测锁住）：包围盒中心 w 经 `w * scale + t` 映射后必须落在视口中心。
 */

/** 画布四周留白（像素）：让节点不被视口边缘切掉 */
export const FIT_PADDING = 48

export interface FitNode {
  x?: number | null
  y?: number | null
  radius: number
}

/**
 * 计算把全部有坐标节点收进视口并居中的视图变换。
 * @returns 不可计算（无坐标节点 / 视口尺寸为 0）时返回 null，由调用方决定兜底视图。
 */
export function computeFitView(
  nodes: readonly FitNode[],
  size: { w: number; h: number },
  pad: number = FIT_PADDING,
): ViewState | null {
  if (size.w <= 0 || size.h <= 0) return null
  const visible = nodes.filter((n) => n.x != null && n.y != null)
  if (visible.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of visible) {
    minX = Math.min(minX, n.x! - n.radius)
    minY = Math.min(minY, n.y! - n.radius)
    maxX = Math.max(maxX, n.x! + n.radius)
    maxY = Math.max(maxY, n.y! + n.radius)
  }
  const bw = Math.max(maxX - minX, 1)
  const bh = Math.max(maxY - minY, 1)
  // 先钳制，再用同一个 scale 反算平移 —— 顺序反了就是上面那条缺陷
  const scale = clampScale(Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh))
  return {
    scale,
    tx: size.w / 2 - ((minX + maxX) / 2) * scale,
    ty: size.h / 2 - ((minY + maxY) / 2) * scale,
  }
}

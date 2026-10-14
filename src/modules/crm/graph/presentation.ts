import { RELATION_CATEGORIES } from '@/db/types'
import type { GraphLink } from './types'

/**
 * 画布**展示口径**的纯函数（2026-10-14）：渲染层与单测共用同一实现。
 *
 * 抽出来的理由：这两件事以前一个散在渲染闭包里（环半径）、一个根本没有（边悬浮框），
 * 都属于「改错了没人拦」的那一类。放这里就能被单测钉住口不变式。
 */

/* ────────────────── customer-only 的圈层布局 ────────────────── */

/** 环半径下限：客户很少时也要把环撑开，「我」周围不至于被贴脸 */
export const RING_MIN_RADIUS = 200
/** 每个客户摊到的弧长预算：客户越多环越大，保证环上相邻节点不重叠 */
export const RING_PER_NODE = 26
/** 节点之间的最小间隙（碰撞半径 = 节点半径 + 它），给名字标签留位 */
export const COLLIDE_PADDING = 26
/**
 * 所有节点的统一半径（2026-10-14 用户裁决：**所有节点统一大小**）。
 *
 * 为什么不再按健康分档位变大小：① 档位差 → 半径差 → 环上间距不匀、视觉噪点多；
 * ② 环形布局里位置已经表达了远近，「越亲近越大」这条编码是重复信息；
 * ③ 半径还牵动碰撞间距与环上不重叠判据，统一后这些约束都变成常量、好推理。
 * 档位**仍然用颜色表达**（`INTIMACY_VISUAL[level].color`），只是不再编码成大小。
 */
export const NODE_RADIUS = 24

/**
 * 圈层半径（以「我」为圆心）：`max(下限, 每节点预算 × 客户数)`。
 *
 * 为什么要有下限：只有 1~3 个客户时按弧长预算算出来的环太小，客户会贴在「我」身上，
 * 「以我为中心」看起来像「挤在一起」。为什么要有预算：客户一多，环必须跟着长大，
 * 否则环上相邻节点会重叠 —— 该预算保证了任意客户数下环周长都够摊开（见单测）。
 */
export function ringRadius(customerCount: number): number {
  return Math.max(RING_MIN_RADIUS, RING_PER_NODE * Math.max(0, customerCount))
}

/* ────────────── 环上槽位（保证「我」在正中心） ────────────── */

/** 环上第 index 个槽位的角度：从正上方（-90°）起顺时针均分 */
export function slotAngle(index: number, count: number): number {
  return -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(count, 1)
}

export interface RingSlot {
  id: string
  x: number
  y: number
}

/**
 * 把客户**均匀**摆到环上（2026-10-14 用户裁决：「中心节点是在所有其他节点的正中心」）。
 *
 * 这是对「以我为中心」的**几何口径**：均匀分角时，全部槽位坐标的质心**恒等于**圆心，
 * 也就是「我」恰好落在其他节点的正中心。只靠力场做不到这一点 —— 关系连线会把有关系的客户
 * 拽到一起，环约束只管半径、管不了角度，于是整团人偏到一侧（用户截图里就是这样）。
 * 所以位置改为**确定性槽位**，力场只负责把它当作目标点收敛。
 *
 * ⚠️ 边界：n = 1 时不存在「质心等于圆心」的解（一个点的质心就是它自己），此时客户落在正上方。
 */
export function ringSlots(
  orderedIds: readonly string[],
  center: { x: number; y: number },
  radius: number,
): RingSlot[] {
  const n = orderedIds.length
  return orderedIds.map((id, i) => {
    const a = slotAngle(i, n)
    return { id, x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius }
  })
}

/**
 * 排座次：让**有关系的客户在环上相邻**（边短、不横穿中心）。
 *
 * 做法是从第一个客户起走一条贪心链：优先接「与刚落位者有关联」的客户，没有就按原顺序取下一个。
 * 为什么值得做：环上位置一旦均匀分角，关系的两端若落在环的对侧，那条弧就会横穿圆心，
 * 视觉上从「我」身上压过去。相邻之后弧只剩很短一段，读起来也顺。
 */
export function orderByRelation(
  ids: readonly string[],
  pairs: readonly (readonly [string, string])[],
): string[] {
  if (ids.length <= 2) return [...ids]
  const adj = new Map<string, string[]>()
  for (const [a, b] of pairs) {
    if (!a || !b || a === b) continue
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }
  const remaining = new Set(ids)
  const out: string[] = []
  let cursor = ids[0]!
  while (remaining.size > 0) {
    remaining.delete(cursor)
    out.push(cursor)
    const next =
      (adj.get(cursor) ?? []).find((x) => remaining.has(x)) ?? ids.find((x) => remaining.has(x))
    if (!next) break
    cursor = next
  }
  return out
}

/* ────────────────── 关系边的悬浮框内容 ────────────────── */

export interface RelationEdgeInfo {
  /** 该对客户之间的全部语义（同一对允许多条，Issue #39） */
  labels: string[]
  /** 归类维度的中文名（并集） */
  categories: string[]
}

/**
 * 关系边悬浮框要展示的字段（2026-10-14 用户裁决）：
 * 连线本身不再写文字（多条语义叠在一起必然互相压字），改为鼠标悬停时用一个浮框给出
 * 「语义 + 归类」这两项关联字段。数据来源仍是 buildGraph 聚合后的 labels/categories。
 */
export function relationEdgeInfo(link: GraphLink): RelationEdgeInfo {
  const labels = link.labels ?? (link.label ? [link.label] : [])
  return {
    labels,
    categories: (link.categories ?? []).map(
      (c) => RELATION_CATEGORIES.find((x) => x.id === c)?.name ?? c,
    ),
  }
}

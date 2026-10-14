import { RELATION_CATEGORIES } from '@/db/types'
import type { GraphLink } from './types'

/**
 * 画布**展示口径**的纯函数（2026-10-14）：渲染层与单测共用同一实现。
 *
 * 抽出来的理由：这两件事以前一个散在渲染闭包里（环半径）、一个根本没有（边悬浮框），
 * 都属于「改错了没人拦」的那一类。放这里就能被单测钉住口不变式。
 */

/* ────────────────── customer-only 的圈层布局 ────────────────── */

/** 环半径下限：客户很少时也要把环撑开，「我」周围不至于被贴脸（节点最大半径 T1=34） */
export const RING_MIN_RADIUS = 200
/** 每个客户摊到的弧长预算：客户越多环越大，保证环上相邻节点不重叠 */
export const RING_PER_NODE = 26
/** 节点之间的最小间隙（碰撞半径 = 节点半径 + 它），给名字标签留位 */
export const COLLIDE_PADDING = 22
/** 客户节点可能的最大半径（T1，见 INTIMACY_VISUAL）；不重叠判据按它取最坏情况 */
export const MAX_CUSTOMER_RADIUS = 34

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

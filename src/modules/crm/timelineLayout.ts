import dayjs from 'dayjs'
import { fmtMoney, type TimelineEvent } from './timeline'
import { financeFocusPath } from '@/modules/finance/links'
import { todoFocusPath } from '@/modules/todo/domain'

/**
 * 鱼骨「事件 → 骨刺坐标」纯函数（Issue #22 抽取纪律：先抽纯函数，再包组件壳）
 * 单客户视图（等距单轴）与全部视图（按客户分带 lane）共用 Bone 形态，
 * 布局差异只在分带 y 偏移与间距策略上。
 */

export const SPINE_Y = 0
export const HEAD_W = 190
export const HEAD_H = 132

export interface Bone {
  event: TimelineEvent
  /** 主轴上的世界坐标 x（事件锚点） */
  x: number
  /** 骨刺方向：上（正向）/ 下（负向） */
  up: boolean
  /** 骨刺长度（跟随金额/优先级轻微变化，视觉分组） */
  len: number
  /** 骨刺终点（短横端） */
  tipY: number
  label: string
  sub: string
  color: string
  fill: string
  /** 分带偏移（全部视图按客户分带；单客户视图恒为 0） */
  laneY?: number
}

export function boneColor(e: TimelineEvent): { color: string; fill: string } {
  if (e.kind === 'transaction')
    return e.direction === 'income'
      ? { color: '#006c49', fill: '#6cf8bb' }
      : { color: '#ba1a1a', fill: '#ffdad6' }
  if (e.kind === 'todo') {
    // 三态配色（Issue #128）：完成=绿 / 作废=中性灰（终止而非成功，不得用成功率语义） / 进行中=橙
    if (e.status === 'done') return { color: '#006c49', fill: '#6cf8bb' }
    if (e.status === 'voided') return { color: '#737686', fill: '#e5eeff' }
    return { color: '#943700', fill: '#ffede6' }
  }
  return { color: '#004ac6', fill: '#dbe1ff' }
}

export function boneUp(e: TimelineEvent): boolean {
  if (e.kind === 'transaction') return e.direction === 'income'
  // 待办骨刺方向：完成向上（正向），作废/进行中向下（Issue #128 作废不算成功，不上扬）
  if (e.kind === 'todo') return e.status === 'done'
  return false
}

export function boneLabel(e: TimelineEvent): string {
  if (e.kind === 'transaction')
    return `${e.direction === 'income' ? '+' : '-'}${fmtMoney(e.amount)}`
  if (e.kind === 'todo') {
    if (e.status === 'done') return '完成待办'
    if (e.status === 'voided') return '作废待办'
    return '新增待办'
  }
  return '沟通'
}

export function boneSub(e: TimelineEvent): string {
  const t = dayjs(e.at).format('MM-DD')
  if (e.kind === 'transaction') return `${t} · ${e.summary}`
  if (e.kind === 'todo') return `${t} · ${e.title}`
  return `${t} · ${e.content}`
}

/** 骨刺穿透目标：点击跳转并定位对应记录 */
export function boneTarget(e: TimelineEvent): string | undefined {
  if (e.kind === 'interaction') return '/activities/' + encodeURIComponent(e.id)
  if (e.kind === 'transaction') return financeFocusPath(e.recordId)
  if (e.kind === 'todo') return todoFocusPath(e.recordId)
  return undefined
}

/**
 * 单客户等距铺开布局（原 CustomerTimelinePage 逻辑原样抽出）
 * worldBounds 供「适应画布」用：只按真实骨刺范围取（tipY ± 标签高度、末端标签宽度），
 * 不写死 minY/maxY —— 写死会在只有一个骨刺时把画面压到 0.5 下限，看着还是「缩小的一片」
 * （Issue #130 用户反馈「时间线视图仍不行」）。
 */
export function layoutSingleBones(events: TimelineEvent[]): {
  bones: Bone[]
  maxX: number
  worldBounds: { minX: number; maxX: number; minY: number; maxY: number }
} {
  const ordered = [...events].sort((a, b) => a.at - b.at)
  const innerW = 920
  const step = innerW / (ordered.length + 1)
  const bones: Bone[] = []
  const lastTip = { up: 0, down: 0 } as Record<'up' | 'down', number>
  ordered.forEach((e, i) => {
    const x = 60 + step * (i + 1)
    const up = boneUp(e)
    // 交替侧向偏移：同侧相邻骨刺错开，避免端点短横重叠
    const len =
      64 +
      (lastTip[up ? 'up' : 'down'] % 2 === i % 2 ? 0 : 26) +
      (e.kind === 'transaction' ? 14 : 0)
    lastTip[up ? 'up' : 'down']++
    bones.push({
      event: e,
      x,
      up,
      len,
      tipY: up ? SPINE_Y - len : SPINE_Y + len,
      label: boneLabel(e),
      sub: boneSub(e),
      color: boneColor(e).color,
      fill: boneColor(e).fill,
      laneY: 0,
    })
  })
  const maxX = 60 + step * ordered.length + 20 + HEAD_W
  const tipYs = bones.map((b) => b.tipY)
  return {
    bones,
    maxX,
    // 标签高度（骨刺标签在 tipY 上/下再占一行）+ 鱼头高度的一半 —— 不裁掉任何可见内容
    worldBounds: {
      minX: 0,
      maxX,
      minY: Math.min(0, ...tipYs.map((y) => y - 18)) - HEAD_H / 2,
      maxY: Math.max(0, ...tipYs.map((y) => y + 18)) + HEAD_H / 2,
    },
  }
}

/** 全部视图布局：共享时间轴主轴 + 按客户分带（lane），客户多时骨刺不叠成刺猬 */
export function layoutLanedBones(
  events: TimelineEvent[],
  customerOrder: string[],
  customerLane: Map<string, number>,
): { bones: Bone[]; maxX: number; minY: number; maxY: number } {
  const ordered = [...events].sort((a, b) => a.at - b.at)
  const innerW = 1120
  const step = innerW / (ordered.length + 1)
  const LANE_H = 96
  const bones: Bone[] = []
  const laneTick: Record<string, number> = {}
  ordered.forEach((e, i) => {
    const cid = e.customerId ?? ''
    const laneIdx = customerLane.get(cid) ?? 0
    const laneY = laneIdx * LANE_H
    const x = 60 + step * (i + 1)
    const up = boneUp(e)
    const key = `${cid}:${up ? 'up' : 'down'}`
    const len =
      52 +
      ((laneTick[key] = (laneTick[key] ?? 0) + 1) % 2 === 0 ? 22 : 0) +
      (e.kind === 'transaction' ? 12 : 0)
    laneTick[key] = laneTick[key] ?? 0
    bones.push({
      event: e,
      x,
      up,
      len,
      tipY: up ? SPINE_Y - len : SPINE_Y + len,
      label: boneLabel(e),
      sub: boneSub(e),
      color: boneColor(e).color,
      fill: boneColor(e).fill,
      laneY,
    })
  })
  const bandCount = Math.max(customerOrder.length, 1)
  return {
    bones,
    maxX: 60 + step * ordered.length + 20,
    minY: -60,
    maxY: bandCount * LANE_H + 40,
  }
}

/** 客户分带主题色（少量固定色板循环，与骨刺配色不冲突） */
export const LANE_COLORS = [
  '#004ac6',
  '#006c49',
  '#943700',
  '#6d43c4',
  '#ba1a1a',
  '#4a4458',
] as const

export function laneColor(index: number): string {
  return LANE_COLORS[index % LANE_COLORS.length]
}

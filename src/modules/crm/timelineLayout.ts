import dayjs from 'dayjs'
import { fmtMoney, type TimelineEvent } from './timeline'

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
  if (e.kind === 'todo')
    return e.event === 'done'
      ? { color: '#006c49', fill: '#6cf8bb' }
      : { color: '#943700', fill: '#ffede6' }
  return { color: '#004ac6', fill: '#dbe1ff' }
}

export function boneUp(e: TimelineEvent): boolean {
  if (e.kind === 'transaction') return e.direction === 'income'
  if (e.kind === 'todo') return e.event === 'done'
  return false
}

export function boneLabel(e: TimelineEvent): string {
  if (e.kind === 'transaction')
    return `${e.direction === 'income' ? '+' : '-'}${fmtMoney(e.amount)}`
  if (e.kind === 'todo') return e.event === 'done' ? '完成待办' : '新增待办'
  return e.type
}

export function boneSub(e: TimelineEvent): string {
  const t = dayjs(e.at).format('MM-DD')
  if (e.kind === 'transaction') return `${t} · ${e.summary}`
  if (e.kind === 'todo') return `${t} · ${e.title}`
  return `${t} · ${e.content}`
}

/** 骨刺穿透目标：点击跳转并定位对应记录 */
export function boneTarget(e: TimelineEvent): string | undefined {
  if (e.kind === 'transaction') return `/finance?focus=${encodeURIComponent(e.recordId)}`
  if (e.kind === 'todo') return `/todo?focus=${encodeURIComponent(e.recordId)}`
  return undefined
}

/** 单客户等距铺开布局（原 CustomerTimelinePage 逻辑原样抽出） */
export function layoutSingleBones(events: TimelineEvent[]): { bones: Bone[]; maxX: number } {
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
  return { bones, maxX: 60 + step * ordered.length + 20 + HEAD_W }
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

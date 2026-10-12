import { describe, expect, it } from 'vitest'
import { computeFitView, FIT_PADDING } from '../fitView'
import { SCALE_MAX, SCALE_MIN } from '../../usePanZoom'

/**
 * 「适应画布」视图变换的回归测试（2026-10-12）
 *
 * 锁死的不变式：**包围盒中心经过 `w * scale + t` 映射后必须落在视口中心**。
 * 背景：修复前实现先算原始 scale、再用原始 scale 反算平移，却只把 scale 钳制进 [0.5, 2]，
 * 于是 scale 与 t 不自洽 → 图形整体偏离视口中心。用例 2/3 专门覆盖「需要钳制」的两个极端，
 * 这两条在修复前必然失败（断言的是同一个不变式，不是实现细节）。
 */

const size = { w: 1000, h: 600 }

/** 断言：包围盒中心映射回视口中心（允许浮点误差） */
function expectCentered(
  nodes: { x: number; y: number; radius: number }[],
  v: { scale: number; tx: number; ty: number } | null,
) {
  expect(v).not.toBeNull()
  const cx = (Math.min(...nodes.map((n) => n.x - n.radius)) + Math.max(...nodes.map((n) => n.x + n.radius))) / 2
  const cy = (Math.min(...nodes.map((n) => n.y - n.radius)) + Math.max(...nodes.map((n) => n.y + n.radius))) / 2
  expect(cx * v!.scale + v!.tx).toBeCloseTo(size.w / 2, 6)
  expect(cy * v!.scale + v!.ty).toBeCloseTo(size.h / 2, 6)
}

describe('computeFitView', () => {
  it('常规规模：图形居中，且较长的一边方向撑满可用区域（减去留白）', () => {
    const nodes = [
      { x: 0, y: 0, radius: 20 },
      { x: 400, y: 300, radius: 20 },
    ]
    const bw = 440
    const bh = 340
    const v = computeFitView(nodes, size)
    expectCentered(nodes, v)
    expect(v!.scale).toBeCloseTo(
      Math.min((size.w - FIT_PADDING * 2) / bw, (size.h - FIT_PADDING * 2) / bh),
      6,
    )
  })

  it('回归：小图需放大到 >2 时，仍必须居中（scale 被钳制但平移不能沿用原始 scale）', () => {
    // 单节点：包围盒只有 2*radius，原始 scale 远超 SCALE_MAX
    const nodes = [{ x: 800, y: 500, radius: 24 }]
    const v = computeFitView(nodes, size)
    expect(v!.scale).toBe(SCALE_MAX)
    expectCentered(nodes, v)
  })

  it('回归：大图需缩到 <0.5 时，仍必须居中', () => {
    // 刻意用**非对称于原点**的包围盒：中心不在原点上，钳制与未钳制的平移才可区分
    const nodes = [
      { x: 500, y: 300, radius: 30 },
      { x: 8500, y: 5300, radius: 30 },
    ]
    const v = computeFitView(nodes, size)
    expect(v!.scale).toBe(SCALE_MIN)
    expectCentered(nodes, v)
  })

  it('scale 恒在 [SCALE_MIN, SCALE_MAX] 内', () => {
    for (const spread of [1, 100, 10000]) {
      const v = computeFitView(
        [
          { x: -spread, y: -spread, radius: 10 },
          { x: spread, y: spread, radius: 10 },
        ],
        size,
      )
      expect(v!.scale).toBeGreaterThanOrEqual(SCALE_MIN)
      expect(v!.scale).toBeLessThanOrEqual(SCALE_MAX)
    }
  })

  it('无坐标节点返回 null（由调用方兜底单位视图）', () => {
    expect(computeFitView([{ x: null, y: null, radius: 10 }], size)).toBeNull()
    expect(computeFitView([], size)).toBeNull()
  })

  it('视口尺寸为 0 返回 null（首帧 ResizeObserver 未上报前的真实状态）', () => {
    expect(computeFitView([{ x: 0, y: 0, radius: 10 }], { w: 0, h: 0 })).toBeNull()
  })
})

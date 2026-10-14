import { describe, expect, it } from 'vitest'
import {
  COLLIDE_PADDING,
  MAX_CUSTOMER_RADIUS,
  RING_MIN_RADIUS,
  RING_PER_NODE,
  relationEdgeInfo,
  ringRadius,
} from '../presentation'

/**
 * 画布展示口径的回归锁（2026-10-14 用户裁决：以我为中心、不重叠；连线不写字、悬停看详情）
 *
 * 锁的是两条**用户看得见的观感判据**，而不是实现细节：
 * ① 环半径必须同时满足「不缩到『我』脸上」与「环上相邻节点不重叠」——两个方向都要有下界，
 *    这就是它不能用「随便一个随客户数变大的数」糊过去的原因；
 * ② 悬浮框要展示的字段口径（语义 + 归类），与 buildGraph 聚合出来的 labels/categories 对齐。
 */

/** 「我」自节点的半径（buildGraph 里的常量 30，这里按字面取，用于估算贴脸阈值） */
const SELF_RADIUS = 30

describe('ringRadius：圈层半径的两个下界', () => {
  it('客户很少时也不会缩到「我」脸上', () => {
    // 贴脸阈值 = 「我」半径 + 客户最大半径（两者的圈相切）。环必须明显大于它
    expect(ringRadius(1)).toBeGreaterThan((SELF_RADIUS + MAX_CUSTOMER_RADIUS) * 1.5)
    expect(ringRadius(2)).toBeGreaterThanOrEqual(RING_MIN_RADIUS)
    expect(ringRadius(0)).toBe(RING_MIN_RADIUS) // 空图也不返回 0（避免除零式的边界值）
  })

  it('随客户数单调不减', () => {
    let prev = 0
    for (let n = 0; n <= 40; n++) {
      const r = ringRadius(n)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
  })

  it('任意客户数下，环上相邻两个节点的圆心距离都放得下两个节点（不重叠）', () => {
    const needed = 2 * MAX_CUSTOMER_RADIUS + COLLIDE_PADDING
    for (let n = 2; n <= 60; n++) {
      const r = ringRadius(n)
      // 均匀分布在环上时，相邻圆心距（弦长）= 2R·sin(π/n)
      const chord = 2 * r * Math.sin(Math.PI / n)
      expect(chord, `n=${n} 弦长 ${chord.toFixed(1)} < 需要 ${needed}`).toBeGreaterThanOrEqual(needed)
    }
  })

  it('每节点弧长预算大于「两个最大节点」直径，保证大客户数时环仍够宽', () => {
    // 大 n 时弦长趋近 2πR/n = 2π·RING_PER_NODE，必须大于 2*最大半径 + 间隙
    expect(2 * Math.PI * RING_PER_NODE).toBeGreaterThan(2 * MAX_CUSTOMER_RADIUS + COLLIDE_PADDING)
  })
})

describe('relationEdgeInfo：悬浮框字段口径', () => {
  it('多条语义全带出，归类映射成中文名', () => {
    expect(
      relationEdgeInfo({
        source: 'a',
        target: 'b',
        kind: 'relation',
        label: '项目合作 / 转介绍人',
        labels: ['项目合作', '转介绍人'],
        categories: ['project', 'person'],
      }),
    ).toEqual({ labels: ['项目合作', '转介绍人'], categories: ['项目', '关联人物'] })
  })

  it('只填了 label（旧数据/单条）时也能兜底展示', () => {
    expect(
      relationEdgeInfo({ source: 'a', target: 'b', kind: 'relation', label: '同行伙伴' }),
    ).toEqual({ labels: ['同行伙伴'], categories: [] })
  })

  it('无归类时不编归类（页面据此不渲染「归类：」那一行）', () => {
    const info = relationEdgeInfo({ source: 'a', target: 'b', kind: 'relation', labels: ['x'] })
    expect(info.categories).toEqual([])
  })
})

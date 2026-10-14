import { describe, expect, it } from 'vitest'
import { buildGraph, SELF_NODE_ID } from '../buildGraph'
import { NODE_RADIUS } from '../presentation'
import { GRAPH_COLORS } from '../types'
import type { CanvasGraph } from '../../hooks'

/**
 * 「我」自节点契约（Issue #123，2026-10-12 修订）：
 * - customer-only 模式下画布中心必须且仅有一个 kind='self' 节点，坐标锁定画布中心（fx/fy）
 * - 「我」**不与任何节点连线**（用户裁决）：以我为中心是布局/视图概念，不由连线表达；
 *   因此自节点是孤立节点 —— 这是预期形态，不是缺陷
 * - 「我」的文案取当前用户身份名（默认阿蓝），不再是「挑一个客户打补丁冒充我」
 */
const makeGraph = (): CanvasGraph => ({
  customers: [
    {
      id: 'c1',
      name: '严伟强',
      company: '深蓝科技',
      
      lastContactAt: 1000,
      relations: [{ targetId: 'c2', label: '项目合作', category: 'project' }],
    },
    {
      id: 'c2',
      name: '林晓棠',
      company: '云上文创',
      
      lastContactAt: 900,
      relations: [{ targetId: 'c1', label: '项目合作', category: 'project' }],
    },
    { id: 'c3', name: '赵屹峰', company: '启衡咨询', lastContactAt: 800, relations: [] },
  ],
  projects: [],
  transactions: [],
  todos: [],
  interactions: [],
  notes: [],
  projectStatuses: {},
})

const center = { x: 400, y: 300 }

describe('buildGraph customer-only「我」自节点', () => {
  it('产出唯一 self 节点且锁定画布中心', () => {
    const { nodes } = buildGraph(makeGraph(), { mode: 'customer-only', center, selfName: '阿蓝' })
    const selves = nodes.filter((n) => n.kind === 'self')
    expect(selves).toHaveLength(1)
    expect(selves[0].id).toBe(SELF_NODE_ID)
    expect(selves[0].label).toBe('阿蓝')
    expect(selves[0].x).toBe(center.x)
    expect(selves[0].y).toBe(center.y)
    // fx/fy 锁死：不参与力导向漂移
    expect(selves[0].fx).toBe(center.x)
    expect(selves[0].fy).toBe(center.y)
  })

  it('「我」不与任何节点连线（中心基准 = 孤立节点）', () => {
    const { nodes, links } = buildGraph(makeGraph(), {
      mode: 'customer-only',
      center,
      selfName: '阿蓝',
    })
    const endId = (v: string | { id: string }) => (typeof v === 'string' ? v : v.id)
    const touching = links.filter(
      (l) => endId(l.source) === SELF_NODE_ID || endId(l.target) === SELF_NODE_ID,
    )
    expect(touching).toHaveLength(0)
    // 且不存在任何 kind='self' 的边（该边类型已从契约中移除）
    expect(links.some((l) => (l.kind as string) === 'self')).toBe(false)
    // 客户节点自身仍全部作为节点存在，只是不与「我」相连
    expect(nodes.filter((n) => n.kind === 'customer')).toHaveLength(3)
  })

  it('未传 selfName 时回落「我」，不产生空文案节点', () => {
    const { nodes } = buildGraph(makeGraph(), { mode: 'customer-only', center })
    expect(nodes.find((n) => n.kind === 'self')?.label).toBe('我')
  })

  it('既有语义关系边仍保留（自节点不吞掉 relations）', () => {
    const { links } = buildGraph(makeGraph(), {
      mode: 'customer-only',
      center,
      selfName: '阿蓝',
    })
    const rel = links.filter((l) => l.kind === 'relation')
    expect(rel).toHaveLength(1)
    expect(rel[0].label).toBe('项目合作')
    expect(rel[0].categories).toEqual(['project'])
  })

  it('mixed 模式不注入自节点（业务实体视角保持原样）', () => {
    const { nodes } = buildGraph(makeGraph(), { mode: 'mixed', center })
    expect(nodes.some((n) => n.kind === 'self')).toBe(false)
  })

  it('画布不屏蔽任何客户：I7 客户照样出现在画布上（健康分与画布彻底解耦）', () => {
    // 2026-10-14 用户裁决：画布是关系视图，不该因为「健康分把某人判成 I7」而少一个人。
    // 原先的 hideInGraph 过滤已删除 —— 这条用例就是那个决定的反回退锁。
    const g = makeGraph()
    g.customers[2]!.intimacy = { level: 'I7', note: '', updatedAt: 0 }
    const { nodes } = buildGraph(g, { mode: 'customer-only', center, selfName: '阿蓝' })
    expect(nodes.filter((n) => n.kind === 'customer')).toHaveLength(3)
    // 而且它和别的客户在画布上长得一模一样（没有档位痕迹）
    const i7 = nodes.find((n) => n.id === 'c3')!
    expect(i7.radius).toBe(NODE_RADIUS)
    expect(i7.color).toBe(GRAPH_COLORS.customer.stroke)
  })

  it('健康分不上画布：节点大小与颜色都与档位无关（2026-10-14 用户裁决）', () => {
    // 三个客户刻意给不同档位（T1 / T3 / T5）——大小与描边色都必须完全一致
    const g = makeGraph()
    g.customers[0]!.intimacy = { level: 'T1', note: '', updatedAt: 0 }
    g.customers[1]!.intimacy = { level: 'T3', note: '', updatedAt: 0 }
    g.customers[2]!.intimacy = { level: 'T5', note: '', updatedAt: 0 }
    const { nodes } = buildGraph(g, {
      mode: 'customer-only',
      center,
      selfName: '阿蓝',
    })
    expect(nodes.length).toBeGreaterThan(1)
    expect(new Set(nodes.map((n) => n.radius))).toEqual(new Set([NODE_RADIUS]))
    // 描边色只有一个取值 = 档位在画布上不产生任何视觉差异（含「我」）
    expect(new Set(nodes.map((n) => n.color)).size).toBe(1)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    expect(byId.get('c1')!.color).toBe(GRAPH_COLORS.customer.stroke)
    expect(byId.get('c2')!.color).toBe(GRAPH_COLORS.customer.stroke)
  })
})

import { describe, expect, it } from 'vitest'
import { buildGraph, SELF_NODE_ID } from '../buildGraph'
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
})

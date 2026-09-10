import { describe, expect, it } from 'vitest'
import { buildGraph, SELF_NODE_ID } from '../buildGraph'
import type { CanvasGraph } from '../../hooks'

/**
 * 演示可见性契约（Issue #123）：种子里的 3 位客户之间必须有连线，
 * 演示时画布不出现孤立点：每个客户既连到「我」，客户之间也有语义关系边。
 */
const seedLike = (): CanvasGraph => ({
  customers: [
    {
      id: 'c1',
      name: '严伟强',
      company: '深蓝科技',
      tier: 'S',
      lastContactAt: 1,
      relations: [
        { targetId: 'c2', label: '项目合作', category: 'project' },
        { targetId: 'c3', label: '同行伙伴', category: 'person' },
      ],
    },
    {
      id: 'c2',
      name: '林晓棠',
      company: '云上文创',
      tier: 'A',
      lastContactAt: 1,
      relations: [
        { targetId: 'c1', label: '项目合作', category: 'project' },
        { targetId: 'c3', label: '转介绍人', category: 'person' },
      ],
    },
    {
      id: 'c3',
      name: '赵屹峰',
      company: '启衡咨询',
      tier: 'B',
      lastContactAt: 1,
      relations: [
        { targetId: 'c1', label: '同行伙伴', category: 'person' },
        { targetId: 'c2', label: '转介绍人', category: 'person' },
      ],
    },
  ],
  projects: [],
  transactions: [],
  todos: [],
  interactions: [],
  notes: [],
  projectStatuses: {},
})

describe('演示可见性：人人有连线', () => {
  it('3 位客户两两之间都有语义关系边（无孤立点）', () => {
    const { links } = buildGraph(seedLike(), {
      mode: 'customer-only',
      center: { x: 0, y: 0 },
      selfName: '阿蓝',
    })
    const pairs = links
      .filter((l) => l.kind === 'relation')
      .map((l) => [l.source, l.target].map(String).sort().join('~'))
    expect(new Set(pairs).size).toBe(3) // c1~c2 / c1~c3 / c2~c3
  })

  it('每对客户的连线文字完整呈现（多条语义拼接）', () => {
    const { links } = buildGraph(seedLike(), {
      mode: 'customer-only',
      center: { x: 0, y: 0 },
    })
    // c1/c3 双向同标签「同行伙伴」聚合为一条；c2/c3 的「转介绍人」同理
    const l13 = links.find(
      (l) => l.kind === 'relation' && [String(l.source), String(l.target)].includes('c1') && [String(l.source), String(l.target)].includes('c3'),
    )
    expect(l13?.label).toBe('同行伙伴')
    expect(l13?.categories).toEqual(['person'])
  })

  it('「我」连到全部 3 位客户', () => {
    const { links } = buildGraph(seedLike(), { mode: 'customer-only', center: { x: 0, y: 0 } })
    const selfTargets = links
      .filter((l) => l.kind === 'self' && l.source === SELF_NODE_ID)
      .map((l) => String(l.target))
      .sort()
    expect(selfTargets).toEqual(['c1', 'c2', 'c3'])
  })
})

/**
 * 灵感引擎降级原因文案回归（Issue #148 后续 · 上轮审计建议 8）
 *
 * 背景：逾期待办的原因文案里原写死「商业影响最高」——这句话只对「高（重要紧急）」成立，
 * 低/无档照样输出会与档位语义打架（同一行里写着「低 · 不重要紧急，商业影响最高」）。
 * 现改为按档位取一句与象限自洽的影响描述，档位本身仍由 `todoPriorityFullLabel` 展示。
 */
import { describe, it, expect } from 'vitest'
import buildCandidates from '../engine'
import type { Customer, IntimacyLevel, Todo } from '@/db/types'

const DAY = 86_400_000

function overdueTodo(priority: Todo['priority']): Todo {
  return {
    id: `td-${priority}`,
    title: '跟进续约',
    desc: '',
    priority,
    status: 'todo',
    dueAt: Date.now() - 3 * DAY,
    createdAt: 1,
    updatedAt: 1,
    deleted: 0,
    rev: 1,
  } as Todo
}

function reasonOf(priority: Todo['priority']): string {
  const list = buildCandidates({ todos: [overdueTodo(priority)], transactions: [], customers: [], notes: [], customerLevels: {} })
  return list.find((c) => c.kind === 'overdue-todo')!.reason
}

describe('逾期原因文案与档位自洽', () => {
  it('高（重要紧急）：保留「影响最直接」表述', () => {
    const r = reasonOf('high')
    expect(r).toContain('高 · 重要紧急')
    expect(r).toContain('影响最直接')
  })

  it('低（不重要紧急）：不再出现「商业影响最高」这类与档位冲突的措辞', () => {
    const r = reasonOf('low')
    expect(r).toContain('低 · 不重要紧急')
    expect(r).not.toContain('商业影响最高')
    expect(r).toContain('价值有限')
  })

  it('无（不重要不紧急）：文案为「不催办」口径', () => {
    const r = reasonOf('none')
    expect(r).toContain('无 · 不重要不紧急')
    expect(r).not.toContain('商业影响最高')
  })

  it('存量 P1 数据先归一化再取文案，不会因旧档位拿到空描述', () => {
    const legacy = { ...overdueTodo('P1' as Todo['priority']) }
    const list = buildCandidates({ todos: [legacy], transactions: [], customers: [], notes: [], customerLevels: {} })
    const reason = list.find((c) => c.kind === 'overdue-todo')!.reason
    expect(reason).toContain('高 · 重要紧急')
    expect(reason).toContain('影响最直接')
  })
})

/* --------------------------------- 健康分档位权重 --------------------------------- */

const LEVEL_NAMES: Record<string, string> = {
  T1: '核心', T2: '信赖', T3: '合作', T4: '一般', T5: '照面', I6: '疏远', I7: '黑名单',
}

/** 久未跟进客户夹具（只有 lastContactAt 参与本组计算） */
function staleCustomer(id: string, daysAgo: number): Customer {
  return {
    id,
    name: id,
    company: '',
    title: '',
    decisionLevel: '决策人',
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: Date.now() - daysAgo * DAY,
    createdAt: 1,
    updatedAt: 1,
    deleted: 0,
    rev: 1,
  }
}

const levelMap = (entries: Record<string, IntimacyLevel>) =>
  Object.fromEntries(
    Object.entries(entries).map(([id, level]) => [id, { level, name: LEVEL_NAMES[level]! }]),
  )

function build(entries: Record<string, IntimacyLevel>, daysAgo = 10) {
  return buildCandidates({
    todos: [],
    transactions: [],
    notes: [],
    customers: Object.keys(entries).map((id) => staleCustomer(id, daysAgo)),
    customerLevels: levelMap(entries),
  })
}

/**
 * 「手动客户分层 tier」已删除、并入健康分：本组锁住新口径不被改回去 ——
 * 若有人把权重改回写死的一视同仁、或恢复按 tier 取名，这几条会红。
 */
describe('久未跟进客户：权重取自健康分档位（原手动分层已并入健康分）', () => {
  it('同为 10 天未跟进，T1 核心 的分数高于 T3 合作（确按档位加权）', () => {
    const list = build({ a: 'T1', b: 'T3' })
    const a = list.find((c) => c.customerId === 'a')!
    const b = list.find((c) => c.customerId === 'b')!
    expect(a.score).toBeGreaterThan(b.score)
  })

  it('理由与上下文用健康分档位名（不再出现「X 层客户」）', () => {
    const c = build({ a: 'T2' }).find((x) => x.customerId === 'a')!
    expect(c.context[0]).toEqual({ icon: 'badge', label: '健康分', value: '信赖' })
    expect(c.reason).toContain('健康分「信赖」')
    expect(c.reason).not.toContain('层客户')
  })

  it('I6 疏远 / I7 黑名单不进候选（替代原「潜在客户不计入」）', () => {
    expect(build({ a: 'I6', b: 'I7' }).some((c) => c.kind === 'stale-customer')).toBe(false)
  })

  it('档位缺失的客户不会被静默丢弃（兜底权重，仍出候选）', () => {
    const list = buildCandidates({
      todos: [],
      transactions: [],
      notes: [],
      customers: [staleCustomer('a', 10)],
      customerLevels: {},
    })
    const c = list.find((x) => x.customerId === 'a')!
    expect(c.context[0]?.value).toBe('未分层')
  })
})

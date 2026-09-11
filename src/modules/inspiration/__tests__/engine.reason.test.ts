/**
 * 灵感引擎降级原因文案回归（Issue #148 后续 · 上轮审计建议 8）
 *
 * 背景：逾期待办的原因文案里原写死「商业影响最高」——这句话只对「高（重要紧急）」成立，
 * 低/无档照样输出会与档位语义打架（同一行里写着「低 · 不重要紧急，商业影响最高」）。
 * 现改为按档位取一句与象限自洽的影响描述，档位本身仍由 `todoPriorityFullLabel` 展示。
 */
import { describe, it, expect } from 'vitest'
import buildCandidates from '../engine'
import type { Todo } from '@/db/types'

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
  const list = buildCandidates({ todos: [overdueTodo(priority)], transactions: [], customers: [], notes: [] })
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
    const list = buildCandidates({ todos: [legacy], transactions: [], customers: [], notes: [] })
    const reason = list.find((c) => c.kind === 'overdue-todo')!.reason
    expect(reason).toContain('高 · 重要紧急')
    expect(reason).toContain('影响最直接')
  })
})

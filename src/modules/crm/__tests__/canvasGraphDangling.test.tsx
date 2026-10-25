// @vitest-environment jsdom
/**
 * 画布投影的「悬挂关系可见性」回归锁（2026-10-13）
 *
 * 背景（真实踩到）：`relations[].targetId` 指向已删除/不存在的客户时，投影层会把条目**静默过滤**，
 * 于是「本来就没有关系」与「关系全指错了客户」在画布上**长得一模一样** —— 都是一条线都没有。
 * 实测：测试服 16 个客户 / 12 条关系 / 有效 0 条，画布表现为一组孤立点，排查时先怀疑了渲染。
 *
 * 锁的不变式：
 * 1. 有效关系照常保留（不能为了提示而误伤正常数据）；
 * 2. 悬挂条目仍被过滤掉（渲染层绝不能拿到指向不存在节点的边）；
 * 3. **过滤掉了几条必须能被上层知道**（`danglingRelations`），否则第 2 条就成了假绿。
 *
 * 反向对照：把 hooks.ts 里的 `danglingRelations` 计数删掉（或让它恒为 0），第 1/2 组断言转红。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { renderHook, waitFor } from '@testing-library/react'
import { db } from '@/db/db'
import type { Customer } from '@/db/types'
import { useCanvasGraph } from '../hooks'

function customer(over: { id: string; name: string }): Customer {
  return {
    id: over.id,
    name: over.name,
    company: `${over.name}科技`,
    title: '总监',
    decisionLevel: '决策人',
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  }
}

/**
 * 播种一条客户间关系 link（v15 起关系在 links，canonical）。target 可以不存在 ——
 * 这正是本文件要锁的「悬挂防御」：写入端会校验端点，但手工改库/异常数据仍可能造出脏 link。
 */
async function seedRelation(a: string, b: string, label: string) {
  const { buildLinkId } = await import('@/repositories/linkId')
  await db.links.put({
    id: buildLinkId(
      { type: 'customers', id: a },
      { type: 'customers', id: b },
      'relation',
      { label },
    ),
    fromType: 'customers',
    fromId: a < b ? a : b,
    toType: 'customers',
    toId: a < b ? b : a,
    kind: 'relation',
    meta: { label },
    createdAt: 1,
    updatedAt: 0,
    rev: 0,
    deleted: 0,
  } as never)
}

beforeEach(async () => {
  await db.customers.clear()
  await db.links.clear()
})

describe('useCanvasGraph：悬挂关系既被挡住、又不被静默吞掉', () => {
  it('有效关系保留、悬挂条目被过滤，同时计入 danglingRelations', async () => {
    await db.customers.bulkPut([
      customer({ id: 'a', name: '甲' }),
      customer({ id: 'b', name: '乙' }),
      customer({ id: 'c', name: '丙' }),
    ])
    await seedRelation('a', 'b', '项目合作')
    await seedRelation('b', 'ghost', '转介绍人') // 指向不存在的客户
    const { result } = renderHook(() => useCanvasGraph())
    await waitFor(() => expect(result.current.customers).toHaveLength(3))

    const byId = Object.fromEntries(result.current.customers.map((c) => [c.id, c]))
    expect(byId.a!.relations.map((r) => r.targetId)).toEqual(['b'])
    expect(byId.b!.relations.map((r) => r.targetId)).toEqual(['a']) // ghost 已被挡掉
    expect(byId.c!.relations).toHaveLength(0)
    expect(result.current.danglingRelations).toBe(1)
  })

  it('全部悬挂时：客户仍在、关系全空、计数等于条目总数（画布会一条线都没有）', async () => {
    await db.customers.bulkPut([
      customer({ id: 'a', name: '甲' }),
      customer({ id: 'b', name: '乙' }),
      customer({ id: 'c', name: '丙' }),
    ])
    await seedRelation('a', 'c1', '项目合作')
    await seedRelation('b', 'c2', '同行伙伴')
    await seedRelation('c', 'ghost', '同一公司')
    const { result } = renderHook(() => useCanvasGraph())
    await waitFor(() => expect(result.current.customers).toHaveLength(3))

    expect(result.current.customers.every((c) => c.relations.length === 0)).toBe(true)
    expect(result.current.danglingRelations).toBe(3)
  })

  it('数据健康时不产生噪音提示（计数为 0，页面据此不渲染 chip）', async () => {
    await db.customers.bulkPut([
      customer({ id: 'a', name: '甲' }),
      customer({ id: 'b', name: '乙' }),
    ])
    await seedRelation('a', 'b', '项目合作')
    const { result } = renderHook(() => useCanvasGraph())
    await waitFor(() => expect(result.current.customers).toHaveLength(2))

    expect(result.current.danglingRelations).toBe(0)
  })
})

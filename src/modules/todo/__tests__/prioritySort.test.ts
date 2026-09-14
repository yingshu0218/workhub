/**
 * 待办列表排序回归（缺陷 D12 / 用例 #158「优先级排序生效」）
 *
 * 原缺陷：列表只按 `createdAt` 排序（可切升降），`todoPriorityWeight` 已存在却从未接线，
 * 于是「高优先级」档位仅在 Chip 颜色上可见，列表里的位置与「无」档完全一样 ——
 * 用户建一条高优先级 + 一条无优先级，看到的是创建时间序（后建的压在上面），
 * 档位的选择没有任何可见后果。用例期望：**高优先级排最前、无优先级沉底**。
 *
 * 本测锁定两级排序契约：
 *   ① 档位一级恒为 高 → 中 → 低 → 无；
 *   ② 同档位内按 createdAt，`dir` 只作用于这一级（升降按钮语义收窄为「同档位内的时间方向」）；
 *   ③ 存量 P1/P2/P3 与未知值都经读侧归一化落位，脏数据不导致顺序错乱或抛错；
 *   ④ 返回新数组，不改动入参（调用方是 useMemo 的源数组，原地排序会污染库视图）。
 */
import { describe, it, expect } from 'vitest'
import { compareTodoPriority, sortTodosByPriority } from '../priority'
import type { Todo } from '@/db/types'

const todo = (id: string, priority: unknown, createdAt: number): Todo =>
  ({
    id,
    title: id,
    desc: '',
    priority,
    status: 'todo',
    createdAt,
    updatedAt: createdAt,
    deleted: 0,
    rev: 1,
  }) as unknown as Todo

describe('① 档位比较器', () => {
  it('高 < 中 < 低 < 无（比较器返回负数的排在前）', () => {
    expect(compareTodoPriority(todo('a', 'high', 1), todo('b', 'none', 1))).toBeLessThan(0)
    expect(compareTodoPriority(todo('a', 'none', 1), todo('b', 'high', 1))).toBeGreaterThan(0)
    expect(compareTodoPriority(todo('a', 'mid', 1), todo('b', 'low', 1))).toBeLessThan(0)
  })

  it('同档位返回 0（把次序让给二级比较器）', () => {
    expect(compareTodoPriority(todo('a', 'high', 1), todo('b', 'high', 999))).toBe(0)
  })

  it('存量 P1/P2/P3 按归一化后的档位比较（P1 应压 P3）', () => {
    expect(compareTodoPriority(todo('a', 'P1', 1), todo('b', 'P3', 1))).toBeLessThan(0)
  })
})

describe('② 两级排序：档位优先，创建时间兜底（用例 #158 的场景）', () => {
  it('高优先级排最前，无优先级沉底 —— 后建的「无」不再压住先建的「高」', () => {
    // 用例步骤：① 建高优先级 1 条 + 无优先级 1 条 ② 看待办列表排序
    // 刻意让「无」档后建：纯时间序下它会排在最前（原缺陷表现）
    const rows = [todo('无档', 'none', 2000), todo('高档', 'high', 1000)]
    expect(sortTodosByPriority(rows).map((t) => t.id)).toEqual(['高档', '无档'])
  })

  it('四档全序：高 → 中 → 低 → 无', () => {
    const rows = [
      todo('无', 'none', 1),
      todo('低', 'low', 2),
      todo('高', 'high', 3),
      todo('中', 'mid', 4),
    ]
    expect(sortTodosByPriority(rows).map((t) => t.id)).toEqual(['高', '中', '低', '无'])
  })

  it('同档位内按创建时间：asc 升序 / desc 降序', () => {
    const rows = [todo('同档新', 'mid', 300), todo('同档旧', 'mid', 100), todo('同档中', 'mid', 200)]
    expect(sortTodosByPriority(rows, 'asc').map((t) => t.id)).toEqual(['同档旧', '同档中', '同档新'])
    expect(sortTodosByPriority(rows, 'desc').map((t) => t.id)).toEqual(['同档新', '同档中', '同档旧'])
  })

  it('dir 只翻转同档位内的时间序，不翻转档位序', () => {
    const rows = [todo('高', 'high', 100), todo('无', 'none', 900), todo('中', 'mid', 500)]
    expect(sortTodosByPriority(rows, 'desc').map((t) => t.id)).toEqual(['高', '中', '无'])
  })

  it('混合场景：档位分组正确，且各组内时间序各自成立', () => {
    const rows = [
      todo('高-后', 'high', 500),
      todo('无-先', 'none', 10),
      todo('高-先', 'high', 100),
      todo('无-后', 'none', 900),
    ]
    expect(sortTodosByPriority(rows, 'asc').map((t) => t.id)).toEqual([
      '高-先',
      '高-后',
      '无-先',
      '无-后',
    ])
  })
})

describe('③ 脏数据与缺字段健壮性', () => {
  it('未知档位值归一化为「中」后落位，不抛错', () => {
    const rows = [todo('坏值', 'urgency-9', 1), todo('高', 'high', 2), todo('无', 'none', 3)]
    expect(sortTodosByPriority(rows).map((t) => t.id)).toEqual(['高', '坏值', '无'])
  })

  it('createdAt 缺失不产生 NaN 排序（兜底 0，退化为稳定序）', () => {
    const rows = [
      todo('缺时间', 'mid', undefined as unknown as number),
      todo('有时间', 'mid', 100),
    ]
    const out = sortTodosByPriority(rows)
    expect(out.map((t) => t.id)).toEqual(['缺时间', '有时间'])
    expect(out).toHaveLength(2)
  })
})

describe('④ 不可变性与稳定性', () => {
  it('返回新数组，入参顺序不被改写（useMemo 源数组不可原地排序）', () => {
    const rows = [todo('无', 'none', 1), todo('高', 'high', 2)]
    const snapshot = rows.map((t) => t.id)
    const out = sortTodosByPriority(rows)
    expect(rows.map((t) => t.id)).toEqual(snapshot)
    expect(out).not.toBe(rows)
    expect(out.map((t) => t.id)).toEqual(['高', '无'])
  })

  it('空数组与单条不抛错', () => {
    expect(sortTodosByPriority([])).toEqual([])
    expect(sortTodosByPriority([todo('alone', 'none', 1)]).map((t) => t.id)).toEqual(['alone'])
  })
})

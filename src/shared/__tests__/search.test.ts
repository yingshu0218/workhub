import { describe, it, expect } from 'vitest'
import { buildSearchIndex, searchAll } from '../search'
import type { Customer, Note, Todo } from '@/db/types'

/**
 * ⌘K 搜索的健壮性回归（缺陷 D13）
 *
 * 原缺陷：待办的 `subtitle` 直接取 `t.desc`，而 `Todo.desc` 类型上标为必填、
 * 存量/同步/手写库的记录却可能没有该字段 → `item.subtitle.toLowerCase()` 抛
 * "Cannot read properties of undefined (reading 'toLowerCase')"，
 * **一条脏数据即可让整个全局搜索崩溃（整页错误页）**。
 *
 * 本测锁定：索引构建对缺字段做兜底（缺字段的项退化为「匹配不到」，而不是抛错）。
 */

const todo = (over: Partial<Todo>): Todo =>
  ({
    id: 'td1',
    title: '正常待办',
    desc: '备注',
    priority: 'none',
    status: 'todo',
    createdAt: 1,
    updatedAt: 1,
    deleted: 0,
    rev: 1,
    ...over,
  }) as Todo

const emptyInputs = { customers: [], projects: [], todos: [], transactions: [], notes: [], habits: [] }

function build(over: { todos?: Todo[]; customers?: Customer[]; notes?: Note[] }) {
  return buildSearchIndex({ ...emptyInputs, ...over })
}

describe('搜索索引对字段缺失的健壮性（D13）', () => {
  it('① 待办缺 desc → subtitle 为空串（不是 undefined），搜索不抛错', () => {
    const index = build({ todos: [todo({ desc: undefined as unknown as string })] })
    expect(index[0].subtitle).toBe('')
    expect(() => searchAll(index, '正常')).not.toThrow()
    expect(() => searchAll(index, '随便搜点什么')).not.toThrow()
  })

  it('② 已完成待办缺 desc → subtitle 只剩状态前缀，不出现 "undefined" 字样', () => {
    const index = build({ todos: [todo({ status: 'done', desc: undefined as unknown as string })] })
    expect(index[0].subtitle).toBe('已完成 · ')
    expect(index[0].subtitle).not.toContain('undefined')
  })

  it('③ 待办缺 title → 搜索任意词都不崩（回归：正是这一条让 ⌘K 整页崩溃）', () => {
    const index = build({ todos: [todo({ title: undefined as unknown as string })] })
    expect(index[0].title).toBe('')
    for (const q of ['a', '陈', 'todo', '已完成']) {
      expect(() => searchAll(index, q)).not.toThrow()
    }
  })

  it('④ 客户 / 笔记等其它实体缺字段同样不崩（消费侧双保险）', () => {
    const index = build({
      customers: [{ id: 'c1', name: undefined, company: undefined, title: undefined } as unknown as Customer],
      notes: [{ id: 'n1', title: undefined, tags: [] } as unknown as Note],
    })
    for (const q of ['陈', 'note', 'x']) {
      expect(() => searchAll(index, q)).not.toThrow()
    }
  })

  it('⑤ 正常数据仍能正确匹配（兜底不破坏原语义）', () => {
    const index = build({
      todos: [todo({ id: 'a', title: '归档旧版方案文档', desc: '备注A' }), todo({ id: 'b', title: '联系客户', desc: '报价区间' })],
    })
    const hitTitle = searchAll(index, '归档')
    expect(hitTitle).toHaveLength(1)
    expect(hitTitle[0].items.map((i) => i.id)).toEqual(['a'])
    const hitSubtitle = searchAll(index, '报价')
    expect(hitSubtitle[0].items.map((i) => i.id)).toEqual(['b'])
    // 空查询返回全部（不筛选）
    expect(searchAll(index, '   ')).toHaveLength(1)
  })

  it('⑥ 混合脏数据：一条缺 desc 的待办不影响其它条目被搜到', () => {
    const index = build({
      todos: [todo({ id: 'dirty', desc: undefined as unknown as string, title: '脏数据' }), todo({ id: 'ok', title: '正常条目', desc: '有备注' })],
    })
    const r = searchAll(index, '正常')
    expect(r[0].items.map((i) => i.id)).toEqual(['ok'])
  })
})

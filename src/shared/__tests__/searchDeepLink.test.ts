/**
 * ⌘K 全局搜索结果跳转深链（Issue #147 bug 1）
 *
 * 用户反馈「财务记录的单条记账详情点击没有反应」。
 * 根因：⌘K 搜索命中的流水/待办只给了裸路径（`/finance`、`/todo`），
 * 点结果只落到列表首页 —— 目标条目要么在别的账本/分页里、要么在默认视图外，
 * 观感与「点了没反应」完全一致（详情抽屉/定位高亮都没出现）。
 *
 * 修复口径：与既有「时间线骨刺穿透」深链统一（`/finance?focus=<id>`、`/todo?focus=<id>`），
 * 页面消费 focus 后直接打开详情 / 切视图 + 定位高亮。
 * 本测试锁死 `buildSearchIndex` 产出的 path 必带 focus，防止回归成裸路径。
 */
import { describe, it, expect } from 'vitest'
import { buildSearchIndex } from '../search'

const base = { customers: [], projects: [], notes: [], habits: [] }

function txn(id: string) {
  return {
    id,
    ledgerId: 'l1',
    type: 'expense' as const,
    amount: 100,
    summary: '买咖啡',
    channel: '微信',
    occurredAt: 1,
    tags: [],
    status: '待对账' as const,
    updatedAt: 1,
    deleted: 0 as const,
    rev: 1,
  }
}

function todo(id: string) {
  return {
    id,
    title: '回访客户',
    desc: '',
    priority: 'high' as const,
    status: 'todo' as const,
    createdAt: 1,
    updatedAt: 1,
    deleted: 0 as const,
    rev: 1,
  }
}

describe('⌘K 搜索深链：财务流水 / 待办结果可直达详情', () => {
  it('流水结果 path 带 ?focus=<id>（否则点详情无反应）', () => {
    const items = buildSearchIndex({ ...base, todos: [], transactions: [txn('t1')] } as never)
    const hit = items.find((i) => i.type === 'transaction')!
    expect(hit.path).toBe('/finance?focus=t1')
  })

  it('待办结果 path 带 ?focus=<id>（默认视图外也能定位）', () => {
    const items = buildSearchIndex({ ...base, todos: [todo('td1')], transactions: [] } as never)
    const hit = items.find((i) => i.type === 'todo')!
    expect(hit.path).toBe('/todo?focus=td1')
  })

  it('id 经过 encodeURIComponent（防查询串污染）', () => {
    const items = buildSearchIndex({
      ...base,
      todos: [],
      transactions: [txn('a b&c')],
    } as never)
    expect(items.find((i) => i.type === 'transaction')!.path).toBe('/finance?focus=a%20b%26c')
  })

  it('直接落到详情页的类型（客户）保持裸路径不变', () => {
    const items = buildSearchIndex({
      ...base,
      customers: [
        {
          id: 'c1',
          name: '张三',
          company: '',
          title: '',
          decisionLevel: '决策人',
          tier: 'A',
          tags: [],
          lastContactAt: 0,
          createdAt: 0,
          updatedAt: 0,
          deleted: 0,
          rev: 0,
        },
      ],
      todos: [],
      transactions: [],
    } as never)
    expect(items.find((i) => i.type === 'customer')!.path).toBe('/crm/c1')
  })
})

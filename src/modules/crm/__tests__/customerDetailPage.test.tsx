// @vitest-environment jsdom
/**
 * 客户详情页整页渲染冒烟（Issue #147 bug 2）
 *
 * 用户反馈「客户信息的单条记录点击会报错」。CRM 列表点行 → navigate(`/crm/:id`)
 * → CustomerDetailPage 渲染时，useCustomerTimeline / useCustomerScoreInput 走
 * `db.transactions.where('customerId')`（v11 已删索引）抛 SchemaError，
 * 被 ErrorBoundary 接住显示「模块出错了」。
 *
 * 本用例在**有关联流水**的真实形态下渲染整页，同时断言：
 *   ① 页面正常渲染（能看到客户名）；
 *   ② 关联流水出现在「资金」明细与时间轴计数里（证明查询真的取到数，而非静默降级为空）；
 *   ③ 渲染期无 React 错误。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import CustomerDetailPage from '../CustomerDetailPage'

function customer(id: string) {
  return {
    id,
    name: '张三',
    company: '深蓝科技',
    title: '总监',
    decisionLevel: '决策人' as const,
    
    tags: [],
    lastContactAt: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  }
}
function ledger(id: string) {
  return {
    id,
    name: '主账本',
    currency: 'CNY',
    openingBalance: 0,
    closingCycle: '月结' as const,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  }
}
function txn(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    ledgerId: 'l1',
    type: 'expense' as const,
    amount: 1234,
    summary: '二期开发款',
    channel: '微信',
    occurredAt: 1_700_000_000_000,
    tags: [],
    status: '待对账' as const,
    updatedAt: 1,
    deleted: 0 as const,
    rev: 1,
    ...over,
  }
}

const errors: unknown[] = []

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  errors.length = 0
  vi.spyOn(console, 'error').mockImplementation((...a) => {
    errors.push(a[0])
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CustomerDetailPage：有关联流水时不再崩溃', () => {
  it('页面正常渲染且关联流水可见（不再 SchemaError）', async () => {
    await db.customers.put(customer('c1') as never)
    await db.ledgers.put(ledger('l1') as never)
    await db.transactions.put(txn({ customerIds: ['c1'] }) as never)

    render(
      <MemoryRouter initialEntries={['/crm/c1']}>
        <Routes>
          <Route path="/crm/:id" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    // ① 页面渲染出客户名（未落到 ErrorBoundary）
    expect((await screen.findAllByText('张三')).length).toBeGreaterThan(0)
    expect(screen.queryByText('模块出错了')).toBeNull()

    // ② 关联流水被查询命中：资金概览出现支出金额（1234）。
    //    修复前 useCustomerTimeline/useCustomerScoreInput 抛 SchemaError → 金额为 0。
    expect((await screen.findAllByText(/¥1,234/)).length).toBeGreaterThan(0)

    // ③ 渲染期无 console.error（SchemaError 会以 error 形态冒出来）
    const schemaErr = errors.find((e) =>
      /SchemaError|is not indexed/.test(e instanceof Error ? e.message : String(e)),
    )
    expect(schemaErr).toBeUndefined()
  })

  it('多关联流水：该客户在关联数组里即命中', async () => {
    await db.customers.put(customer('c1') as never)
    await db.customers.put({ ...customer('c2'), id: 'c2', name: '李四' } as never)
    await db.ledgers.put(ledger('l1') as never)
    await db.transactions.put(txn({ customerIds: ['c2', 'c1'] }) as never)

    render(
      <MemoryRouter initialEntries={['/crm/c1']}>
        <Routes>
          <Route path="/crm/:id" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect((await screen.findAllByText('张三')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/¥1,234/)).length).toBeGreaterThan(0)
  })
})

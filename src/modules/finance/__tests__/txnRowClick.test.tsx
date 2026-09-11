// @vitest-environment jsdom
/**
 * 财务流水「列表行点击 → 凭证详情」回归（Issue #147）
 *
 * 用户反馈「财务记录的单条记账详情点击没有反应」。财务中心主列表的行点击此前已可用，
 * 但同一笔流水的其它三个展示位（项目详情「项目流水」、客户详情「待对账款项」、
 * 客户详情时间轴「关联记账」）**渲染成了纯文本行，没有点击穿透** —— 观感上就是
 * 「列表行点了没反应」。本用例逐个点位点击，断言最终都打开 /finance?focus= 对应的详情抽屉。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import FinancePage from '../FinancePage'
import ProjectDetailPage from '@/modules/projects/ProjectDetailPage'
import CustomerDetailPage from '@/modules/crm/CustomerDetailPage'

const errors: unknown[] = []
beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  errors.length = 0
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a[0]) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const ledger = {
  id: 'l1', name: '主账本', currency: 'CNY', openingBalance: 0, closingCycle: '月结' as const,
  createdAt: 0, updatedAt: 0, deleted: 0 as const, rev: 0,
}
const customer = {
  id: 'c1', name: '张三', company: '深蓝科技', title: '总监', decisionLevel: '决策人' as const,
  tier: 'A' as const, tags: [], lastContactAt: 0, createdAt: 0, updatedAt: 0, deleted: 0 as const, rev: 0,
}
const txn = (over: Record<string, unknown> = {}) => ({
  id: 't1', ledgerId: 'l1', type: 'expense' as const, amount: 1234, summary: '二期平台开发款',
  channel: '微信', occurredAt: 1_700_000_000_000, tags: [], status: '待对账' as const,
  updatedAt: 1, deleted: 0 as const, rev: 1, customerIds: ['c1'], projectIds: ['p1'],
  ...over,
})

function renderApp(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/crm/:id" element={<CustomerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('财务流水列表行点击 → 凭证详情（Issue #147）', () => {
  it('① 财务中心主列表：点行打开详情抽屉', async () => {
    await db.ledgers.put(ledger as never)
    await db.transactions.put(txn() as never)
    renderApp('/finance')
    fireEvent.click(await screen.findByText('二期平台开发款'))
    expect(await screen.findByText('财务流水凭证详情')).toBeTruthy()
  })

  it('② 项目详情「项目流水」：点行跳财务中心并打开详情', async () => {
    await db.projects.put({
      id: 'p1', name: '二期平台开发', color: '#0af', status: 'active',
      createdAt: 0, updatedAt: 0, deleted: 0, rev: 0,
    } as never)
    await db.ledgers.put(ledger as never)
    await db.transactions.put(txn() as never)
    renderApp('/projects/p1')
    fireEvent.click(await screen.findByText('二期平台开发款'))
    expect(await screen.findByText('财务流水凭证详情')).toBeTruthy()
  })

  it('③ 客户详情「待对账款项」：点行跳财务中心并打开详情', async () => {
    await db.customers.put(customer as never)
    await db.ledgers.put(ledger as never)
    await db.transactions.put(txn() as never)
    renderApp('/crm/c1')
    // 待对账卡片里的摘要行（时间轴里也有一份，取第一个）
    const hit = (await screen.findAllByText('二期平台开发款'))[0]
    fireEvent.click(hit)
    expect(await screen.findByText('财务流水凭证详情')).toBeTruthy()
  })

  it('④ 客户详情时间轴「关联记账」：点行跳财务中心并打开详情', async () => {
    await db.customers.put(customer as never)
    await db.ledgers.put(ledger as never)
    await db.transactions.put(txn({ status: '已结算' }) as never)
    renderApp('/crm/c1')
    await screen.findAllByText('张三')
    // 时间轴默认只显示沟通日志，切「全部」才纳入交易事件
    fireEvent.click(await screen.findByText(/^全部/))
    const hit = (await screen.findAllByText('二期平台开发款'))[0]
    fireEvent.click(hit)
    expect(await screen.findByText('财务流水凭证详情')).toBeTruthy()
  })
})

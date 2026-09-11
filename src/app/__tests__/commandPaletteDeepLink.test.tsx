// @vitest-environment jsdom
/**
 * ⌘K 搜索结果点击 → 深链直达详情（Issue #147 bug 1 端到端）
 *
 * 覆盖「财务记录的单条记账详情点击没有反应」：
 *   搜索「买咖啡」→ 点流水结果 → 应落在财务中心**并自动打开该笔凭证详情抽屉**。
 * 修复前只 navigate('/finance')，抽屉不出现 → 观感就是「点了没反应」。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import CommandPalette from '../CommandPalette'
import FinancePage from '@/modules/finance/FinancePage'

function Loc() {
  const l = useLocation()
  return <div data-testid="loc">{l.pathname + l.search}</div>
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function searchAndClick(keyword: string, label: string) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Loc />
      <Routes>
        <Route path="/" element={<CommandPalette open onClose={() => {}} />} />
        <Route path="/finance" element={<FinancePage />} />
      </Routes>
    </MemoryRouter>,
  )
  await new Promise((r) => setTimeout(r, 60))
  const input = document.querySelector('input')!
  fireEvent.change(input, { target: { value: keyword } })
  await new Promise((r) => setTimeout(r, 60))
  fireEvent.click(await screen.findByText(label))
  await new Promise((r) => setTimeout(r, 200))
}

describe('⌘K 流水结果 → 财务凭证详情', () => {
  it('点搜索结果直接打开该笔流水详情抽屉', async () => {
    await db.ledgers.put({
      id: 'l1',
      name: '主账本',
      currency: 'CNY',
      openingBalance: 0,
      closingCycle: '月结',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 0,
    } as never)
    await db.transactions.put({
      id: 't1',
      ledgerId: 'l1',
      type: 'income',
      amount: 100,
      summary: '买咖啡',
      channel: '微信',
      occurredAt: 1,
      tags: [],
      status: '已结算',
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)

    await searchAndClick('买咖啡', '买咖啡')

    // 落到财务中心，focus 参数消费后清掉
    expect(document.querySelector('[data-testid=loc]')?.textContent).toBe('/finance')
    // 关键：详情抽屉自动打开
    expect(screen.getByText('财务流水凭证详情')).toBeTruthy()
  })
})

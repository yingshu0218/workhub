// @vitest-environment jsdom
/**
 * 凭证详情 → 编辑表单存活性回归（P1，2026-10-26 真机验收发现）
 *
 * 缺陷：TransactionFormDrawer / ConfirmDialog 曾渲染在详情 Drawer 的 children 里，而点
 * 「编辑」会把 Drawer 的 open 翻成 false —— usePresence 播完 200ms 出场动画后整棵卸载子树，
 * 把刚打开的编辑表单一起带走：表单闪现即消失，凭证详情里根本无法编辑流水。
 * 该结构自 a7c4296（2026-09-06）引入起就是坏的（当时 Drawer 是 `if (!open) return null`
 * 的立即卸载，缺陷更彻底、表单连一帧都留不下）；动效系统接入 usePresence 后退化为
 * 「闪现 ~200ms」。既有测试都直接渲染 TransactionFormDrawer（open=true），恰好绕开这条链路。
 *
 * 修复：表单与确认弹窗改为 Drawer 的**兄弟节点**；详情在编辑期间保持打开
 * （对齐 TodoDetailDrawer「表单挂页面层」的同位模式，以及表单注释里
 * 「elevated 抬到更高层级 / 保存后详情随 liveQuery 刷新」的叠层设计意图）。
 *
 * 判据：点「编辑」后表单出现，且在出场动画时长（200ms）**之后**仍然存活；
 * 详情抽屉同时保持打开。变异校验：把表单移回 Drawer 子树 → 400ms 后表单消失，恰红。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import FinancePage from '../FinancePage'

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

function renderApp(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/finance" element={<FinancePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('凭证详情 → 编辑表单存活性（P1 回归锁）', () => {
  it('点「编辑」后表单打开，退场动画播完仍存活，详情保持叠层打开', async () => {
    await db.ledgers.put({
      id: 'l1', name: '主账本', currency: 'CNY', openingBalance: 0, closingCycle: '月结' as const,
      createdAt: 0, updatedAt: 0, deleted: 0 as const, rev: 0,
    } as never)
    await db.transactions.put({
      id: 't1', ledgerId: 'l1', type: 'expense' as const, amount: 1234, summary: '二期平台开发款',
      channel: '微信', occurredAt: 1_700_000_000_000, tags: [], status: '待对账' as const,
      updatedAt: 1, deleted: 0 as const, rev: 1,
    } as never)

    renderApp('/finance?focus=t1')
    expect(await screen.findByText('财务流水凭证详情')).toBeTruthy()

    // findByRole 轮询：抽屉标题与按钮区不同帧渲染（按钮区在 txn liveQuery 解析后出现），
    // 同步 getByRole 在负载下会抢跑（全量并发实测踩到，单跑恒绿）
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    expect(await screen.findByText('编辑流水')).toBeTruthy()

    // 缺陷版本：usePresence 200ms 出场定时器到点后整棵子树卸载，表单跟着消失。
    // 这里越过出场时长再断言，恰好把「闪现」钉死。
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.getByText('编辑流水')).toBeTruthy()
    // 详情抽屉保持打开（elevated 叠层的既有设计意图，对齐待办详情→编辑）
    expect(screen.getByText('财务流水凭证详情')).toBeTruthy()
    expect(errors).toEqual([])
  })
})

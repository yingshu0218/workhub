// @vitest-environment jsdom
/**
 * 待办「列表行点击 → 单条详情」回归（Issue #162）
 *
 * 用户反馈：「待办事项的列表不能进去查看单条待办事项的详情」。
 * 待办中心此前列表行只能就地打勾 / 作废 / 编辑 / 删除，**没有查看详情的入口** ——
 * 正文备注全文、完整时间线、归属与关联账目都看不到。
 *
 * 本用例锁死四件事：
 *   ① 点列表行打开「待办详情」抽屉，完整展示正文备注（列表行是截断标题）；
 *   ② 行内动作按钮（作废 / 编辑 / 删除）**不穿透**打开详情；
 *   ③ 关联账目按 `transactions.todoIds` 反查，点击穿透 `/finance?focus=<txnId>`；
 *   ④ 打开首帧不闪「待办不存在或已删除」（未回填 ≠ 查无此记录）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import TodoPage from '../TodoPage'
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

const todo = (over: Record<string, unknown> = {}) => ({
  id: 'td1',
  title: '跟进深蓝续约',
  desc: '跟进深蓝续约\n本周五前给出报价，并确认合同条款',
  priority: 'high',
  status: 'todo',
  createdAt: 1_700_000_000_000,
  updatedAt: 1,
  deleted: 0,
  rev: 1,
  ...over,
})

function renderApp(initial = '/todo') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Loc />
      <Routes>
        <Route path="/todo" element={<TodoPage />} />
        <Route path="/finance" element={<FinancePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 抽屉根节点（Drawer 渲染为 fixed 容器；用标题回溯，避免依赖内部结构） */
function drawerOf(): HTMLElement {
  return screen.getByText('待办详情').closest('.fixed') as HTMLElement
}

describe('待办列表行点击 → 详情抽屉（Issue #162）', () => {
  it('① 点列表行打开详情，正文备注全文可见（列表行只有截断标题）', async () => {
    await db.todos.put(todo() as never)
    renderApp()
    fireEvent.click(await screen.findByText('跟进深蓝续约'))
    expect(await screen.findByText(/本周五前给出报价，并确认合同条款/)).toBeTruthy()
    expect(drawerOf().textContent).toContain('高')
  })

  it('② 行内动作不穿透：点行内「作废」直接作废，不打开详情', async () => {
    await db.todos.put(todo() as never)
    renderApp()
    await screen.findByText('跟进深蓝续约')
    fireEvent.click(screen.getByTitle('作废（终止事项，记录保留，可恢复）'))
    expect(screen.queryByText('待办详情')).toBeNull()
    // 轮询等待异步落库（固定 sleep 在全量并发负载下偶发不足，2026-10-14 P3 轮实测）
    await vi.waitFor(async () => {
      expect((await db.todos.get('td1'))?.status).toBe('voided')
    })
  })

  it('③ 详情内「编辑」打开表单并关闭详情（避免两层弹层叠放）', async () => {
    await db.todos.put(todo() as never)
    renderApp()
    fireEvent.click(await screen.findByText('跟进深蓝续约'))
    await screen.findByText(/本周五前给出报价/)
    // 列表行的编辑钮是 hover 出来的图标钮，用 within 限定到抽屉内那颗
    fireEvent.click(within(drawerOf()).getByText('编辑'))
    expect(await screen.findByText('编辑待办')).toBeTruthy()
    expect(screen.queryByText('待办详情')).toBeNull()
  })

  it('④ 关联账目按 transactions.todoIds 反查，点击穿透 /finance 凭证详情', async () => {
    await db.todos.put(todo() as never)
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
      amount: 2000,
      summary: '续约首款',
      channel: '微信',
      occurredAt: 1_700_000_000_000,
      tags: [],
      status: '已结算',
      todoIds: ['td1'],
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)

    renderApp()
    fireEvent.click(await screen.findByText('跟进深蓝续约'))
    await screen.findByText(/本周五前给出报价/)
    expect(screen.getByText('关联账目（1）')).toBeTruthy()
    fireEvent.click(screen.getByText('查看凭证'))
    // 落到财务中心并自动打开该笔凭证详情（深链消费后清参数）
    await screen.findByText('财务流水凭证详情')
    expect(document.querySelector('[data-testid=loc]')?.textContent).toBe('/finance')
  })

  it('⑤ 详情内标记完成 → 状态落库为 done 且补齐 completedAt（走领域函数）', async () => {
    await db.todos.put(todo() as never)
    renderApp()
    fireEvent.click(await screen.findByText('跟进深蓝续约'))
    await screen.findByText(/本周五前给出报价/)
    fireEvent.click(within(drawerOf()).getByText('标记完成'))
    await new Promise((r) => setTimeout(r, 50))
    const saved = (await db.todos.get('td1')) as { status: string; completedAt?: number }
    expect(saved.status).toBe('done')
    expect(typeof saved.completedAt).toBe('number')
  })

  it('⑥ 已作废条目详情：不给「标记完成」，给「恢复」', async () => {
    await db.todos.put(todo({ status: 'voided', voidedAt: 1_700_000_001_000 }) as never)
    renderApp()
    // 已作废条目不在「全部待办」（只装未完成），切到「已作废」视图找到它
    fireEvent.click(await screen.findByText('已作废'))
    const title = (await screen.findAllByText('跟进深蓝续约'))[0]
    fireEvent.click(title)
    await screen.findByText(/本周五前给出报价/)
    const scope = within(drawerOf())
    expect(scope.queryByText('标记完成')).toBeNull()
    expect(scope.getByText('恢复')).toBeTruthy()
  })

  it('⑦ 打开首帧不闪「待办不存在或已删除」（未回填 ≠ 查无此记录）', async () => {
    await db.todos.put(todo() as never)
    renderApp()
    fireEvent.click(await screen.findByText('跟进深蓝续约'))
    // 首帧（同步读取，未经 await）不得出现误导性的空态
    expect(drawerOf().textContent).not.toContain('待办不存在或已删除')
    // 回填后渲染真实内容
    expect(await screen.findByText(/本周五前给出报价/)).toBeTruthy()
  })

  it('⑧ 深链 /todo?focus=<id> 直达详情抽屉，而非只落到列表', async () => {
    await db.todos.put(todo() as never)
    renderApp('/todo?focus=td1')
    // 深链语义就是「定位到这一条」：直接打开详情，正文全文可见
    expect(await screen.findByText('待办详情')).toBeTruthy()
    expect(await screen.findByText(/本周五前给出报价/)).toBeTruthy()
    // 消费后清参数，避免返回/刷新重复触发
    expect(document.querySelector('[data-testid=loc]')?.textContent).toBe('/todo')
  })

  it('⑨ 深链指向已完成条目 → 切「已完成」视图并直达详情', async () => {
    await db.todos.put(todo({ status: 'done', completedAt: 1_700_000_002_000 }) as never)
    renderApp('/todo?focus=td1')
    expect(await screen.findByText('待办详情')).toBeTruthy()
    expect(await screen.findByText(/本周五前给出报价/)).toBeTruthy()
  })

  it('⑩ 深链指向不存在的 id → 不弹误导性空态抽屉，静默清参数', async () => {
    await db.todos.put(todo() as never)
    renderApp('/todo?focus=不存在')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('待办详情')).toBeNull()
    expect(document.querySelector('[data-testid=loc]')?.textContent).toBe('/todo')
  })

  it('⑪ 财务凭证详情点「查看待办详情」→ 待办详情抽屉打开（反向穿透对称）', async () => {
    await db.todos.put(todo() as never)
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
      amount: 2000,
      summary: '续约首款',
      channel: '微信',
      occurredAt: 1_700_000_000_000,
      tags: [],
      status: '已结算',
      todoIds: ['td1'],
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)

    renderApp('/finance?focus=t1')
    // 凭证详情里「查看待办详情」承诺了详情，就应落到详情（此前只 navigate('/todo') 落到列表）
    fireEvent.click(await screen.findByText('查看待办详情'))
    expect(await screen.findByText('待办详情')).toBeTruthy()
    expect(await screen.findByText(/本周五前给出报价/)).toBeTruthy()
  })
})

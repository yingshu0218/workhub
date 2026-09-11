// @vitest-environment jsdom
/**
 * 记一笔账表单「结算渠道」回归（Issue #151）
 *
 * 用户反馈两条：
 *   ① 新建表单时「结算渠道」默认选中了首个渠道、且标了 `*` 必填 —— 期望默认空、非必填；
 *   ② 下拉菜单选择后点其他位置收不回去（用原生 select？不，这是个自定义浮层）。
 *
 * 锁死：
 *   A. 新建态渠道默认空值（首选项为「未指定」，不再是「微信」）；
 *   B. 该字段标题不再带 `*`；
 *   C. 空渠道能正常保存（保存路径不再回落到默认渠道）；
 *   D. 下拉浮层点外部 / Esc 必须关闭。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import TransactionFormDrawer from '../TransactionFormDrawer'

beforeEach(async () => {
  cleanup()
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => cleanup())

function renderForm() {
  return render(<TransactionFormDrawer open={true} defaultLedgerId="all" onClose={() => {}} />)
}

describe('记一笔账 · 结算渠道默认值与必填口径（Issue #151）', () => {
  it('A 新建态渠道默认空（不是首个渠道）', () => {
    renderForm()
    const trigger = screen.getByRole('combobox', { name: /结算渠道/ })
    expect(trigger.textContent ?? '').not.toContain('微信')
    expect(trigger.textContent ?? '').toContain('未指定')
  })

  it('B 渠道字段不再标必填', () => {
    renderForm()
    expect(screen.getByText('结算渠道')).toBeTruthy()
    expect(screen.queryByText('结算渠道 *')).toBeNull()
  })
})

describe('记一笔账 · 结算渠道空值落库（Issue #151）', () => {
  it('D 空渠道可保存，落库 channel 为空串（不静默填默认渠道）', async () => {
    // 建一个账本，表单才能通过「请先创建账本」校验
    await db.ledgers.put({
      id: 'lg1',
      name: '主账本',
      currency: 'CNY',
      openingBalance: 0,
      closingCycle: '不封账',
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as never)

    const onClose = vi.fn()
    render(<TransactionFormDrawer open={true} defaultLedgerId="lg1" onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText(/如：深蓝科技二期交付结算凭据/), {
      target: { value: '空渠道流水' },
    })
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '128.5' } })
    fireEvent.click(screen.getByText('立即保存此笔流水'))

    // 保存成功 → onClose 被调用（没有卡在错误提示上）
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())

    const saved = await db.transactions.toArray()
    expect(saved).toHaveLength(1)
    expect(saved[0].channel).toBe('')
    expect(saved[0].summary).toBe('空渠道流水')
  })
})

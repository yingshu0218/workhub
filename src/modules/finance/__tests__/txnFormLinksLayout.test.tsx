// @vitest-environment jsdom
/**
 * 记一笔账表单「辅助信息区」左右 2 栏布局回归（Issue #151）
 *
 * 用户反馈：红框里的「业务标签 / 关联客户 / 关联项目 / 关联待办」四个字段各占一整行，
 * 纵向拉得很长，要求改成左右 2 栏。本次把它们收进一个独立的双栏栅格，两两成对：
 *   业务标签 | 关联客户
 *   关联项目 | 关联待办
 *
 * 锁死两点，防止后续有人手滑改回整行：
 *   ① 这四个字段必须同处一个 2 列栅格（`.grid-cols-2`），且该栅格整体横跨外层 2 列；
 *   ② 每个字段仍是「标签 + 输入控件」的完整 Field，控件没有被布局改动吃掉。
 *
 * 另需守住一条纪律：栅格容器不裁剪内容 —— `EntityLinkField` 的候选浮层与悬浮摘要卡都走
 * portal 挂到 body（z-70 / z-80），不会被半列宽度和 Modal 的 overflow-y-auto 裁掉。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import TransactionFormDrawer from '../TransactionFormDrawer'

beforeEach(async () => {
  cleanup()
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const AUX_FIELDS = ['业务标签', '关联客户', '关联项目', '关联待办']

function renderForm() {
  return render(<TransactionFormDrawer open={true} defaultLedgerId="all" onClose={() => {}} />)
}

describe('记一笔账 · 辅助信息区 2 栏布局（Issue #151）', () => {
  it('① 四个字段同处一个 2 列栅格', () => {
    renderForm()
    // 用稳定的锚点（data-testid）定位辅助信息区，避免后续表单里再出现
    // 任何 `sm:grid-cols-2` 时被选择器误命中（审计 P2-2①）。
    const grid = screen.getByTestId('txn-aux-links')
    const text = grid.textContent ?? ''
    for (const label of AUX_FIELDS) {
      expect(text).toContain(label)
    }
  })

  it('② 栅格整体横跨外层 2 列，不再各占整行', () => {
    renderForm()
    for (const label of AUX_FIELDS) {
      const fieldLabel = screen.getByText(label)
      const cell = fieldLabel.closest('label')
      expect(cell).toBeTruthy()
      expect(cell!.className ?? '').not.toContain('col-span-2')
    }
    // 四个字段都直接挂在辅助信息区栅格下（父节点即栅格）
    for (const label of AUX_FIELDS) {
      expect(screen.getByText(label).closest('label')!.parentElement).toBe(
        screen.getByTestId('txn-aux-links'),
      )
    }
    cleanup()
  })

  it('③ 栅格为 2 列且窄屏回落单列，不是 4 列', () => {
    renderForm()
    const grid = screen.getByTestId('txn-aux-links')
    expect(grid.className).toContain('col-span-2')
    expect(grid.className).toContain('sm:grid-cols-2')
    expect(grid.className).toContain('grid-cols-1')
    // 明确排除「一次性铺 4 列」的写法
    expect(grid.className).not.toContain('grid-cols-4')
    // 列间距与同级栅格口径一致（gap-2），不再叠加外层 gap-x-4
    expect(grid.className).toContain('gap-2')
    expect(grid.className).not.toContain('gap-x-4')
    cleanup()
  })

  it('④ 分栏不改变字段能力：关联项目与关联待办仍渲染出多选输入框', () => {
    renderForm()
    expect(screen.getByPlaceholderText('输入项目名称模糊搜索，可多选')).toBeTruthy()
    expect(screen.getByPlaceholderText(/输入待办标题模糊搜索，可多选/)).toBeTruthy()
  })

  it('⑤ 半列宽度下输入行不被写死内联尺寸（避免撑破/换行）', () => {
    renderForm()
    // EntityLinkField 根节点是 `relative`，输入行靠 flex-1 自适应半列宽度；
    // 若有人给容器塞内联 width/minWidth，半列会溢出。审计 P2-2③ 的回归锁。
    for (const ph of ['输入公司或姓名模糊搜索，可多选', '输入项目名称模糊搜索，可多选']) {
      const input = screen.getByPlaceholderText(ph)
      const row = input.parentElement!
      expect(row.style.width).toBe('')
      expect(row.style.minWidth).toBe('')
      // 输入框自身用 flex-1 自适应，无固定宽度
      expect(input.style.width).toBe('')
      expect(input.className).toContain('flex-1')
    }
  })
})

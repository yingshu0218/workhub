// @vitest-environment jsdom
/**
 * Issue #140：关联多值芯片输入 + 悬浮摘要卡
 *
 * 关注真实交互断点：
 * 1. 选中候选 → 固化芯片（带实体 id），已关联的不再出现在下拉（防重复选）；
 * 2. 芯片 × 解绑、输入框为空时退格删末个；
 * 3. **hover 150ms 弹摘要卡**（需求原文「鼠标移动到芯片标签上会悬浮显示」）；
 *    Esc 关闭；
 * 4. 实体已删 → 卡片显示「已失效」占位（弱引用语义），不抛错。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import EntityLinkField from '../EntityLinkField'
import { HOVER_DELAY_MS } from '../EntityHoverCard'

function option(id: string, label: string) {
  return { id, label, icon: 'person' }
}

const OPTIONS = [option('c1', '深蓝科技 · 张三'), option('c2', '蓝海传媒 · 李四')]

function renderField(value: string[] = [], onChange = vi.fn()) {
  render(
    <MemoryRouter>
      <EntityLinkField
        type="customer"
        value={value}
        options={OPTIONS}
        placeholder="搜索客户"
        emptyText="没有可关联的客户"
        onChange={onChange}
      />
    </MemoryRouter>,
  )
  return onChange
}

async function seedCustomer(id: string, name: string) {
  await db.customers.put({
    id,
    name,
    company: '深蓝科技',
    title: '采购总监',
    decisionLevel: '决策人',
    
    tags: [],
    lastContactAt: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  } as never)
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('EntityLinkField 多选芯片', () => {
  it('选中候选固化芯片，回调带实体 id', async () => {
    const onChange = renderField([])
    const input = screen.getByPlaceholderText('搜索客户')
    fireEvent.focus(input)
    fireEvent.click(await screen.findByText('深蓝科技 · 张三'))
    expect(onChange).toHaveBeenCalledWith(['c1'])
  })

  it('已关联的候选不再出现在下拉（防重复选）', () => {
    renderField(['c1'])
    const input = screen.getAllByRole('textbox')[0]
    fireEvent.focus(input)
    // 芯片里有一份「深蓝科技 · 张三」文案，下拉里不应再有第二份
    expect(screen.getAllByText('深蓝科技 · 张三')).toHaveLength(1)
    expect(screen.getByText('蓝海传媒 · 李四')).toBeTruthy()
  })

  it('芯片 × 解绑', () => {
    const onChange = renderField(['c1', 'c2'])
    const removeButtons = screen.getAllByTitle('解绑')
    fireEvent.click(removeButtons[0])
    expect(onChange).toHaveBeenCalledWith(['c2'])
  })

  it('输入为空时退格删末个芯片', () => {
    const onChange = renderField(['c1', 'c2'])
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith(['c1'])
  })
})

describe('EntityLinkField 悬浮摘要卡', () => {
  it('hover 芯片 150ms 内不弹，超过后弹出摘要', async () => {
    await seedCustomer('c1', '张三')
    vi.useFakeTimers()
    renderField(['c1'])
    const chipLabel = screen.getByText('深蓝科技 · 张三')

    fireEvent.mouseEnter(chipLabel)
    // 未到延时：不弹（防鼠标扫过误弹）
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY_MS - 10)
    })
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(20)
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('卡片内展示实体摘要字段（客户：公司 / 职位 / 健康分）', async () => {
    await seedCustomer('c1', '张三')
    // 真定时器：本用例断言的是「摘要内容」，需要让 Dexie liveQuery 的异步读完成；
    // 若与其他用例一样上 fake timers，IndexedDB 的微/宏任务会被一起冻住、卡片停在初始空态
    vi.useRealTimers()
    renderField(['c1'])
    fireEvent.mouseEnter(screen.getByText('深蓝科技 · 张三'))
    // 真定时器：等 hover 延时 + Dexie 异步读完成（findBy* 自带轮询等待）
    expect(await screen.findByText('公司', undefined, { timeout: 2000 })).toBeTruthy()
    expect(screen.getByText('职位')).toBeTruthy()
    expect(screen.getByText('健康分')).toBeTruthy()
    expect(screen.getByText('采购总监')).toBeTruthy()
  })

  it('实体已删时卡片显示「已失效」占位，不抛错', async () => {
    vi.useFakeTimers()
    renderField(['c1'])
    fireEvent.mouseEnter(screen.getByText('深蓝科技 · 张三'))
    await act(async () => {
      vi.advanceTimersByTime(HOVER_DELAY_MS + 10)
    })
    expect(screen.getByText(/已删除或不存在/)).toBeTruthy()
  })

  it('Esc 关闭卡片', async () => {
    await seedCustomer('c1', '张三')
    vi.useFakeTimers()
    renderField(['c1'])
    fireEvent.mouseEnter(screen.getByText('深蓝科技 · 张三'))
    await act(async () => {
      vi.advanceTimersByTime(HOVER_DELAY_MS + 10)
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    // ⚠️ 卡片现在带 150ms 出场动画，不会同步消失（Phase M1 起，见 shared/usePresence）。
    // 本文件用 fake timers，动画卸载由 hook 内定时器驱动 —— 直接推进时间即可，无需 waitFor。
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

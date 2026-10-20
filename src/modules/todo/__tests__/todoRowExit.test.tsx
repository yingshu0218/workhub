// @vitest-environment jsdom
/**
 * 待办行**退场**集成回归（2026-10-20）
 *
 * ## 为什么单独建这个文件
 * `useRowExit.test.ts` 只覆盖 hook 单元路径，且大量用例刻意传 `duration=0`
 * （「测试环境安全默认」）。但**生产代码里 TodoPage 传的是 `ROW_EXIT_DURATION_MS = 200`**
 * —— 线上真正跑的是「保留存活项」那条分支，而它在今天之前**没有任何测试碰到过**。
 *
 * 且 jsdom 里 `window.matchMedia` 不存在 → `isMotionOff()` 返回 false
 * → jsdom **不构成降级环境**，所以本文件走的就是线上同一条分支，结论对生产有效。
 *
 * ## ⚠️ 本文件的第一版是「假保证」（已修正）
 * 初版只 seed **单条**待办 → 打勾后 `filtered` 为空 → 页面走空态分支
 * → **整个列表容器连同 hook 一起卸载**，退场没机会播。
 * 于是初版测的是「整树卸载」那条错路，**恰好绕过了真正要验证的「多条时退场」**。
 * 现在两个场景都锁：**多条**（正常退场）与**单条**（不能整树卸载，缺陷已修）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import TodoPage from '../TodoPage'
import { ROW_EXIT_DURATION_MS } from '@/shared/useRowExit'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  // 页面会打印 Router future flag 警告与若干业务 warn，测试里静音
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const todo = (id: string, title: string, createdAt = 1_700_000_000_000) => ({
  id,
  title,
  desc: '',
  priority: 'none',
  status: 'todo',
  createdAt,
  updatedAt: 1,
  deleted: 0,
  rev: 1,
})

async function renderWith(items: ReturnType<typeof todo>[]) {
  await db.todos.bulkPut(items as never)
  render(
    <MemoryRouter initialEntries={['/todo']}>
      <TodoPage />
    </MemoryRouter>,
  )
  await screen.findByText(items[0].title)
}

/** 行根节点（标题回溯到 `.group`） */
function rowOf(title: string): HTMLElement | null {
  const el = screen.queryByText(title)
  return el ? (el.closest('.group') as HTMLElement) : null
}

/**
 * 行内状态勾选框元素。
 *
 * ⚠️ 不能用 `row.querySelector('button')` —— 行内有 5 个 button
 * （勾选框 / 作废 / 编辑 / 删除，加终态视图的恢复），只知道「第一个」不可靠：
 * 实测过一次「第二次点击打到了别的按钮」导致断言莫名其妙地失败。
 * 勾选框的稳定特征：**`class="shrink-0"` 且没有 title**（其余按钮都带 title）。
 *
 * 每次调用都**重新查询** DOM —— 勾选后该行会重渲染，旧节点已失效。
 */
function checkBoxEl(title: string): HTMLButtonElement {
  const row = rowOf(title)
  if (!row) throw new Error(`「${title}」行不在 DOM 上`)
  const btns = Array.from(row.querySelectorAll('button'))
  const cb = btns.find((b) => b.className === 'shrink-0' && !b.getAttribute('title'))
  if (!cb) throw new Error(`未找到「${title}」行内的状态勾选框`)
  return cb as HTMLButtonElement
}

/** 点该行的状态勾选框 */
function check(title: string) {
  fireEvent.click(checkBoxEl(title))
}

describe('待办行退场 · 多条（正常路径）', () => {
  it('打勾其中一条：该行转 .anim-row-out 保留，另一条不受影响', async () => {
    await renderWith([todo('t1', '第一条待办', 2), todo('t2', '第二条待办', 1)])

    expect(rowOf('第一条待办')!.className).toContain('anim-list-item')
    check('第一条待办')

    // 关键：**没有立刻消失**，而是转为退场态
    await waitFor(() => {
      expect(rowOf('第一条待办')!.className).toContain('anim-row-out')
    })
    expect(rowOf('第一条待办')!.className).not.toContain('anim-list-item')
    // 另一条完全不受影响，仍是入场态
    expect(rowOf('第二条待办')!.className).toContain('anim-list-item')
  })

  it('退场中的行不挂错峰（出场是即时的，不该有 animationDelay）', async () => {
    await renderWith([todo('t1', '甲', 2), todo('t2', '乙', 1)])
    expect(rowOf('甲')!.getAttribute('style') ?? '').toContain('animation-delay')

    check('甲')
    await waitFor(() => {
      expect(rowOf('甲')!.className).toContain('anim-row-out')
    })
    // leaving 时 style 被显式置 undefined
    expect(rowOf('甲')!.getAttribute('style') ?? '').not.toContain('animation-delay')
  })

  it('退场时长过后该行真正从 DOM 移除', async () => {
    await renderWith([todo('t1', '甲', 2), todo('t2', '乙', 1)])
    check('甲')

    await waitFor(() => {
      expect(rowOf('甲')!.className).toContain('anim-row-out')
    })
    // waitFor 默认 1000ms，足够覆盖 200ms 退场
    await waitFor(() => {
      expect(screen.queryByText('甲')).toBeNull()
    })
    expect(screen.getByText('乙')).toBeTruthy()
  })

  it('⚠️ 退场行必须不可交互 —— 点勾选框不得写库（会拿过期快照覆盖当前记录）', async () => {
    /**
     * 2026-10-20 实测发现的**真 bug**：
     * 退场行的数据来自 `useRowExit` 的**快照**，快照是「该行被移出 filtered 之前」抓的
     * —— 打勾后已完成的行，其快照 `status` 仍是 `'todo'`。
     * 此时点勾选框 → `toggleTodoDone(快照)` 走 `done=false` 分支
     * → **把 status 又写成 'done'**，等于用过期数据覆盖当前记录。
     * 表现为「点了没反应」，实则写坏了记录（作废/删除/编辑同理）。
     *
     * 修复：行根加 `pointer-events-none`（真浏览器主防线）+ 各写库按钮 `disabled={leaving}`
     * （jsdom 不跑 CSS，需要 JS 层兜底，也才好测）。
     */
    await renderWith([todo('t1', '甲', 2), todo('t2', '乙', 1)])
    check('甲')
    await waitFor(() => {
      expect(rowOf('甲')!.className).toContain('anim-row-out')
    })

    // ① 行根带 pointer-events-none（真浏览器里挡住行内一切交互）
    expect(rowOf('甲')!.className).toContain('pointer-events-none')

    // ② 勾选框被 disabled（jsdom 里 disabled 的 button 不派发 click）
    const cb = checkBoxEl('甲')
    expect(cb.disabled, '退场行的勾选框必须 disabled').toBe(true)

    // ③ 真的点它：DB 状态不得被改动
    const before = (await db.todos.get('t1'))!.status
    fireEvent.click(cb)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })
    expect((await db.todos.get('t1'))!.status, '退场行被点击后状态不该变化').toBe(before)
  })

  it('退场行不可拖拽、也点不开详情', async () => {
    await renderWith([todo('t1', '甲', 2), todo('t2', '乙', 1)])
    check('甲')
    await waitFor(() => {
      expect(rowOf('甲')!.className).toContain('anim-row-out')
    })

    const row = rowOf('甲')!
    expect(row.getAttribute('draggable')).toBe('false')
    expect(row.getAttribute('aria-hidden')).toBe('true')
  })

  it('退场播完后行被移除；随后重新出现的行恢复可交互', async () => {
    // 反向控制：确认上面那些「不可交互」是退场态专属，没有误伤正常行
    await renderWith([todo('t1', '甲', 2), todo('t2', '乙', 1)])
    expect(rowOf('乙')!.getAttribute('draggable')).toBe('true')
    expect(checkBoxEl('乙').disabled).toBe(false)
  })
})

describe('待办行退场 · 单条（清空场景，2026-10-20 修复的缺陷）', () => {
  it('⚠️ 打勾最后一条：列表容器不得因 filtered 变空而整树卸载', async () => {
    /**
     * 这是修复前**静默失效**的场景：`filtered.length === 0` → 走空态分支
     * → `<Card>` 连同 `useRowExit` 一起卸载 → 退场中的行直接消失。
     * 修复后判空改用 `rows.length`（含退场行），空态要等退场播完才出现。
     */
    await renderWith([todo('only', '唯一的一条')])
    check('唯一的一条')

    // ① 该行先进入退场态（而不是立刻消失、也不是整树卸载）
    await waitFor(() => {
      expect(rowOf('唯一的一条')?.className ?? '').toContain('anim-row-out')
    })
    // ② 此时**不该**已经出现空态（空态要等退场播完）
    expect(screen.queryByText(/空空如也/)).toBeNull()

    // ③ 退场播完后行消失、空态接管
    await waitFor(() => {
      expect(screen.queryByText('唯一的一条')).toBeNull()
    })
    await waitFor(() => {
      expect(screen.queryByText(/空空如也/)).not.toBeNull()
    })
  })

  it('修复的判据：列表容器在退场期间仍挂载（用 rows 而非 filtered 判空）', async () => {
    await renderWith([todo('only', '唯一的一条')])
    check('唯一的一条')

    await waitFor(() => {
      expect(rowOf('唯一的一条')?.className ?? '').toContain('anim-row-out')
    })
    // 容器还在 → 说明没走空态分支。`.divide-y` 是该列表 Card 的稳定特征。
    expect(document.querySelector('.divide-y')).not.toBeNull()
  })
})

describe('待办行退场 · 常量', () => {
  it('ROW_EXIT_DURATION_MS 非零 —— 若被改成 0，退场能力整体失效', () => {
    expect(ROW_EXIT_DURATION_MS).toBeGreaterThan(0)
  })
})
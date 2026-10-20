// @vitest-environment jsdom
/**
 * 待办列表行信息层级回归（2026-10-19 用户口径）
 *
 * 用户截图 + 说明：「代办事项页里的，第一行是标题，第二行是内容，其他标签和关联放在标题右侧。
 * 标题过长用省略号截断」。
 *
 * 本用例锁死四件事：
 *   ① 第一行 = 标题（`truncate` 截断），且标题是这一行的**第一个**子元素；
 *   ② 第二行 = 内容（备注去掉标题行后的剩余），**不重复标题**；
 *   ③ 标签（`t.tags`，前 3 枚 + 溢出计数）与归属（客户/项目/清单）在**标题右侧同行**；
 *   ④ 未设截止时间的待办**不再渲染出一个孤立的「0」**（远端 number 字段缺省落 0，
 *      `{0 && …}` 在 JSX 里求值为 0 被 React 当文本渲染 —— 用户截图第 1/2/4/5 行那个「0」）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import TodoPage from '../TodoPage'
import { todoBodyPreview } from '../title'
import { hasTime } from '../domain'

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/todo']}>
      <TodoPage />
    </MemoryRouter>,
  )
}

/** 取某条待办的行容器（由标题节点回溯到行根节点） */
function rowOf(title: string | HTMLElement): HTMLElement {
  const el = typeof title === 'string' ? screen.getByText(title) : title
  return el.closest('.group') as HTMLElement
}

describe('待办行信息层级（2026-10-19）', () => {
  it('① 第一行是标题，且在行内第一个内容位；标题带 truncate 截断', async () => {
    await db.todos.put(todo() as never)
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))
    const firstCol = row.querySelector('.min-w-0.flex-1') as HTMLElement
    // 第一行容器 = firstCol 的首个子元素（标题 + 右侧元信息所在 flex 行）
    const firstRow = firstCol.firstElementChild as HTMLElement
    const titleEl = firstRow.firstElementChild as HTMLElement
    expect(titleEl.textContent).toContain('跟进深蓝续约')
    expect(titleEl.className).toContain('truncate')
  })

  it('② 第二行是内容：备注去掉标题行后的剩余，不重复标题', async () => {
    await db.todos.put(todo() as never)
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))
    expect(within(row).getByText('本周五前给出报价，并确认合同条款')).toBeTruthy()
    // 「跟进深蓝续约」在行内只出现一次（标题位），第二行不重复
    expect(within(row).getAllByText('跟进深蓝续约')).toHaveLength(1)
  })

  it('②b 单行备注（desc === title）→ 不渲染第二行内容（避免标题二连击）', async () => {
    await db.todos.put(todo({ id: 'td2', title: '买咖啡', desc: '买咖啡' }) as never)
    renderPage()
    const row = rowOf(await screen.findByText('买咖啡'))
    const firstCol = row.querySelector('.min-w-0.flex-1') as HTMLElement
    // 第一行之外没有第二行（首行容器是唯一子元素）
    expect(firstCol.children).toHaveLength(1)
  })

  it('③ 标签与归属在标题右侧同行（同一 flex 行内、标题之后）', async () => {
    await db.customers.put({
      id: 'c1',
      name: '吴迪',
      company: '蓝湖数据',
      tags: [],
      relations: [],
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    await db.todos.put(
      todo({
        customerId: 'c1',
        tags: ['报价', 'Q3'],
      }) as never,
    )
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))
    const firstRow = (row.querySelector('.min-w-0.flex-1') as HTMLElement)
      .firstElementChild as HTMLElement
    // 第一行里同时装着标题、标签、归属
    const text = firstRow.textContent ?? ''
    expect(text).toContain('跟进深蓝续约')
    expect(text).toContain('#报价')
    expect(text).toContain('#Q3')
    expect(text).toContain('客户 蓝湖数据')
    // 归属确实排在标题之后（DOM 顺序）
    expect(text.indexOf('客户 蓝湖数据')).toBeGreaterThan(text.indexOf('跟进深蓝续约'))
    // 右侧元信息不被压缩
    const meta = firstRow.lastElementChild as HTMLElement
    expect(meta.className).toContain('shrink-0')
  })

  it('③b 标签超 3 枚折叠为 +N（列表行限幅，完整清单在 title 提示里）', async () => {
    await db.todos.put(todo({ tags: ['a', 'b', 'c', 'd', 'e'] }) as never)
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))
    expect(within(row).getByText('+2')).toBeTruthy()
    expect(within(row).queryByText('#d')).toBeNull()
  })

  it('④ 未设截止时间 → 不渲染孤立的「0」（远端 number 缺省值不得被当文本渲染）', async () => {
    await db.todos.put(todo({ dueAt: 0 }) as never)
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))
    const firstCol = row.querySelector('.min-w-0.flex-1') as HTMLElement
    // 第二行只应是内容那一行，不含裸「0」
    for (const child of Array.from(firstCol.children)) {
      expect((child.textContent ?? '').trim()).not.toBe('0')
    }
    expect(within(row).queryByText('0')).toBeNull()
  })

  it('④b 设了截止时间 → 第二行内容之后跟出「截止 …」', async () => {
    await db.todos.put(
      todo({ dueAt: new Date('2026-09-18T00:48:00').getTime() }) as never,
    )
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))
    expect(within(row).getByText(/截止 9月18日 00:48/)).toBeTruthy()
  })

  it('④c 已作废且 voidedAt 为 0 → 不渲染「作废于 Invalid Date」，退回「已作废」文案', async () => {
    await db.todos.put(
      todo({ status: 'voided', voidedAt: 0, dueAt: 0 }) as never,
    )
    renderPage()
    // 切到「已作废」视图（未完成视图不装终态条目）
    fireEvent.click(await screen.findByText('已作废'))
    const row = rowOf('跟进深蓝续约')
    const text = row.textContent ?? ''
    expect(text).toContain('已作废')
    expect(text).not.toContain('Invalid Date')
  })
})

describe('⑤ 勾选框与「标题行」垂直对齐（2026-10-21 用户口径）', () => {
  /**
   * 用户截图 + 说明：「这个打勾的只与标题对齐」。
   *
   * ## 为什么之前是歪的
   * 行根原为 `items-center`，勾选框跟着**整个主列**（标题 + 备注两行）垂直居中
   * → 它落在标题与备注之间。
   *
   * ## 真实几何（headless Chrome 实测产物 CSS，非估算）
   * | 行型 | 标题距行顶 | 勾选框距行顶 | 中点差 |
   * |------|-----------|-------------|--------|
   * | 两行行 | 12.25px | 20.72px | 勾选**低 7.27px** |
   * | 仅标题 | 14.25px | 12.25px | 勾选**高 3.20px** |
   * **两种行都偏、方向还相反** —— 偏移量取决于行高，故**任何固定偏移都修不好两种行**。
   *
   * ## 修法（零魔法数字）
   * · 行根 `items-center` → `items-start`：主列贴 padding 顶，标题 **top 恒为 12.25px**
   *   （= `py-3.5` 在 1rem=14px 下的值），两种行统一
   * · 勾选框天然顶对齐 → 与标题**同 top**，对齐不再依赖行高
   * · 右侧动作按钮逐个 `self-center` —— `items-start` 下它们会贴顶，需单独拉回
   *
   * ⚠️ 残留 1.20px 中点差是「勾选框 20px 比标题行 22.39px 矮」造成的固有量，
   * 视觉上已齐，**不该也不需消除**（除非图标变大）。
   */
  it('行根用 items-start（而非 items-center）—— 这是对齐的前提', async () => {
    await db.todos.put(todo() as never)
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))
    expect(row.className, '行根回到 items-center 会让勾选框跟着整列居中、再次歪掉').toContain(
      'items-start',
    )
  })

  it('勾选框不与动作按钮抢占对齐方式（前者顶对齐、后者居中）', async () => {
    await db.todos.put(todo() as never)
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))

    // 勾选框：不设 self-*，跟随行根的 items-start → 与标题同 top
    const cb = Array.from(row.querySelectorAll('button')).find((b) =>
      b.className.includes('shrink-0'),
    )!
    expect(cb.className, '勾选框不该有 self-* 覆盖，否则又与标题错位').not.toMatch(/\bself-(center|end)\b/)

    // 动作按钮：必须 self-center（items-start 下会贴顶）
    const actions = Array.from(row.querySelectorAll('button[title]')).filter((b) =>
      /编辑待办|删除待办|作废/.test(b.getAttribute('title') ?? ''),
    )
    expect(actions.length, '没找到行内动作按钮').toBeGreaterThan(0)
    for (const a of actions) {
      expect(a.className, `动作按钮「${a.getAttribute('title')}」缺 self-center，会贴到行顶`).toContain(
        'self-center',
      )
    }
  })

  it('两种行型的标题 top 一致（不因行高不同而漂移）', async () => {
    /**
     * 这条是「零魔法数字」的语义表达：只要行根是 items-start，
     * 标题 top 就恒等于 padding-top，与有没有备注行无关。
     * jsdom 不布局 → 只能断言结构前提（items-start 已在上一条锁住）；
     * 真实 px 由 headless 实测（见上方注释表格）。
     */
    await db.todos.put(todo() as never)
    renderPage()
    const row = rowOf(await screen.findByText('跟进深蓝续约'))
    // 行根必须带 py-3.5（标题 top 恒等于它），且不含 items-center
    expect(row.className).toContain('py-3.5')
    expect(row.className).not.toMatch(/\bitems-center\b/)
  })
})

describe('⑥ 窄屏不得被压坏（2026-10-21 用户截图：计数被挤成竖排）', () => {
  /**
   * 用户截图里「全部待办」右侧的 `0 条未完成` 被压成了 **5 行竖排**。
   *
   * ## 实测根因（headless Chrome + 产物 CSS）
   * 双栏原为**无条件** `grid-cols-[240px_1fr]` —— 窄屏时左栏仍占 240px，
   * 右栏被挤到百来像素；而列表头的 `justify-between` **没有 flex-wrap**，
   * 空间不足时不会换行、只会把子项压窄 → 计数文字逐字断开。
   * 临界值：右栏需 ≥ 344px；换算到窗口 ≈ 896px（344 + 240 + 16 + 232 侧栏 + 64 padding）。
   *
   * ## 修法
   * · 双栏加断点：`grid-cols-1 lg:grid-cols-[240px_1fr]`（窄屏单栏堆叠）
   * · 列表头 `flex-wrap` + 计数 `whitespace-nowrap`（空间不足时整组换行，绝不逐字断）
   *
   * ⚠️ 这些是**布局属性**，jsdom 不布局 → 锁只能防「类名被改回去」；
   * 真实 px 由 headless 实测（断点 1024 起并排，760~900 单栏，全宽度计数单行）。
   */
  it('双栏必须带响应式断点（窄屏单栏、lg 起才并排）', async () => {
    await db.todos.put(todo() as never)
    renderPage()
    await screen.findByText('跟进深蓝续约')

    // 取页面里那个两栏 grid 容器
    const grid = document.querySelector('.grid.grid-cols-1')
    expect(grid, '两栏容器不见了（或不再是 grid-cols-1 起手）').not.toBeNull()
    const cls = grid!.className
    expect(cls, '窄屏必须单栏：缺 grid-cols-1').toContain('grid-cols-1')
    expect(
      /lg:grid-cols-\[240px_1fr\]/.test(cls),
      '缺少 lg: 断点 —— 窄屏会回到「左栏固定 240px 挤压右栏」的老问题',
    ).toBe(true)
    // 反向控制：不得再出现无条件的固定双栏
    expect(cls, '不得再有无条件的 grid-cols-[240px_1fr]').not.toMatch(
      /(^|\s)grid-cols-\[240px_1fr\]/,
    )
  })

  it('列表头可换行、计数不断字', async () => {
    await db.todos.put(todo() as never)
    renderPage()
    await screen.findByText('跟进深蓝续约')

    const count = await screen.findByText(/条未完成/)
    // 计数本身禁止断行
    expect(count.className, '计数缺 whitespace-nowrap —— 会被逐字挤成竖排').toContain(
      'whitespace-nowrap',
    )
    // 表头允许换行（否则空间不足时压窄子项而非换行）
    const header = count.closest('.flex-wrap')
    expect(header, '列表头缺 flex-wrap —— 空间不足时会压窄子项而不是换行').not.toBeNull()
  })
})

describe('todoBodyPreview / hasTime 纯函数口径', () => {
  it('todoBodyPreview：去掉标题行、其余压成单行', () => {
    expect(
      todoBodyPreview({ title: '跟进深蓝续约', desc: '跟进深蓝续约\n本周五前给出报价' }),
    ).toBe('本周五前给出报价')
    // 历史数据（标题不在 desc 首行）经 toTodoText 补行后再切，同样只留备注
    expect(todoBodyPreview({ title: '季度复盘会', desc: '准备 Q3 数据' })).toBe('准备 Q3 数据')
    // 多行备注折成单行空格，空行丢弃
    expect(todoBodyPreview({ title: 'A', desc: 'A\nB\n\nC' })).toBe('B C')
    // 单行 / 空备注 → 空串（调用方据此不渲染第二行）
    expect(todoBodyPreview({ title: '买咖啡', desc: '买咖啡' })).toBe('')
    expect(todoBodyPreview({ title: 'X', desc: '' })).toBe('')
    expect(todoBodyPreview(null)).toBe('')
  })

  it('hasTime：0 / undefined / NaN 一律视为未设置', () => {
    expect(hasTime(1_700_000_000_000)).toBe(true)
    expect(hasTime(1)).toBe(true)
    expect(hasTime(0)).toBe(false)
    expect(hasTime(undefined)).toBe(false)
    expect(hasTime(null)).toBe(false)
    expect(hasTime(Number.NaN)).toBe(false)
  })
})
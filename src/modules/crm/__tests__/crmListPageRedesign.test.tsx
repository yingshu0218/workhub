// @vitest-environment jsdom
/**
 * 客户管理列表改版回归锁：**健康度/亲密度分层不再进左栏**
 *
 * 改版口径（用户拍板）：
 *   ① 左栏「客户分组」只放**用户自己加的分组**，分层项一律不出现；
 *   ② 分层收进工具栏「亲密度」按钮的浮层，点击才看到、可单独查看；
 *   ③ 选中后是**筛选条件**，且与自定义分组**叠加**（分组圈人 ∩ 档位），不是两套互斥视图；
 *   ④ 顶部统计卡不再有 T1/T2/T3 这类分层派生的卡。
 *
 * 为什么非要单独立一条锁：改版前左栏就是 `全部客户 + intimacyCfg.levels` 直接 `map` 出来的。
 * 一旦有人把那段加回来（或把分层同时留在左栏与浮层），界面立刻退回「分层与自定义分组混在
 * 一栏」的旧形态，而 `tsc` / `lint` / 其它用例**全绿** —— 典型的无告警静默回退。
 *
 * 反向对照：每条断言都能被「把分层 map 回左栏」「去掉档位过滤」「去掉分组叠加」三种回退打红，
 * 已在实现阶段逐一验证（详见本轮 PROGRESS 记录）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import type { IntimacyLevel } from '@/db/types'
import CrmPage from '../CrmPage'

const DAY = 86_400_000

function customer(over: {
  id: string
  name: string
  tags: string[]
  level: IntimacyLevel
  lastContactAt?: number
  createdAt?: number
}) {
  return {
    id: over.id,
    name: over.name,
    company: `${over.name}科技`,
    title: '总监',
    decisionLevel: '决策人' as const,
    tags: over.tags,
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: over.lastContactAt ?? 0,
    createdAt: over.createdAt ?? 0,
    // 显式手动档位：让用例不依赖算法兜底结果（否则三人的档位会随权重/阈值配置漂移）
    intimacy: { level: over.level, note: '', updatedAt: 0 },
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  }
}

function group(over: { id: string; name: string; includeTags: string[] }) {
  return {
    id: over.id,
    name: over.name,
    includeTags: over.includeTags,
    excludeTags: [],
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * 固定数据：3 位客户，覆盖「本月新增 / 超 7 天未联系 / 待对账收入 / 同一分组跨档位」四种情形。
 * - 张三 T1、标签「深度工作」、刚刚联系过、本月新建、有一笔待对账收入
 * - 李四 T5、标签「内容合作」、10 天未联系
 * - 王五 T5、标签「深度工作」、30 天未联系
 */
async function seed() {
  const thisMonth = new Date()
  thisMonth.setDate(1)
  thisMonth.setHours(0, 0, 0, 0)
  const now = Date.now()
  await db.customers.bulkPut([
    customer({
      id: 'c1',
      name: '张三',
      tags: ['深度工作'],
      level: 'T1',
      lastContactAt: now,
      createdAt: thisMonth.getTime() + DAY,
    }),
    customer({ id: 'c2', name: '李四', tags: ['内容合作'], level: 'T5', lastContactAt: now - 10 * DAY }),
    customer({ id: 'c3', name: '王五', tags: ['深度工作'], level: 'T5', lastContactAt: now - 30 * DAY }),
  ] as never)
  await db.customerGroups.put(group({ id: 'g1', name: '重点决策人', includeTags: ['深度工作'] }) as never)
  await db.ledgers.put({
    id: 'l1',
    name: '主账本',
    currency: 'CNY',
    openingBalance: 0,
    closingCycle: '月结' as const,
    createdAt: 0,
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  } as never)
  await db.transactions.put({
    id: 't1',
    ledgerId: 'l1',
    type: 'income' as const,
    amount: 120_000,
    summary: '二期款',
    channel: '微信',
    occurredAt: 0,
    tags: [],
    status: '待对账' as const,
    updatedAt: 1,
    deleted: 0 as const,
    rev: 1,
  } as never)
  await seedRelated('t1', 'customers', 'c1')
}


/** 播种「流水 → 目标」related link（v15 起关联在 links 表；派生行口径） */
async function seedRelated(txnId: string, toType: 'customers' | 'todos' | 'projects', toId: string) {
  const { buildLinkId } = await import('@/repositories/linkId')
  await db.links.put({
    id: buildLinkId({ type: 'transactions', id: txnId }, { type: toType, id: toId }, 'related'),
    fromType: 'transactions',
    fromId: txnId,
    toType,
    toId,
    kind: 'related',
    createdAt: 1,
    updatedAt: 0,
    rev: 0,
    deleted: 0,
  } as never)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CrmPage />
    </MemoryRouter>,
  )
}

/** 统计卡按标签定位（StatCard 的容器是 .card） */
function statCard(label: string): HTMLElement {
  const el = screen.getByText(label).closest('.card')
  if (!el) throw new Error(`未找到统计卡：${label}`)
  return el as HTMLElement
}

async function openLevelMenu() {
  fireEvent.click(screen.getByRole('button', { name: '按亲密度筛选' }))
  return screen.findByRole('listbox', { name: '亲密度分层' })
}

describe('客户管理列表改版：分层不进左栏', () => {
  it('左栏只放自定义分组，7 个分层项一个都不出现（浮层未展开时整份 DOM 里都没有）', async () => {
    await seed()
    renderPage()

    // 等数据回填（liveQuery 首帧为空）
    expect(await screen.findByText('王五')).toBeTruthy()
    // 左栏：全部客户 + 我的分组
    expect(screen.getByText('全部客户').closest('button')?.textContent).toContain('3')
    expect(screen.getByText('我的分组')).toBeTruthy()
    expect(screen.getByText('重点决策人')).toBeTruthy()

    for (const key of ['T1', 'T2', 'T3', 'T4', 'T5', 'I6', 'I7']) {
      expect(screen.queryByText(new RegExp(`${key} · `))).toBeNull()
    }
    // 顶部统计：换成分层无关的指标，且旧的分层卡标题不复存在
    expect(screen.queryByText('T1 · 核心')).toBeNull()
    expect(screen.queryByText('T2 · 信赖')).toBeNull()
    expect(screen.queryByText('T3 · 合作')).toBeNull()
  })

  it('顶部统计卡口径：总数 / 本月新增 / 待跟进 / 待核对收入（均非分层派生）', async () => {
    await seed()
    renderPage()
    expect(await screen.findByText('王五')).toBeTruthy()

    expect(within(statCard('客户总数')).getByText('3')).toBeTruthy()
    expect(within(statCard('本月新增')).getByText('1')).toBeTruthy()
    // 李四 10 天未联系 + 王五 30 天未联系 = 2（张刚刚联系过，不计）
    expect(within(statCard('待跟进')).getByText('2')).toBeTruthy()
    expect(within(statCard('待跟进')).getByText('超 7 天未联系')).toBeTruthy()
    // 待对账收入走 transactions 查询（liveQuery 回填比 customers 晚一拍），故用 findBy
    expect(await within(statCard('待核对收入')).findByText('CNY 120,000')).toBeTruthy()
    expect(await within(statCard('待核对收入')).findByText('张三 · 二期款')).toBeTruthy()
  })

  it('点开「亲密度」浮层能看到全部分层与人数，选中即成为筛选条件', async () => {
    await seed()
    renderPage()
    expect(await screen.findByText('王五')).toBeTruthy()

    const listbox = await openLevelMenu()
    // 全部 7 层都在浮层里，且带人数
    for (const label of ['T1 · 核心', 'T2 · 信赖', 'T3 · 合作', 'T4 · 一般', 'T5 · 照面', 'I6 · 疏远', 'I7 · 黑名单']) {
      expect(within(listbox).getByText(label)).toBeTruthy()
    }
    expect(within(listbox).getByText('T1 · 核心').closest('button')?.textContent).toContain('1')
    expect(within(listbox).getByText('T5 · 照面').closest('button')?.textContent).toContain('2')

    // 选中 T5 · 照面 → 列表只剩 T5 的两位
    fireEvent.click(within(listbox).getByText('T5 · 照面'))
    expect(screen.queryByText('张三')).toBeNull()
    expect(screen.getByText('李四')).toBeTruthy()
    expect(screen.getByText('王五')).toBeTruthy()
    // 按钮自身显示为「已选」的筛选条件
    expect(screen.getByRole('button', { name: '按亲密度筛选' }).textContent).toContain('亲密度 · 照面')
    expect(screen.getByText('共 2 位客户')).toBeTruthy()
  })

  it('亲密度与自定义分组是叠加关系（分组圈人 ∩ 档位），不是互斥的两套视图', async () => {
    await seed()
    renderPage()
    expect(await screen.findByText('王五')).toBeTruthy()

    // 只选分组：命中「深度工作」的张三 + 王五
    fireEvent.click(screen.getByText('重点决策人'))
    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.getByText('王五')).toBeTruthy()
    expect(screen.queryByText('李四')).toBeNull()

    // 再叠 T5：只剩同时满足「深度工作 且 T5」的王五
    const listbox = await openLevelMenu()
    fireEvent.click(within(listbox).getByText('T5 · 照面'))
    expect(screen.getByText('王五')).toBeTruthy()
    expect(screen.queryByText('张三')).toBeNull()
    expect(screen.queryByText('李四')).toBeNull()
  })

  it('「清除筛选条件」把档位筛选清掉，且不影响已选的自定义分组', async () => {
    await seed()
    renderPage()
    expect(await screen.findByText('王五')).toBeTruthy()

    fireEvent.click(screen.getByText('重点决策人'))
    const listbox = await openLevelMenu()
    fireEvent.click(within(listbox).getByText('T5 · 照面'))
    expect(screen.queryByText('张三')).toBeNull()

    // 再开浮层点「清除筛选条件」→ 档位回到全部，分组选择保留
    const reopened = await openLevelMenu()
    fireEvent.click(within(reopened).getByText('清除筛选条件'))
    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.queryByText('李四')).toBeNull() // 分组仍在生效
  })
})

/**
 * 动作面补全（2026-10-21）回归测试 —— 新增 7 个工具的**行为级**断言。
 *
 * 与 `functional.sweep.test.ts` 的分工：
 * - 遍历测试证明「每个工具都能调通」，但它只验证返回 ok 与少量读回读；
 * - 本文件锁住**容易被改坏且看不出来**的语义：
 *   ① `habit_createHabit` 的默认值必须与 UI 初值逐字段一致（改了默认值 = 界面上新建的习惯变了样）；
 *   ② `fin_updateTransaction` **不得重发 `transaction:created`**（重发会让奖杯/EXP 多算一次）；
 *   ③ 删除类工具的 `sideEffects` 计数必须**先统计后删除**（顺序写反会恒为 0，Agent 会跟用户说「无副作用」）；
 *   ④ 级联真的发生了（附件/里程碑被软删，而不是只删了主记录）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { eventBus, type AppEvent } from '@/shared/eventBus'
import { habitRepo, customerRepo, todoRepo, projectRepo, transactionRepo } from '@/repositories'
import {
  habit_createHabit,
  habit_updateHabit,
  fin_updateTransaction,
  fin_deleteTransaction,
  note_deleteNote,
  crm_deleteCustomer,
  project_deleteProject,
  AGENT_TOOLS,
} from '../executor'
import { TOOL_DOMAIN, TOOL_RISK } from '../schema'
import type { Customer, Habit, Note, Project, ProjectMilestone, Todo, Transaction } from '@/db/types'

type Captured = { event: keyof AppEvent; payload: unknown }

/** 捕获领域事件（含真实分发），用于断言「该发的一次不少、不该发的一次没有」 */
function capture(): { events: Captured[]; restore: () => void } {
  const events: Captured[] = []
  const orig = eventBus.emit.bind(eventBus)
  eventBus.emit = (event: keyof AppEvent, payload: unknown) => {
    events.push({ event, payload })
    ;(orig as unknown as (e: keyof AppEvent, p: unknown) => void)(event, payload)
  }
  return {
    events,
    restore: () => {
      eventBus.emit = orig
    },
  }
}

function newHabit(id: string, over: Partial<Habit> = {}): Habit {
  return {
    id,
    name: '晨跑',
    icon: 'directions_run',
    color: '#000',
    category: '健康',
    schedule: '每日',
    targetMinutes: 0,
    motivationNote: '',
    crossModuleSync: false,
    createdAt: 1,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
    ...over,
  } as Habit
}

function newTxn(id: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id,
    ledgerId: 'l1',
    type: 'expense',
    amount: 120,
    summary: '晚饭',
    channel: '',
    occurredAt: Date.now(),
    tags: [],
    status: '待对账',
    createdAt: Date.now(),
    updatedAt: 0,
    deleted: 0,
    rev: 0,
    ...over,
  } as Transaction
}

function newCustomer(id: string, over: Partial<Customer> = {}): Customer {
  return {
    id,
    name: '王五',
    company: '深蓝科技',
    title: '',
    decisionLevel: '决策人',
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: 0,
    createdAt: 1,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
    ...over,
  } as Customer
}

function newProject(id: string, over: Partial<Project> = {}): Project {
  return {
    id,
    name: '远山年度视觉',
    color: '#004ac6',
    status: 'active',
    createdAt: 1,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
    ...over,
  } as Project
}

function newMilestone(id: string, projectId: string, over: Partial<ProjectMilestone> = {}): ProjectMilestone {
  return {
    id,
    projectId,
    name: '阶段一',
    weight: 1,
    status: 'planned',
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 0,
    deleted: 0,
    rev: 0,
    ...over,
  } as ProjectMilestone
}

function newAttachment(id: string) {
  // 归属已迁 links（v15）：附件行不再自带 refType/refId，归属 link 单独播种
  return {
    id,
    name: `${id}.png`,
    mime: 'image/png',
    size: 10,
    blob: new Blob(['x']),
    createdAt: 1,
    updatedAt: 0,
    deleted: 0 as const,
    rev: 0,
  }
}

/** 播种「流水 → 客户/项目/待办」related link（关联统计与解绑断言 v15 起都走 links） */
async function seedRelatedLink(txnId: string, toType: 'customers' | 'projects' | 'todos', toId: string): Promise<void> {
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

/** 播种「流水 → 附件」归属 link（读路径与级联统计 v15 起都走 links） */
async function seedAttLink(txnId: string, attId: string): Promise<void> {
  const { buildLinkId } = await import('@/repositories/linkId')
  await db.links.put({
    id: buildLinkId({ type: 'transactions', id: txnId }, { type: 'attachments', id: attId }, 'attachment'),
    fromType: 'transactions',
    fromId: txnId,
    toType: 'attachments',
    toId: attId,
    kind: 'attachment',
    createdAt: 1,
    updatedAt: 0,
    rev: 0,
    deleted: 0,
  } as never)
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('habit_createHabit / habit_updateHabit', () => {
  it('默认值与 UI「新建习惯」初值逐字段一致', async () => {
    const r = await habit_createHabit({ name: '晨跑 30 分钟' })
    expect(r.ok).toBe(true)
    const id = (r.data as { habitId: string }).habitId
    const habit = await habitRepo.get(id)

    // 这组值是 HabitFormDrawer 的初值 —— 改这里等于改了「界面新建」的默认外观
    expect(habit).toMatchObject({
      name: '晨跑 30 分钟',
      icon: 'fitness_center',
      color: '#2563eb',
      category: '成长',
      schedule: '每日',
      targetMinutes: 25,
      motivationNote: '',
      crossModuleSync: false,
    })
  })

  it('显式传值覆盖默认；不 emit 任何领域事件', async () => {
    const cap = capture()
    const r = await habit_createHabit({
      name: '读书',
      icon: 'menu_book',
      schedule: '每周3次',
      targetMinutes: 40,
      crossModuleSync: true,
    })
    cap.restore()

    const id = (r.data as { habitId: string }).habitId
    const habit = await habitRepo.get(id)
    expect(habit).toMatchObject({
      icon: 'menu_book',
      schedule: '每周3次',
      targetMinutes: 40,
      crossModuleSync: true,
    })
    expect(cap.events).toHaveLength(0)
  })

  it('部分更新（只改节奏）不动其它字段', async () => {
    await habitRepo.put(newHabit('h1', { name: '晨跑', targetMinutes: 30, icon: 'brain' }))
    const r = await habit_updateHabit({ habitId: 'h1', schedule: '工作日' })
    expect(r.ok).toBe(true)

    const habit = await habitRepo.get('h1')
    expect(habit).toMatchObject({
      name: '晨跑',
      icon: 'brain',
      targetMinutes: 30,
      schedule: '工作日',
    })
  })

  it('习惯不存在 → 可操作错误（不静默成功）', async () => {
    const r = await habit_updateHabit({ habitId: 'nope', targetMinutes: 10 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('习惯不存在')
  })
})

describe('fin_updateTransaction', () => {
  it('改金额落库，且**不重发** transaction:created（防奖杯/EXP 重复计数）', async () => {
    await transactionRepo.put(newTxn('t1', { amount: 2000 }))
    const cap = capture()
    const r = await fin_updateTransaction({ transactionId: 't1', amount: 1800 })
    cap.restore()

    expect(r.ok).toBe(true)
    expect((await transactionRepo.get('t1'))?.amount).toBe(1800)
    // 核心断言：编辑不是新建，事件必须一次都不发
    expect(cap.events.filter((e) => e.event === 'transaction:created')).toHaveLength(0)
  })

  it('occurredAt 落当天 00:00（与 UI 记账时间口径同源）', async () => {
    await transactionRepo.put(newTxn('t1'))
    await fin_updateTransaction({ transactionId: 't1', occurredAt: '2026-10-01' })
    const txn = await transactionRepo.get('t1')
    const d = new Date(txn!.occurredAt)
    expect(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).toBe(
      '2026-10-01',
    )
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })

  it('关联客户不存在 → 拒绝（不留悬挂引用）', async () => {
    await transactionRepo.put(newTxn('t1'))
    const r = await fin_updateTransaction({ transactionId: 't1', customerId: 'cus-not-exist' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('客户不存在')
  })

  it('显式传空数组 = 清空该关联（related link 墓碑化，流水行不动）', async () => {
    await transactionRepo.put(newTxn('t1'))
    await seedRelatedLink('t1', 'customers', 'c1')
    const r = await fin_updateTransaction({ transactionId: 't1', customerIds: [] })
    expect(r.ok).toBe(true)
    // v15 起关联在 links：清空 = 对应 link 墓碑化（软删可追溯），流水行本身不再携带关联键
    const { buildLinkId } = await import('@/repositories/linkId')
    const linkId = buildLinkId(
      { type: 'transactions', id: 't1' },
      { type: 'customers', id: 'c1' },
      'related',
    )
    expect((await db.links.get(linkId))?.deleted).toBe(1)
  })
})

describe('fin_deleteTransaction', () => {
  it('sideEffects 统计在删除前做：2 个附件 → cascadedAttachments=2，且附件真被软删', async () => {
    await transactionRepo.put(newTxn('t1'))
    await db.attachments.bulkPut([newAttachment('a1'), newAttachment('a2')])
    await seedAttLink('t1', 'a1')
    await seedAttLink('t1', 'a2')

    const r = await fin_deleteTransaction({ transactionId: 't1' })
    expect(r.ok).toBe(true)
    // 顺序写反（先删后统计）会恒为 0 —— Agent 就会跟用户说「没有凭证会被删」
    expect((r.data as { sideEffects: { cascadedAttachments: number } }).sideEffects.cascadedAttachments).toBe(2)

    expect((await transactionRepo.get('t1'))).toBeUndefined()
    expect((await db.attachments.get('a1'))?.deleted).toBe(1)
    expect((await db.attachments.get('a2'))?.deleted).toBe(1)
  })

  it('流水不存在 → 可操作错误', async () => {
    const r = await fin_deleteTransaction({ transactionId: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('流水不存在')
  })
})

describe('crm_deleteCustomer', () => {
  it('级联软删沟通日志、解绑流水/待办/项目、清关系，sideEffects 逐项如实', async () => {
    await customerRepo.put(newCustomer('c1'))
    await customerRepo.put(newCustomer('c2', { name: '赵六', relations: [{ targetId: 'c1', label: '同事' } as never] }))
    await db.interactions.bulkPut([
      { id: 'i1', customerId: 'c1', content: '电话', at: 1, updatedAt: 0, deleted: 0, rev: 0 },
      { id: 'i2', customerId: 'c1', content: '拜访', at: 2, updatedAt: 0, deleted: 0, rev: 0 },
    ])
    await transactionRepo.put(newTxn('t1'))
    await seedRelatedLink('t1', 'customers', 'c1')
    await todoRepo.put({
      id: 'td1',
      title: '回访',
      desc: '',
      priority: 'mid',
      status: 'todo',
      customerId: 'c1',
      createdAt: 1,
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as Todo)
    await projectRepo.put(newProject('p1', { customerId: 'c1' }))

    const r = await crm_deleteCustomer({ customerId: 'c1' })
    expect(r.ok).toBe(true)
    expect((r.data as { sideEffects: Record<string, number> }).sideEffects).toEqual({
      cascadedInteractions: 2,
      unlinkedTransactions: 1,
      unlinkedTodos: 1,
      unlinkedProjects: 1,
      clearedRelations: 1,
    })

    // 级联：日志软删；流水/待办/项目只解绑不删除
    expect((await db.interactions.get('i1'))?.deleted).toBe(1)
    expect((await transactionRepo.get('t1'))).toBeTruthy() // 流水不删，只解绑
    const { buildLinkId: bl } = await import('@/repositories/linkId')
    expect(
      (
        await db.links.get(
          bl({ type: 'transactions', id: 't1' }, { type: 'customers', id: 'c1' }, 'related'),
        )
      )?.deleted,
    ).toBe(1)
    expect((await todoRepo.get('td1'))?.customerId).toBeUndefined()
    expect((await projectRepo.get('p1'))?.customerId).toBeUndefined()
    expect((await customerRepo.get('c2'))?.relations).toEqual([])
  })
})

describe('project_deleteProject', () => {
  it('级联软删里程碑、解绑四表，sideEffects 如实', async () => {
    await projectRepo.put(newProject('p1'))
    await db.projectMilestones.bulkPut([newMilestone('m1', 'p1'), newMilestone('m2', 'p1')])
    await transactionRepo.put(newTxn('t1'))
    await seedRelatedLink('t1', 'projects', 'p1')
    await todoRepo.put({
      id: 'td1',
      title: '推进',
      desc: '',
      priority: 'mid',
      status: 'todo',
      projectId: 'p1',
      createdAt: 1,
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as Todo)
    await db.notes.put({
      id: 'n1',
      title: '笔记',
      markdown: '',
      tags: [],
      backlinks: [],
      mentions: [],
      projectId: 'p1',
      createdAt: 1,
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as Note)

    const r = await project_deleteProject({ projectId: 'p1' })
    expect(r.ok).toBe(true)
    expect((r.data as { sideEffects: Record<string, number> }).sideEffects).toEqual({
      cascadedMilestones: 2,
      unlinkedTransactions: 1,
      unlinkedTodos: 1,
      unlinkedNotes: 1,
      unlinkedInteractions: 0,
    })

    expect((await db.projectMilestones.get('m1'))?.deleted).toBe(1)
    expect((await db.projectMilestones.get('m2'))?.deleted).toBe(1)
    const { buildLinkId: bl2 } = await import('@/repositories/linkId')
    expect(
      (
        await db.links.get(
          bl2({ type: 'transactions', id: 't1' }, { type: 'projects', id: 'p1' }, 'related'),
        )
      )?.deleted,
    ).toBe(1)
  })
})

describe('note_deleteNote', () => {
  it('软删笔记（记录仍在库，deleted=1）', async () => {
    await db.notes.put({
      id: 'n1',
      title: '草稿',
      markdown: '',
      tags: [],
      backlinks: [],
      mentions: [],
      createdAt: 1,
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as Note)
    const r = await note_deleteNote({ noteId: 'n1' })
    expect(r.ok).toBe(true)
    expect((await db.notes.get('n1'))?.deleted).toBe(1)
  })
})

describe('契约完整性：新工具三处注册齐备', () => {
  const NEW_TOOLS = [
    'habit_createHabit',
    'habit_updateHabit',
    'fin_updateTransaction',
    'fin_deleteTransaction',
    'note_deleteNote',
    'crm_deleteCustomer',
    'project_deleteProject',
  ] as const

  it.each(NEW_TOOLS)('%s 在 AGENT_TOOLS / TOOL_RISK / TOOL_DOMAIN 三处都有登记', (name) => {
    expect(AGENT_TOOLS[name as keyof typeof AGENT_TOOLS]).toBeTruthy()
    expect(TOOL_RISK[name]).toMatch(/^(low|medium|high)$/)
    expect(TOOL_DOMAIN[name]).toBeTruthy()
  })

  it('删除类一律 high（不可逆必须二次确认），创建习惯为 low', () => {
    for (const name of ['fin_deleteTransaction', 'note_deleteNote', 'crm_deleteCustomer', 'project_deleteProject']) {
      expect(TOOL_RISK[name]).toBe('high')
    }
    expect(TOOL_RISK['habit_createHabit']).toBe('low')
    expect(TOOL_RISK['fin_updateTransaction']).toBe('medium')
  })
})

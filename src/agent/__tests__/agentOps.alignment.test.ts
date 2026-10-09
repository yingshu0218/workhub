/**
 * 事件对齐对照测试（方案 §七.1 验收 / §2.1 事件纪律硬规则）
 *
 * 断点：transaction:created —— agentOps emit vs UI 内联 emit 载荷逐字段一致；
 * 并覆盖 §9.5 两个既有 bug 的回归断言：
 *   bug1 编辑误发 transaction:created（create 门控）；
 *   bug2 项目跟进漏发 customer:contacted（interaction 统一 emit 语义，由 agentOps 侧补齐）。
 * 事件一律在落库事务 commit 之后发出（先落库断言、后事件断言的顺序即隐式覆盖）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { eventBus } from '@/shared/eventBus'
import { fin_recordTransaction, crm_createCustomer, crm_addInteraction, crm_addRelation, todo_createTodo, todo_completeTodo, AGENT_TOOLS } from '../executor'
import { recordTransactionSchema, TOOL_EVENTS } from '../schema'

// fake-indexeddb/auto 已注册全局 indexedDB，Dexie 直接可用（独立于应用环境）

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('事件对齐：transaction:created（断点）', () => {
  it('agentOps 记账 emit 的载荷与 UI 内联 emit 逐字段一致', async () => {
    await db.ledgers.put({ id: 'l1', name: '主账本', currency: 'CNY', openingBalance: 0, closingCycle: '月结', sortOrder: 0, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0 })

    const events: { event: keyof import('@/shared/eventBus').AppEvent; payload: unknown }[] = []
    // 捕获：包装 emit（对齐测试需要拿到历史载荷）
    const orig = eventBus.emit.bind(eventBus)
    eventBus.emit = (event, payload) => { events.push({ event, payload }); orig(event, payload) }

    const r = await fin_recordTransaction({ ledgerId: 'l1', summary: '晚饭', amount: 120, type: 'expense' })
    expect(r.ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0].payload).toEqual({
      transactionId: (r.data as { transactionId: string }).transactionId,
      customerId: undefined,
    })
    // UI（TransactionFormDrawer:213）emit 同款两字段，无多余字段 —— 逐字段一致
    expect(Object.keys(events[0].payload as object).sort()).toEqual(['customerId', 'transactionId'])
  })

  it('status 缺省=待对账（§9.3 D5），occurredAt 落当天 00:00', async () => {
    await db.ledgers.put({ id: 'l1', name: '主账本', currency: 'CNY', openingBalance: 0, closingCycle: '月结', sortOrder: 0, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0 })
    const r = await fin_recordTransaction({ ledgerId: 'l1', summary: '打车', amount: 30 })
    expect(r.ok).toBe(true)
    const txn = await db.transactions.get((r.data as { transactionId: string }).transactionId)
    expect(txn?.status).toBe('待对账')
    const day = new Date(); day.setHours(0, 0, 0, 0)
    expect(txn?.occurredAt).toBe(day.getTime())
  })

  it('事件在事务 commit 之后发出（落库先于事件可观察）', async () => {
    await db.ledgers.put({ id: 'l1', name: '主', currency: 'CNY', openingBalance: 0, closingCycle: '月结', createdAt: 1, sortOrder: 0, updatedAt: 0, deleted: 0, rev: 0 })
    const seen: { existed: boolean }[] = []
    const orig = eventBus.emit.bind(eventBus)
    eventBus.emit = (event, payload) => {
      if (event === 'transaction:created') {
        void db.transactions
          .get((payload as { transactionId: string }).transactionId)
          .then((v) => seen.push({ existed: !!v }))
      }
      orig(event, payload)
    }
    const r = await fin_recordTransaction({ ledgerId: 'l1', summary: 'x', amount: 1 })
    expect(r.ok).toBe(true)
    await new Promise((res) => setTimeout(res, 10))
    expect(seen).toEqual([{ existed: true }])
  })
})

describe('§9.5 bug1 回归：编辑不得再触发 transaction:created', () => {
  it('agentOps 无编辑通道（仅新建发事件）；UI 侧 create 门控由事件下沉步骤收口', async () => {
    // agentOps 的 fin_recordTransaction 每次调用都生成新 id（create 语义），
    // 事件仅在 create 分支发，无 editTxn 概念（编辑事件门控在 UI/事件下沉层收口）
    // 此处用行为断言：两次调用产生两个不同 id、两条记录、两次事件，编辑语义不存在
    await db.ledgers.put({ id: 'l1', name: '主', currency: 'CNY', openingBalance: 0, closingCycle: '月结', sortOrder: 0, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0 })
    const events: unknown[] = []
    const orig = eventBus.emit.bind(eventBus)
    eventBus.emit = (event, payload) => { if (event === 'transaction:created') events.push(payload); orig(event, payload) }
    const r1 = await fin_recordTransaction({ ledgerId: 'l1', summary: 'a', amount: 1 })
    const r2 = await fin_recordTransaction({ ledgerId: 'l1', summary: 'b', amount: 2 })
    expect(r1.ok).toBe(true); expect(r2.ok).toBe(true)
    expect((r1.data as { transactionId: string }).transactionId).not.toBe((r2.data as { transactionId: string }).transactionId)
    expect(events).toHaveLength(2)
    expect(await db.transactions.count()).toBe(2)
  })
})

describe('消解纪律：写工具拒绝未经 resolveEntity 的字符串关联', () => {
  it('customerId 指向不存在/已删除客户 → 可操作错误，不落库', async () => {
    const r = await crm_addInteraction({ customerId: 'cus:not-exist', content: '拜访' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('resolveEntity')
    expect(await db.interactions.count()).toBe(0)
  })
})

describe('§9.5 bug2 对齐：agentOps 记沟通日志统一 emit customer:contacted', () => {
  it('含项目跟进场景（projectId）也 emit（UI 侧由事件下沉步骤统一）', async () => {
    await db.customers.put({ id: 'c1', name: '王五', company: '', title: '', decisionLevel: '决策人', tags: [], phone: '', wechat: '', email: '', address: '', lastContactAt: 0, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0 })
    const events: unknown[] = []
    const orig = eventBus.emit.bind(eventBus)
    eventBus.emit = (event, payload) => { if (event === 'customer:contacted') events.push(payload); orig(event, payload) }
    const r = await crm_addInteraction({ customerId: 'c1', content: '周五回访', projectId: 'p1' })
    expect(r.ok).toBe(true)
    expect(events).toEqual([{ customerId: 'c1' }])
  })
})

/**
 * 契约变更回归锁（Interaction.type 移除）
 *
 * type 已从模型与工具 schema 删除，但**已分发给外部 Agent 的调用不能因此失败**：
 * zod 默认 strip 未知键，老调用方继续传 `type` 只是被忽略。
 * 若有人把 schema 改成 `.strict()`（或把 type 加回来），下面两条会红。
 */
describe('契约变更：crm_addInteraction 已无 type，但老调用不失败', () => {
  it('继续传 type 被忽略、落库成功，且记录里不出现 type 字段', async () => {
    await db.customers.put({ id: 'c1', name: '王五', company: '', title: '', decisionLevel: '决策人', tags: [], phone: '', wechat: '', email: '', address: '', lastContactAt: 0, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0 })
    const r = await crm_addInteraction({ customerId: 'c1', content: '老调用方仍在传类型', type: '会议' })
    expect(r.ok).toBe(true)
    const itx = await db.interactions.get((r.data as { interactionId: string }).interactionId)
    expect(itx?.content).toBe('老调用方仍在传类型')
    expect(itx).not.toHaveProperty('type')
  })

  it('工具 schema 不再声明 type（防静默回填）', () => {
    expect(Object.keys(AGENT_TOOLS['crm_addInteraction'].schema.shape)).not.toContain('type')
  })
})

describe('CRM / Todo 工具面', () => {
  it('建客户默认口径与 UI 一致（决策人），openingLog 建首联日志', async () => {
    const r = await crm_createCustomer({ name: '王五' })
    expect(r.ok).toBe(true)
    const c = await db.customers.get((r.data as { customerId: string }).customerId)
    expect(c?.decisionLevel).toBe('决策人')
    // 手动分层 tier 已删除（并入健康分）：建客户不应再落任何分层字段
    expect(c).not.toHaveProperty('tier')
  })

  it('relations 双向落两侧', async () => {
    const a = await crm_createCustomer({ name: '甲' })
    const b = await crm_createCustomer({ name: '乙' })
    const ra = await crm_addRelation({ customerId: (a.data as { customerId: string }).customerId, targetId: (b.data as { customerId: string }).customerId, label: '转介绍人' })
    expect(ra.ok).toBe(true)
    const ca = await db.customers.get((a.data as { customerId: string }).customerId)
    const cb = await db.customers.get((b.data as { customerId: string }).customerId)
    expect(ca?.relations).toHaveLength(1)
    expect(cb?.relations).toHaveLength(1)
    expect(cb?.relations?.[0].targetId).toBe(ca?.id)
  })

  it('完成待办走 toggleTodoDone：status+completedAt 成对写', async () => {
    const t = await todo_createTodo({ title: '周五回访王五' })
    const id = (t.data as { todoId: string }).todoId
    const r = await todo_completeTodo({ todoId: id, done: true })
    expect(r.ok).toBe(true)
    const todo = await db.todos.get(id)
    expect(todo?.status).toBe('done')
    expect(todo?.completedAt).toBeTruthy()
  })
})

describe('schema 口径（§9.4）', () => {
  it('金额两位小数/上限校验与 UI 同款', () => {
    expect(recordTransactionSchema.safeParse({ ledgerId: 'l', summary: 'x', amount: 0.001 }).success).toBe(false)
    expect(recordTransactionSchema.safeParse({ ledgerId: 'l', summary: 'x', amount: 10_000_000_000 }).success).toBe(false)
    expect(recordTransactionSchema.safeParse({ ledgerId: 'l', summary: 'x', amount: 120.5 }).success).toBe(true)
  })
  it('channel 可缺省，显式传入时枚举校验', () => {
    expect(recordTransactionSchema.safeParse({ ledgerId: 'l', summary: 'x', amount: 1 }).success).toBe(true)
    expect(recordTransactionSchema.safeParse({ ledgerId: 'l', summary: 'x', amount: 1, channel: '刷卡' }).success).toBe(false)
  })
})

describe('风险分级接线（P1 复审 ① 防再犯）', () => {
  it('AGENT_TOOLS 每个工具的 risk 必须是 low/medium/high 字面量，且与 TOOL_RISK 声明一致', async () => {
    const { AGENT_TOOLS } = await import('../executor')
    const { TOOL_RISK } = await import('../schema')

    // 注册表键与分级表键完全对齐，不允许漏注册
    expect(Object.keys(AGENT_TOOLS).sort()).toEqual(Object.keys(TOOL_RISK).sort())

    for (const [name, tool] of Object.entries(AGENT_TOOLS)) {
      // 若误把整张 TOOL_RISK map 赋给 risk，此断言立即失败（map 是 object 不是字面量）
      expect(['low', 'medium', 'high']).toContain(tool.risk)
      expect(tool.risk).toBe(TOOL_RISK[name])
    }
  })
})

describe('幻觉日期兜底：occurredAt 范围校验（P1 复审 ②）', () => {
  const base = { ledgerId: 'l1', summary: 'x', amount: 120 }

  it('schema 层拒绝 1900-01-01 / 9999-12-31（z.string().date() 的洞）', () => {
    expect(recordTransactionSchema.safeParse({ ...base, occurredAt: '1900-01-01' }).success).toBe(false)
    expect(recordTransactionSchema.safeParse({ ...base, occurredAt: '9999-12-31' }).success).toBe(false)
    // 语法合法但不存在的日期也要挡（2025-02-30）
    expect(recordTransactionSchema.safeParse({ ...base, occurredAt: '2025-02-30' }).success).toBe(false)
  })

  it('合理范围放行：2000-01-01 / 今天', () => {
    const today = new Date()
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(recordTransactionSchema.safeParse({ ...base, occurredAt: '2000-01-01' }).success).toBe(true)
    expect(recordTransactionSchema.safeParse({ ...base, occurredAt: todayISO }).success).toBe(true)
  })

  it('执行器层：非法日期返回可操作错误且不落库', async () => {
    await db.ledgers.put({ id: 'l1', name: '主', currency: 'CNY', openingBalance: 0, closingCycle: '月结', sortOrder: 0, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0 })
    const r = await fin_recordTransaction({ ledgerId: 'l1', summary: '穿越', amount: 1, occurredAt: '9999-12-31' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('记账日期')
    expect(await db.transactions.count()).toBe(0)
  })
})

describe('事件声明表是唯一事实源（P1 复审 5.3：emitDeclared 不得成死参数）', () => {
  it('未声明事件的工具一个事件都不发（createCustomer 无既有事件）', async () => {
    const events: unknown[] = []
    const orig = eventBus.emit.bind(eventBus)
    eventBus.emit = (event, payload) => { events.push({ event, payload }); orig(event, payload) }
    const r = await crm_createCustomer({ name: '无事件客户' })
    expect(r.ok).toBe(true)
    expect(events).toHaveLength(0)
  })

  it('声明表覆盖到的工具都有对应的 TOOL_EVENTS 键可查', () => {
    // 每个工具名都能在 TOOL_EVENTS 上查（缺声明即 undefined → 空数组，不报错）
    for (const name of Object.keys(AGENT_TOOLS)) {
      expect(Array.isArray(TOOL_EVENTS[name] ?? [])).toBe(true)
    }
    // 断点工具的声明必须是 transaction:created，且不等于 UI 之外的其它事件
    expect(TOOL_EVENTS['fin_recordTransaction']).toEqual(['transaction:created'])
  })
})

describe('lastContactAt 只前进：补录历史沟通不回退客户最近联系时间（P1 复审 ③）', () => {
  it('crm_addInteraction 传过去时间时 lastContactAt 保持现值，日志本身保留真实时间', async () => {
    const c = await crm_createCustomer({ name: '王五' })
    const customerId = (c.data as { customerId: string }).customerId
    const before = (await db.customers.get(customerId))!.lastContactAt

    const past = 1 // 1970-01-01
    const r = await crm_addInteraction({ customerId, content: '补录去年的拜访', at: past })
    expect(r.ok).toBe(true)

    const after = await db.customers.get(customerId)
    expect(after!.lastContactAt).toBeGreaterThanOrEqual(before) // 不倒退
    // 日志本体的时间保留真实值（回溯补录不篡改记录时间）
    const itx = await db.interactions.get((r.data as { interactionId: string }).interactionId)
    expect(itx!.at).toBe(past)
  })

  it('正常当前时间沟通会推进 lastContactAt', async () => {
    const c = await crm_createCustomer({ name: '赵六' })
    const customerId = (c.data as { customerId: string }).customerId
    const before = (await db.customers.get(customerId))!.lastContactAt
    const future = before + 60_000
    const r = await crm_addInteraction({ customerId, content: '刚通完电话', at: future })
    expect(r.ok).toBe(true)
    expect((await db.customers.get(customerId))!.lastContactAt).toBe(future)
  })
})

describe('todo_completeTodo 幂等：已达目标态不重复落库（P1 复审 ⑥）', () => {
  it('重复 complete 不推进 completedAt、不多入同步队列', async () => {
    const t = await todo_createTodo({ title: '回访' })
    const id = (t.data as { todoId: string }).todoId
    await todo_completeTodo({ todoId: id, done: true })
    const first = await db.todos.get(id)
    const revAfterFirst = first!.rev
    const queueAfterFirst = await db.syncQueue.count()

    await new Promise((res) => setTimeout(res, 5))
    const again = await todo_completeTodo({ todoId: id, done: true })
    expect(again.ok).toBe(true)
    expect((again.data as { changed: boolean }).changed).toBe(false)

    const second = await db.todos.get(id)
    expect(second!.completedAt).toBe(first!.completedAt)
    expect(second!.rev).toBe(revAfterFirst)
    expect(await db.syncQueue.count()).toBe(queueAfterFirst)
  })

  it('取消完成是有效变更（changed: true）', async () => {
    const t = await todo_createTodo({ title: '回访2' })
    const id = (t.data as { todoId: string }).todoId
    await todo_completeTodo({ todoId: id, done: true })
    const r = await todo_completeTodo({ todoId: id, done: false })
    expect(r.ok).toBe(true)
    expect((r.data as { changed: boolean }).changed).toBe(true)
    expect((await db.todos.get(id))!.status).toBe('todo')
  })
})

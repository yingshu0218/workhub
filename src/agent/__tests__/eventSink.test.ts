/**
 * 事件下沉对照测试（P1 第 2 步 / §2.1 事件纪律三边界 / §9.5 两个既有 bug）
 *
 * 本步把两个领域事件的 emit 从「UI 内联」+「agentOps 内联」两条独立路径，
 * 收口到 repositories 复合函数（事务 commit 之后）这一条路径：
 *  ① create 门控：saveTransactionWithAttachments 仅新 id 才发 transaction:created（修 bug1）
 *  ② interaction 统一 emit：saveInteractionAndTouchCustomer 统一发 customer:contacted（修 bug2：项目跟进漏发）
 *  ③ 事务外硬规则：事件在事务 commit 之后发，永不进事务体
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { eventBus, type AppEvent } from '@/shared/eventBus'
import {
  saveTransactionWithAttachments,
  saveInteractionAndTouchCustomer,
  createCustomerWithInit,
  newId,
} from '@/repositories'
import { fin_recordTransaction, crm_addInteraction, emitDeclared, AGENT_TOOLS } from '../executor'
import { TOOL_EVENTS, SUNK_EVENTS, agentLayerEvents } from '../schema'
import type { Customer, Transaction } from '@/db/types'

type Captured = { event: keyof AppEvent; payload: unknown }

/** 捕获全部事件；调用方负责 restore */
function capture(): { events: Captured[]; restore: () => void } {
  const events: Captured[] = []
  const orig = eventBus.emit.bind(eventBus)
  eventBus.emit = (event: keyof AppEvent, payload: unknown) => {
    events.push({ event, payload })
    ;(orig as unknown as (e: keyof AppEvent, p: unknown) => void)(event, payload)
  }
  return { events, restore: () => { eventBus.emit = orig } }
}

async function seedLedger(id = 'l1') {
  await db.ledgers.put({
    id, name: '主账本', currency: 'CNY', openingBalance: 0, closingCycle: '月结',
    sortOrder: 0, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0,
  })
}

function newTxn(id: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id, ledgerId: 'l1', type: 'expense', amount: 120, summary: '晚饭', channel: '',
    occurredAt: Date.now(), tags: [], status: '待对账',
    createdAt: Date.now(), updatedAt: 0, deleted: 0, rev: 0, ...over,
  } as Transaction
}

function newCustomer(id: string, over: Partial<Customer> = {}): Customer {
  return {
    id, name: '王五', company: '', title: '', decisionLevel: '决策人', tier: 'A', tags: [],
    phone: '', wechat: '', email: '', address: '', lastContactAt: 0,
    createdAt: 1, updatedAt: 0, deleted: 0, rev: 0, ...over,
  } as Customer
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('边界① create 门控：仅新 id 才发 transaction:created', () => {
  it('新建流水发一次事件，且载荷与 UI 旧内联 emit 逐字段一致', async () => {
    await seedLedger()
    const cap = capture()
    const txnId = newId('txn')
    const r = await saveTransactionWithAttachments(newTxn(txnId), [])
    cap.restore()

    expect(r).toEqual({ id: txnId, created: true })
    expect(cap.events).toHaveLength(1)
    expect(cap.events[0].event).toBe('transaction:created')
    expect(cap.events[0].payload).toEqual({ transactionId: txnId, customerId: undefined })
    // 无多余字段（与 TransactionFormDrawer 旧 emit 同构）
    expect(Object.keys(cap.events[0].payload as object).sort()).toEqual(['customerId', 'transactionId'])
  })

  it('§9.5 bug1 回归：编辑既有流水不再发事件', async () => {
    await seedLedger()
    const txnId = newId('txn')
    await saveTransactionWithAttachments(newTxn(txnId), [])

    const cap = capture()
    // 编辑：同 id 再次落库（金额变更）
    const r = await saveTransactionWithAttachments(newTxn(txnId, { amount: 999 }), [])
    cap.restore()

    expect(r.created).toBe(false)
    expect(cap.events).toHaveLength(0)
    expect((await db.transactions.get(txnId))!.amount).toBe(999)
  })

  it('软删后再落库视为「新建」（墓碑重建语义），仍发事件', async () => {
    await seedLedger()
    const txnId = newId('txn')
    await saveTransactionWithAttachments(newTxn(txnId), [])
    await db.transactions.update(txnId, { deleted: 1 })

    const cap = capture()
    const r = await saveTransactionWithAttachments(newTxn(txnId), [])
    cap.restore()

    expect(r.created).toBe(true)
    expect(cap.events).toHaveLength(1)
  })

  it('agentOps 路径经同一 repositories emit：一次调用只发一次事件', async () => {
    await seedLedger()
    const cap = capture()
    const r = await fin_recordTransaction({ ledgerId: 'l1', summary: '晚饭', amount: 120 })
    cap.restore()

    expect(r.ok).toBe(true)
    expect((r.data as { eventEmitted: boolean }).eventEmitted).toBe(true)
    expect(cap.events.filter((e) => e.event === 'transaction:created')).toHaveLength(1)
  })
})

describe('边界② interaction 统一 emit：customer:contacted 单点收口', () => {
  it('saveInteractionAndTouchCustomer 统一 emit（UI 与 agentOps 同源）', async () => {
    await db.customers.put(newCustomer('c1'))
    const cap = capture()
    await saveInteractionAndTouchCustomer(
      { id: newId('itx'), customerId: 'c1', type: '拜访', content: '当面沟通', at: Date.now() },
      'c1',
    )
    cap.restore()
    expect(cap.events).toEqual([{ event: 'customer:contacted', payload: { customerId: 'c1' } }])
  })

  it('§9.5 bug2 回归：项目跟进（携 projectId）经同一函数也发 customer:contacted', async () => {
    await db.customers.put(newCustomer('c1'))
    const cap = capture()
    await saveInteractionAndTouchCustomer(
      { id: newId('itx'), customerId: 'c1', type: '电话', content: '项目跟进', at: Date.now(), projectId: 'p1' },
      'c1',
    )
    cap.restore()
    expect(cap.events.map((e) => e.event)).toEqual(['customer:contacted'])
  })

  it('客户不存在 → 事务回滚且不发事件（孤儿日志杜绝）', async () => {
    const cap = capture()
    await expect(
      saveInteractionAndTouchCustomer(
        { id: newId('itx'), customerId: 'ghost', type: '拜访', content: 'x', at: Date.now() },
        'ghost',
      ),
    ).rejects.toThrow()
    cap.restore()
    expect(cap.events).toHaveLength(0)
    expect(await db.interactions.count()).toBe(0)
  })

  it('agentOps 路径不再重复 emit（下沉后单发）', async () => {
    await db.customers.put(newCustomer('c1'))
    const cap = capture()
    const r = await crm_addInteraction({ customerId: 'c1', content: '周五回访' })
    cap.restore()
    expect(r.ok).toBe(true)
    expect(cap.events.filter((e) => e.event === 'customer:contacted')).toHaveLength(1)
  })
})

describe('边界③ 事务外硬规则：事件在事务 commit 之后发', () => {
  it('transaction:created 触发时记录已可读（commit 先于 emit）', async () => {
    await seedLedger()
    const seen: boolean[] = []
    const orig = eventBus.emit.bind(eventBus)
    eventBus.emit = (event: keyof AppEvent, payload: unknown) => {
      if (event === 'transaction:created') {
        void db.transactions
          .get((payload as { transactionId: string }).transactionId)
          .then((v) => seen.push(!!v))
      }
      ;(orig as unknown as (e: keyof AppEvent, p: unknown) => void)(event, payload)
    }
    await saveTransactionWithAttachments(newTxn(newId('txn')), [])
    eventBus.emit = orig
    await new Promise((res) => setTimeout(res, 10))
    expect(seen).toEqual([true])
  })

  it('customer:contacted 触发时 lastContactAt 已更新（commit 先于 emit）', async () => {
    await db.customers.put(newCustomer('c1'))
    const seen: (number | undefined)[] = []
    const orig = eventBus.emit.bind(eventBus)
    eventBus.emit = (event: keyof AppEvent, payload: unknown) => {
      if (event === 'customer:contacted') {
        void db.customers.get((payload as { customerId: string }).customerId).then((c) => seen.push(c?.lastContactAt))
      }
      ;(orig as unknown as (e: keyof AppEvent, p: unknown) => void)(event, payload)
    }
    const at = Date.now()
    await saveInteractionAndTouchCustomer(
      { id: newId('itx'), customerId: 'c1', type: '拜访', content: 'x', at },
      'c1',
    )
    eventBus.emit = orig
    await new Promise((res) => setTimeout(res, 10))
    expect(seen).toEqual([at])
  })
})

describe('下沉后防漂移：agentOps 不得重复 emit 已下沉事件', () => {
  it('SUNK_EVENTS 覆盖 P1 全部三个领域事件，且 agent 层事件列表为空', () => {
    // 第 2 步下沉 transaction:created / customer:contacted；第 5 步随 checkinHabit 下沉 habit:checked
    expect([...SUNK_EVENTS].sort()).toEqual([
      'customer:contacted',
      'habit:checked',
      'transaction:created',
    ])
    for (const name of Object.keys(AGENT_TOOLS)) {
      expect(agentLayerEvents(name)).toEqual([])
    }
  })

  it('emitDeclared 对已下沉事件直接抛错（防双发）', () => {
    expect(() =>
      emitDeclared('fin_recordTransaction', { 'transaction:created': { transactionId: 't' } }),
    ).toThrow(/已下沉/)
    expect(() =>
      emitDeclared('crm_addInteraction', { 'customer:contacted': { customerId: 'c' } }),
    ).toThrow(/已下沉/)
  })

  it('声明表仍声明三个事件（唯一事实源不因下沉而删条目）', () => {
    expect(TOOL_EVENTS['fin_recordTransaction']).toEqual(['transaction:created'])
    expect(TOOL_EVENTS['crm_addInteraction']).toEqual(['customer:contacted'])
    expect(TOOL_EVENTS['habit_checkin']).toEqual(['habit:checked'])
  })
})

describe('createCustomerWithInit 下沉 repositories 且不新增事件', () => {
  it('建档 + openingLog 落库成功但不发事件（保持原行为，TOOL_EVENTS 无该条目）', async () => {
    const cap = capture()
    await createCustomerWithInit(newCustomer('c9'), { openingLog: true })
    cap.restore()
    expect(cap.events).toHaveLength(0)
    expect(await db.customers.get('c9')).toBeTruthy()
    expect(await db.interactions.count()).toBe(1)
  })

  it('linkTransactionId 只改挂靠，不触发 transaction:created', async () => {
    await seedLedger()
    const txnId = newId('txn')
    await saveTransactionWithAttachments(newTxn(txnId), [])
    const cap = capture()
    await createCustomerWithInit(newCustomer('c8'), { linkTransactionId: txnId })
    cap.restore()
    expect(cap.events).toHaveLength(0)
    // Issue #140：关联改为数组（linkTransactionId 追加进 customerIds）
    expect((await db.transactions.get(txnId))!.customerIds).toEqual(['c8'])
  })
})

// 避免未使用告警
void vi

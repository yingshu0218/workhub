import { beforeAll, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { dispatchAgentTool } from '../executor'
import {
  SERVER_READ_TOOLS,
  dispatchServerReadTool,
  handlesServerTool,
  serverToolsList,
} from '../serverReads'
import { READ_TOOLS } from '../reads'

/**
 * 服务端读执行器一致性（agentOps 服务端化 P2）
 *
 * 锁三件事：
 * 1. **路由边界**：10 个读工具全在服务端、写工具全不在（relay 路由据此分流）；
 * 2. **两端一致**：同库同参下，服务端 dispatch 与浏览器桥 dispatch 的读结果**逐字段一致**
 *    （reads.ts 是同一份实现，若未来有人给某一端单独改口径，这里立即转红）；
 * 3. **清单对齐**：serverToolsList 与浏览器 AGENT_TOOLS 的读工具子集同名同域，
 *    且 schema 可解析（tools/list 下发形状不破）。
 */

describe('serverReads：服务端读执行器', () => {
  beforeAll(async () => {
    // 种子数据（与读工具既有测试同口径）
    await db.customers.put({
      id: 'ws-main:cus:s1',
      name: '沈一',
      company: '一致公司',
      tags: ['tag-a'],
      decisionLevel: 'A',
      lastContactAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as never)
    await db.ledgers.put({
      id: 'ws-main:ldg:s1',
      name: '主账本',
      currency: 'CNY',
      openingBalance: 0,
      closingCycle: '月结',
      isDefault: true,
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as never)
    await db.todos.put({
      id: 'ws-main:td:s1',
      title: '一致性用例待办',
      priority: 'high',
      status: 'todo',
      createdAt: Date.now(),
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    } as never)
  })

  it('路由边界：读工具全在服务端、写工具全不在', () => {
    const readNames = Object.keys(READ_TOOLS)
    expect(readNames.length).toBeGreaterThanOrEqual(10)
    for (const name of readNames) expect(handlesServerTool(name), name).toBe(true)
    for (const write of ['crm_createCustomer', 'fin_recordTransaction', 'todo_deleteTodo', 'habit_checkin']) {
      expect(handlesServerTool(write), write).toBe(false)
    }
  })

  it('两端一致：listTodos / listLedgers / getCustomer 同库同参结果逐字段一致', async () => {
    for (const [name, input] of [
      ['listTodos', { status: 'todo' }],
      ['listLedgers', {}],
      ['getCustomer', { id: 'ws-main:cus:s1' }],
    ] as const) {
      const browser = await dispatchAgentTool(name, input)
      const server = await dispatchServerReadTool(name, input)
      expect(server.ok, `${name} server ok`).toBe(true)
      expect(browser.ok, `${name} browser ok`).toBe(true)
      expect(server.data).toEqual(browser.data)
    }
  })

  it('清单对齐：serverToolsList 与浏览器读工具子集同名同域，schema 含 inputSchema', () => {
    const list = serverToolsList()
    expect(list).toHaveLength(Object.keys(SERVER_READ_TOOLS).length)
    const domains = new Set(list.map((t) => t.domain))
    expect(domains.has('read')).toBe(true)
    for (const t of list) {
      expect(t.inputSchema).toBeTruthy()
      expect(typeof t.risk).toBe('string')
    }
    // 风险级与浏览器端声明表同源（low；读工具不产事件）
    for (const t of list) expect(t.risk).toBe('low')
  })

  it('未知工具 / 写工具经服务端 dispatch 返回可操作错误（不抛出）', async () => {
    expect((await dispatchServerReadTool('crm_createCustomer', {})).ok).toBe(false)
    expect((await dispatchServerReadTool('nonexistent', {})).error).toMatch(/未知工具/)
  })

  it('schema 校验失败返回可操作错误（与浏览器桥同构信封）', async () => {
    const r = await dispatchServerReadTool('getCustomer', {})
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('信封包装：list 的 truncated / count 语义与浏览器端一致', async () => {
    const many = Array.from({ length: 3 }, (_, i) => ({
      id: `ws-main:td:m${i}`,
      title: `批量${i}`,
      priority: 'low',
      status: 'todo',
      createdAt: Date.now() + i,
      updatedAt: 0,
      deleted: 0,
      rev: 0,
    }))
    for (const t of many) await db.todos.put(t as never)
    const browser = await dispatchAgentTool('listTodos', { status: 'todo' })
    const server = await dispatchServerReadTool('listTodos', { status: 'todo' })
    expect(server.data).toEqual(browser.data)
    for (const t of many) await db.todos.delete(t.id)
  })
})

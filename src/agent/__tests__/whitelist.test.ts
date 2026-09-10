/**
 * 能力白名单对照测试（方案 §四.3 / §十.4 通用性验收）
 *
 * 白名单语义：关闭的域，工具对桥**不可见**（tools 清单里不出现），且调用被拒，不区分来源。
 */
import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { visibleToolNames, listVisibleTools, isToolAllowed, dispatchAgentTool } from '../executor'
import { TOOL_DOMAIN, DEFAULT_AI_DOMAINS } from '../schema'
import { db } from '@/db/db'

describe('能力白名单', () => {
  it('缺省（未配置）时按 DEFAULT_AI_DOMAINS 全开', () => {
    const names = visibleToolNames()
    expect(names).toContain('fin_recordTransaction')
    expect(names).toContain('crm_createCustomer')
    expect(names).toContain('resolveEntity')
    // 注册表每个工具都必须有域归属（否则白名单会静默漏筛）
    for (const n of Object.keys(TOOL_DOMAIN)) expect(names).toContain(n)
  })

  it('关闭 fin 域后 fin_* 工具不出现在 tools 清单', () => {
    const names = visibleToolNames({ fin: false })
    expect(names).not.toContain('fin_recordTransaction')
    expect(names).not.toContain('fin_createLedger')
    // 其他域不受影响
    expect(names).toContain('crm_createCustomer')
  })

  it('白名单外工具即使直接点名也无法执行（闸门在分发层，不含来源判断）', async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    const r = await dispatchAgentTool('fin_recordTransaction', { ledgerId: 'x', summary: 's', amount: 1 }, { fin: false })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不在能力白名单内')
    // 未落库
    expect(await db.transactions.count()).toBe(0)
  })

  it('listVisibleTools 附带风险级与域，供 skill/MCP schema 同源生成', () => {
    const tools = listVisibleTools({ crm: false })
    expect(tools.every((t) => t.domain !== 'crm')).toBe(true)
    expect(tools.find((t) => t.name === 'resolveEntity')?.risk).toBe('low')
    expect(tools.find((t) => t.name === 'todo_createTodo')?.risk).toBe('low')
  })

  it('isToolAllowed 与 visibleToolNames 口径一致', () => {
    expect(isToolAllowed('todo_createTodo', { todo: false })).toBe(false)
    expect(isToolAllowed('todo_createTodo', { todo: true })).toBe(true)
    expect(isToolAllowed('todo_createTodo', {})).toBe(DEFAULT_AI_DOMAINS.todo)
  })
})

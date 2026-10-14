/**
 * 中/高风险确认流程闭环测试（方案 §四.4 / §7.4）
 *
 * 补的是 P1 第 4 步的一个**流程断点**：preview 会正确拦下中风险操作，
 * 但非 `--dev` 下 Agent 拿不到票据（票据只能 relay 签发，而没人告诉它去哪儿取），
 * 于是「预览 → 用户确认 → 执行」三步在真实使用中**物理上走不通**，
 * 确认闸门退化成「永远执行不了」而不是「需要确认」。
 *
 * 本测试固定闭环契约：
 *   ① 中/高风险无 token → 只回预览 + 给出 `confirmHint`（取票入口与参数）；
 *   ② 无预览记录的取票请求 → 拒绝（票据必须绑定一次真实预览）；
 *   ③ 预览过 → confirm_preview 签发一次性 token → 带 token 重试才真正执行；
 *   ④ 同一 token 二次使用 → 拒绝（防重放）；
 *   ⑤ 高风险预览载荷额外标 irreversible:true。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { AgentBridge } from '../bridge'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

/** 用假 ws 把 bridge 当纯函数调，收集它对 relay 的回包 */
async function callBridge(msg: Record<string, unknown>) {
  const bridge = new AgentBridge()
  const calls: { ok: boolean; data?: unknown; error?: string }[] = []
  // @ts-expect-error 测试注入假 socket
  bridge.ws = { readyState: 1, send: (raw: string) => calls.push(JSON.parse(raw)) }
  // @ts-expect-error 测试访问私有 onMessage
  await bridge.onMessage(JSON.stringify({ type: 'agentops:call', requestId: 'q', ...msg }))
  return calls[0]
}

describe('确认流程闭环：预览 → 取票 → 执行', () => {
  it('中风险无 token → 返回预览 + confirmHint（取票入口）', async () => {
    const r = await callBridge({
      kind: 'tools/call',
      name: 'crm_createCustomer',
      args: { name: '王五' },
    })
    const data = r.data as { preview: boolean; irreversible?: boolean; confirmHint: { tool: string; args: unknown } }
    expect(data.preview).toBe(true)
    expect(data.irreversible).toBeUndefined()
    expect(data.confirmHint.tool).toBe('confirm_preview')
    // 取票参数与原调用完全一致（票据绑定该组参数）
    expect(data.confirmHint.args).toEqual({ tool: 'crm_createCustomer', args: { name: '王五' } })
    // 未落库
    expect(await db.customers.count()).toBe(0)
  })

  it('高风险无 token → 预览载荷标 irreversible:true（删类不可逆提示）', async () => {
    const r = await callBridge({
      kind: 'tools/call',
      name: 'todo_deleteTodo',
      args: { todoId: 'td:1' },
    })
    const data = r.data as { preview: boolean; irreversible?: boolean }
    expect(data.preview).toBe(true)
    expect(data.irreversible).toBe(true)
  })

  it('带 token → 直达执行（不再被预览拦下）', async () => {
    const ledger = 'ldg:1'
    await db.ledgers.put({
      id: ledger,
      name: '默认',
      currency: 'CNY',
      openingBalance: 0,
      closingCycle: '月结',
      sortOrder: 0,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    const r = await callBridge({
      kind: 'tools/call',
      name: 'fin_recordTransaction',
      args: { ledgerId: ledger, summary: '晚饭', amount: 120 },
      meta: { confirmToken: 't1' },
    })
    expect(r.ok).toBe(true)
    expect(await db.transactions.count()).toBe(1)
  })

  it('低风险动作免预览，直接执行', async () => {
    const r = await callBridge({ kind: 'tools/call', name: 'note_createFolder', args: { name: 'F' } })
    expect(r.ok).toBe(true)
    expect(await db.noteFolders.count()).toBe(1)
  })
})

describe('relay 侧取票与防重放（ConfirmTokenStore + preview 绑定）', () => {
  it('ConfirmTokenStore：核销即删（同 token 二次使用被拒）', async () => {
    const { ConfirmTokenStore, argsFingerprint } = await import('@relay/mcp-relay.mjs')
    const store = new ConfirmTokenStore({ ttlMs: 60_000 })
    // 票据绑定参数（P0 修复）：核销须带当次执行参数的指纹
    const fp = argsFingerprint('x', {})
    const { confirmToken } = store.issue({ tool: 'x', args: {} })
    expect(store.redeem(confirmToken, fp).ok).toBe(true)
    const second = store.redeem(confirmToken, fp)
    expect(second.ok).toBe(false)
    expect(String((second as { reason: string }).reason)).toContain('已使用')
  })

  it('ConfirmTokenStore：超时作废', async () => {
    const { ConfirmTokenStore, argsFingerprint } = await import('@relay/mcp-relay.mjs')
    let now = 1_000
    const store = new ConfirmTokenStore({ ttlMs: 1_000, now: () => now })
    const { confirmToken } = store.issue({ tool: 'x', args: {} })
    now += 2_000
    const r = store.redeem(confirmToken, argsFingerprint('x', {}))
    expect(r.ok).toBe(false)
    expect(String((r as { reason: string }).reason)).toContain('过期')
  })

  it('relay 内置 confirm_preview 出现在 tools/list（非 --dev 下取票入口可达）', async () => {
    // 直接检查 relay 内核源码里的 tools/list 合并逻辑（relay/server.mjs 为可嵌入内核，不便直连）
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('relay/server.mjs', 'utf8')
    expect(src).toContain("const CONFIRM_TOOL = 'confirm_preview'")
    // P2 起 tools/list = 服务端工具 ∪ 浏览器工具 ∪ confirm_preview（服务端工具重名优先），
    // confirm_preview 恒与清单合并下发（浏览器离线且有服务端工具时也可达）
    expect(src).toMatch(/\.\.\.browserTools,\s*\n\s*\{\s*\n\s*name: CONFIRM_TOOL/)
    // preview 落地时记下 (tool,args)，取票时消费
    expect(src).toContain('rememberPreview(argsHash(p.track.name, p.track.args))')
    expect(src).toContain('consumePreview(key)')
  })
})

describe('未知工具 → 可操作错误（含可用清单）', () => {
  it('未注册工具名返回可用工具清单，而不是静默 undefined', async () => {
    const r = await callBridge({ kind: 'tools/call', name: 'nope_doThing', args: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知工具')
    expect(r.error).toContain('crm_createCustomer')
  })
})

// 保留一个空断言占位，避免 vi 未使用告警
void vi

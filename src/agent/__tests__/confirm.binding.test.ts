/**
 * P0 回归：confirmToken 必须**绑定参数**（票据只能执行用户确认过的那组参数）
 *
 * 背景（审计发现的越权路径）：
 *   旧实现里 confirmToken 只记录「签发过」，核销时不校验参数。
 *   于是「预览 记100元 → 取票 → 不重新预览，直接以 记10000元 执行」可以成功 ——
 *   确认闸门被架空，而既有测试恰好只覆盖「正向走通」与「同票重放」，缺这条负向用例。
 *
 * 本测试起**不带 --dev** 的真实 relay 子进程，覆盖四条负向断言：
 *   ① 预览 A 参数取票 → 以 B 参数执行 → **拒绝**，且 B 未落库；
 *   ② 票据绑定 A 参数 → 以 A 参数执行 → 通过（确认修复没有把正常路径改死）；
 *   ③ 参数键序不同但语义相同 → 视为同一组参数（规范化生效，不误伤）；
 *   ④ 无票据执行中风险工具 → 仍只回预览，不落库。
 *
 * 反向验证：把 mcp-relay.mjs 的 `redeem(token, argsFingerprint(...))` 改回单参调用，
 * ① 会立刻失败 —— 证明这条闸不是摆设。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { agentBridge } from '../bridge'
import { settingsRepo } from '@/repositories'
import { DEFAULT_SETTINGS } from '@/db/types'
import { startRelay, connectBridge, installWebSocketGlobal, McpClient, type RelayProcess } from './e2e.harness'

let relay: RelayProcess
let bridgeUrl = ''

beforeAll(async () => {
  installWebSocketGlobal()
  relay = await startRelay({ dev: false })
  await relay.ready
  bridgeUrl = 'ws://127.0.0.1:' + relay.port
  await settingsRepo.save({
    ai: { ...DEFAULT_SETTINGS.ai, bridgeEnabled: true, bridgeToken: relay.token, bridgeUrl },
  })
  await connectBridge(relay, agentBridge)
})

afterAll(async () => {
  agentBridge.disconnect()
  await relay?.stop()
})

describe('confirmToken 参数绑定', () => {
  it('① 预览 A 取票 → 以 B 参数执行：拒绝，B 不落库（越权路径已封堵）', async () => {
    const mcp = await McpClient.open(bridgeUrl)
    await mcp.initialize(relay.token)

    const previewArgs = { name: '绑定测试·甲' }
    const pv = await mcp.callTool('crm_createCustomer', previewArgs)
    expect((pv.data as { preview?: boolean }).preview).toBe(true)

    const ticket = await mcp.callTool('confirm_preview', {
      tool: 'crm_createCustomer',
      args: previewArgs,
    })
    expect(ticket.ok, ticket.text).toBe(true)
    const confirmToken = (ticket.data as { confirmToken: string }).confirmToken
    expect(confirmToken).toBeTruthy()

    // 越权：同一张票、换一组参数
    const evil = await mcp.callTool('crm_createCustomer', { name: '绑定测试·乙' }, confirmToken)
    expect(evil.ok, `越权必须被拒，实际：${evil.text}`).toBe(false)
    expect(evil.text).toContain('不匹配')

    // 关键业务断言：越权参数**一个字都不能落库**
    const names = (await db.customers.toArray()).map((c) => c.name)
    expect(names).not.toContain('绑定测试·乙')
    expect(names).not.toContain('绑定测试·甲')
  }, 30_000)

  it('② 票据绑定 A → 以 A 执行：正常通过（未误伤主路径）', async () => {
    const mcp = await McpClient.open(bridgeUrl)
    await mcp.initialize(relay.token)

    const args = { name: '绑定测试·丙' }
    const pv = await mcp.callTool('crm_createCustomer', args)
    expect((pv.data as { preview?: boolean }).preview).toBe(true)

    const ticket = await mcp.callTool('confirm_preview', { tool: 'crm_createCustomer', args })
    const confirmToken = (ticket.data as { confirmToken: string }).confirmToken

    const done = await mcp.callTool('crm_createCustomer', args, confirmToken)
    expect(done.ok, done.text).toBe(true)
    const id = (done.data as { customerId: string }).customerId
    expect(await db.customers.get(id)).toBeTruthy()
  }, 30_000)

  it('③ 语义相同但键序不同的参数：视为同一组（规范化生效）', async () => {
    const mcp = await McpClient.open(bridgeUrl)
    await mcp.initialize(relay.token)

    // 预览用 {a,b} 顺序，执行用 {b,a} 顺序 —— 指纹须一致
    const previewArgs = { name: '绑定测试·丁', company: '键序科技' }
    const pv = await mcp.callTool('crm_createCustomer', previewArgs)
    expect((pv.data as { preview?: boolean }).preview).toBe(true)

    const ticket = await mcp.callTool('confirm_preview', {
      tool: 'crm_createCustomer',
      args: previewArgs,
    })
    const confirmToken = (ticket.data as { confirmToken: string }).confirmToken

    const reordered = { company: '键序科技', name: '绑定测试·丁' }
    const done = await mcp.callTool('crm_createCustomer', reordered, confirmToken)
    expect(done.ok, `键序不同不应被误判为不同参数：${done.text}`).toBe(true)
  }, 30_000)

  it('④ 无票据执行中风险工具：只回预览、不落库', async () => {
    const mcp = await McpClient.open(bridgeUrl)
    await mcp.initialize(relay.token)
    const before = await db.customers.count()
    const r = await mcp.callTool('crm_createCustomer', { name: '绑定测试·戊' })
    expect((r.data as { preview?: boolean }).preview).toBe(true)
    expect(await db.customers.count()).toBe(before)
  }, 30_000)
})

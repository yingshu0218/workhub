/**
 * 非 --dev 模式下「预览 → 取票 → 执行」闭环端到端验收
 *
 * 这是 P1 第 4 步留下的**流程断点**的回归闸：
 * `--dev` 里 relay 会把「预览」和「签发票据」并成一步（纯为本地自动化方便），
 * 于是测试全绿，但真实使用（不带 `--dev`）时 Agent 拿不到票据，
 * 「预览 → 用户确认 → 执行」走不通 —— 确认闸门退化成「永远执行不了」。
 *
 * 本测试起**不带 --dev** 的真实 relay 子进程，走新增的 `confirm_preview` 取票入口：
 *   ① 无票据调中风险工具 → 回预览 + confirmHint，不落库；
 *   ② 直接拿「没预览过」的参数取票 → 拒绝（票据必须绑定一次真实预览）；
 *   ③ 先预览再取票 → 签发一次性 token；
 *   ④ 带 token 执行 → 真正落库；
 *   ⑤ 同一 token 二次使用 → 拒绝（防重放）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { agentBridge } from '../bridge'
import { settingsRepo } from '@/repositories/localAdmin'
import { DEFAULT_SETTINGS } from '@/db/types'
import { startRelay, connectBridge, installWebSocketGlobal, McpClient, type RelayProcess } from './e2e.harness'

let relay: RelayProcess
let bridgeUrl = ''

beforeAll(async () => {
  installWebSocketGlobal()
  // 关键：**不带 --dev** —— 验证真实使用形态下取票入口可达
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

describe('非 --dev：确认流程必须真能走通', () => {
  it('confirm_preview 出现在 tools/list（取票入口对 Agent 可见）', async () => {
    const mcp = await McpClient.open(bridgeUrl)
    await mcp.initialize(relay.token)
    const res = await mcp.listTools()
    const names = res.map((t: { name: string }) => t.name)
    expect(names).toContain('confirm_preview')
  }, 20_000)

  it('无票据 → 预览 + confirmHint；未落库', async () => {
    const mcp = await McpClient.open(bridgeUrl)
    await mcp.initialize(relay.token)
    const r = await mcp.callTool('note_createFolder', { name: '非 dev 目录' })
    // 低风险免预览，直接执行 —— 用中风险工具验预览
    expect(r.ok).toBe(true)

    const mid = await mcp.callTool('crm_createCustomer', { name: '钱七' })
    expect(mid.ok).toBe(true)
    expect((mid.data as { preview?: boolean }).preview).toBe(true)
    const hint = (mid.data as { confirmHint: { tool: string } }).confirmHint
    expect(hint.tool).toBe('confirm_preview')
    expect(await db.customers.count()).toBe(0)
  }, 20_000)

  it('未预览过的参数取票 → 拒绝（票据绑定一次真实预览）', async () => {
    const mcp = await McpClient.open(bridgeUrl)
    await mcp.initialize(relay.token)
    const r = await mcp.callTool('confirm_preview', {
      tool: 'crm_createCustomer',
      args: { name: '从未预览过的人' },
    })
    expect(r.ok).toBe(false)
    expect(r.text).toContain('未找到')
  }, 20_000)

  it('预览 → 取票 → 执行 → 同票重放被拒（全链路）', async () => {
    const mcp = await McpClient.open(bridgeUrl)
    await mcp.initialize(relay.token)
    const args = { name: '孙八' }

    // ① 预览
    const preview = await mcp.callTool('crm_createCustomer', args)
    expect((preview.data as { preview?: boolean }).preview).toBe(true)

    // ② 取票
    const ticket = await mcp.callTool('confirm_preview', {
      tool: 'crm_createCustomer',
      args,
    })
    expect(ticket.ok, ticket.text).toBe(true)
    const confirmToken = (ticket.data as { confirmToken: string }).confirmToken
    expect(confirmToken).toBeTruthy()

    // ③ 带票执行
    const done = await mcp.callTool('crm_createCustomer', args, confirmToken)
    expect(done.ok, done.text).toBe(true)
    const customerId = (done.data as { customerId: string }).customerId
    expect(await db.customers.get(customerId)).toBeTruthy()

    // ④ 同票重放 → 拒绝（一次性）
    const replay = await mcp.callTool('crm_createCustomer', args, confirmToken)
    expect(replay.ok).toBe(false)
    expect(replay.text).toContain('confirmToken')
  }, 30_000)
})

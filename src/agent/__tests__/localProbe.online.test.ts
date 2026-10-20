/**
 * 一次性探针（用完即删）：通过 AI Agent 桥读取浏览器本地库的客户，为补关系做准备。
 * 与 demoSeed.online.test.ts 同一套路：借用 vitest 的 TS 运行时 + e2e.harness 的 MCP 客户端。
 */
import { describe, it, beforeAll } from 'vitest'
import { installWebSocketGlobal, McpClient } from './e2e.harness'
import { makeInvoker } from './sweep.cases'

const ONLINE_URL = process.env.WORKHUB_ONLINE_URL ?? ''
const ONLINE_TOKEN = process.env.WORKHUB_ONLINE_TOKEN ?? ''
const ONLINE = Boolean(ONLINE_URL && ONLINE_TOKEN)

describe.skipIf(!ONLINE)('本地库探针', () => {
  let mcp: McpClient
  beforeAll(async () => {
    installWebSocketGlobal()
    mcp = await McpClient.open(ONLINE_URL)
    const init = await mcp.initialize(ONLINE_TOKEN)
    console.log('握手:', JSON.stringify(init))
  }, 60_000)

  it('工具清单 + 客户读数', async () => {
    const call = makeInvoker(mcp)
    try {
      const tools = await mcp.listTools()
      console.log('tools/list →', tools.length, '个工具')
      for (const t of tools) {
        if (['searchEntities', 'getCustomer', 'crm_addRelation'].includes(t.name)) {
          console.log(`  【${t.name}】`)
          console.log('    schema:', JSON.stringify(t.inputSchema))
        }
      }
    } catch (e) {
      console.log('tools/list 失败 →', (e as Error).message)
      return
    }
    const attempts: Record<string, unknown>[] = [
      { type: 'customer' },
      { query: '', type: 'customer' },
      { keyword: '', type: 'customer' },
      {},
    ]
    for (const args of attempts) {
      try {
        const r = await call('searchEntities', args)
        console.log(`searchEntities(${JSON.stringify(args)}) → ok=${r.ok} phase=${r.phase}`)
        console.log('   ', r.text.slice(0, 1500))
        if (r.ok) break
      } catch (e) {
        console.log(`searchEntities(${JSON.stringify(args)}) 抛错 →`, (e as Error).message)
      }
    }
  }, 90_000)
})

import { PERSONAL_TOOL_MAP } from '../personalTools'
/**
 * 本地功能性遍历探针（审计用，非回归门禁）
 *
 * 链路：标准 MCP 客户端 → **真实 relay 子进程（非 --dev）** → 页面同款 AgentBridge
 *       → agentOps → repositories → fake-indexeddb
 *
 * 用例与断言**全部来自 `./sweep.cases`**，与线上探针（`functional.sweep.online.test.ts`）同源 ——
 * 避免「线上再测一遍」退化成第二套实现。
 *
 * relay 特意不带 `--dev`：中/高风险工具必须由 Agent 自己走「预览 → confirm_preview 取票 → 执行」，
 * 不允许靠 dev 自动附票抄近路，这是真实外部 Agent 的处境。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { settingsRepo } from '@/repositories/localAdmin'
import { DEFAULT_SETTINGS } from '@/db/types'
import { agentBridge } from '../bridge'
import { installWebSocketGlobal, startRelay, connectBridge, McpClient, type RelayProcess } from './e2e.harness'
import { runToolSweep, formatSweepReport, failuresOf, type SweepResult } from './sweep.cases'

let relay: RelayProcess
let mcp: McpClient
let result: SweepResult

beforeAll(async () => {
  installWebSocketGlobal()
  relay = await startRelay({})
  await relay.ready
  const bridgeUrl = `ws://127.0.0.1:${relay.port}`
  await settingsRepo.save({
    ai: { ...DEFAULT_SETTINGS.ai, bridgeEnabled: true, bridgeToken: relay.token, bridgeUrl },
  })
  await connectBridge(relay, agentBridge)
  mcp = await McpClient.open(bridgeUrl)
  await mcp.initialize(relay.token)

  // 习惯域没有「创建习惯」工具（观察项），本地按 UI 同等口径直接落库
  await db.habits.put({
    id: 'habit-sweep',
    name: '晨跑',
    icon: 'directions_run',
    color: '#111111',
    category: '健康',
    schedule: '每日',
    targetMinutes: 0,
    motivationNote: '',
    crossModuleSync: false,
    createdAt: Date.now(),
    updatedAt: 0,
    deleted: 0,
    rev: 0,
  } as never)

  result = await runToolSweep(mcp, {
    records: {
      todo: (id) => db.todos.get(id),
      habit: (id) => db.habits.get(id),
    },
    // 限幅用例需要 60 条流水：本地可直接造库
    bulkSeedTransactions: async (ledgerId, n) => {
      await db.transactions.bulkPut(
        Array.from({ length: n }, (_, i) => ({
          id: `txn-bulk-${i}`,
          ledgerId,
          type: 'expense',
          amount: 1,
          status: '待对账',
          occurredAt: Date.now(),
          summary: `批量 ${i}`,
          tags: [],
          createdAt: Date.now(),
          updatedAt: 0,
          deleted: 0,
          rev: 1,
        })) as never,
      )
    },
  })

  console.log(formatSweepReport(result, '本地遍历（真实 relay 非 --dev + fake-indexeddb）'))
}, 180_000)

afterAll(async () => {
  mcp?.close()
  agentBridge.disconnect()
  await relay?.stop()
})

describe('本地功能性遍历（全部工具）', () => {
  it('① 正向遍历：每个工具都可调通', () => {
    const fails = result.rows.filter((r) => !r.ok)
    expect(fails.map((f) => `${f.tool}: ${f.detail}`)).toEqual([])
  })

  it('② 边界与异常：全部符合预期', () => {
    const fails = result.edges.filter((e) => !e.ok)
    expect(fails.map((f) => `${f.label}: ${f.detail}`)).toEqual([])
  })

  it('③ 运行期 tools/list 与静态快照一致', () => {
    expect(result.schemaDiffs).toEqual([])
  })

  it('④ 旧CRUD覆盖度（新服务端工具由真实PB/MCP集成逐项覆盖）', () => {
    // 以运行期 tools/list 为基准逐项比对，**不写死数字** ——
    // 此前是 `expect(covered.size).toBeGreaterThanOrEqual(27)`，补 7 个工具后它只能靠改数字维持，
    // 且「数字对得上但漏跑某个工具」这种情况它抓不到（多跑一个别的工具就能凑够）。
    const covered = new Set(result.rows.map((r) => r.tool))
    const missing = result.toolNames.filter((n) => !PERSONAL_TOOL_MAP.has(n) && !covered.has(n))
    expect(missing).toEqual([])
    expect(failuresOf(result)).toEqual([])
  })
})

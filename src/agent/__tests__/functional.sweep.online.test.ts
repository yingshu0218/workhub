/**
 * 线上功能性遍历探针
 *
 * 用同一份用例库（`./sweep.cases`）跑**线上环境**：
 *   Agent（本机）→ ws://8.153.19.221:9001/relay（nginx 反代 → serve.mjs）→ 线上浏览器内的桥 → agentOps
 *
 * 前置（人工一次）：
 *   在**线上站点**打开「设置 → AI Agent 桥」→ 启用 → relay 地址**留空** → token 填与 relay 一致的值
 *
 * 运行（两个环境变量都必须给，否则本文件自动 skip，不污染默认 CI）：
 *   WORKHUB_ONLINE_URL=ws://8.153.19.221:9001/relay \
 *   WORKHUB_ONLINE_TOKEN=<relay token> \
 *   npx vitest run src/agent/__tests__/functional.sweep.online.test.ts
 *
 * 数据隔离：请在**无痕窗口 / 独立 profile**里打开线上站点，且**不配置云端同步** ——
 *   遍历会创建客户/流水/待办等记录，不配同步则只落在该临时 profile 的本地 IndexedDB，关闭即丢弃。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { installWebSocketGlobal, McpClient } from './e2e.harness'
import { runToolSweep, formatSweepReport, type SweepResult } from './sweep.cases'

const ONLINE_URL = process.env.WORKHUB_ONLINE_URL ?? ''
const ONLINE_TOKEN = process.env.WORKHUB_ONLINE_TOKEN ?? ''
const enabled = Boolean(ONLINE_URL && ONLINE_TOKEN)

let mcp: McpClient
let result: SweepResult

describe.skipIf(!enabled)('线上功能性遍历（nginx 反代 + 线上浏览器桥）', () => {
  beforeAll(async () => {
    installWebSocketGlobal()
    mcp = await McpClient.open(ONLINE_URL)
    await mcp.initialize(ONLINE_TOKEN)

    // 桥未启用时 tools/list 会抛「应用未连接」——提前转成可操作提示，而不是让人对着异常猜
    try {
      await mcp.listTools()
    } catch (e) {
      throw new Error(
        `线上桥未就绪：${(e as Error).message}\n` +
          '请先在浏览器打开线上站点 → 设置 → AI Agent 桥 → 启用（relay 地址留空，token 与 relay 一致）',
      )
    }

    // 线上不注入 records / bulkSeed：断言自动降级为「读工具回读」口径
    result = await runToolSweep(mcp)
    console.log(formatSweepReport(result, `线上遍历（${ONLINE_URL}）`))
  }, 300_000)

  afterAll(() => mcp?.close())

  it('① 正向遍历：27 个工具在线上环境全部可调通', () => {
    const fails = result.rows.filter((r) => !r.ok)
    expect(fails.map((f) => `${f.tool}: ${f.detail}`)).toEqual([])
  })

  it('② 边界与异常：全部符合预期', () => {
    const fails = result.edges.filter((e) => !e.ok)
    expect(fails.map((f) => `${f.label}: ${f.detail}`)).toEqual([])
  })

  it('③ 线上 tools/list 的 schema 与静态快照一致（探针 P1-2 是否真的修好）', () => {
    expect(result.schemaDiffs).toEqual([])
  })
})

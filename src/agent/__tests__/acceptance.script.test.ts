/**
 * §10.4 通用性验收脚本 · 桥在线回归（Issue #33 收尾项 2）
 *
 * 用真实 relay 子进程 + 页面同款 AgentBridge 连出（fake-indexeddb 内存库），
 * 然后以**子进程**方式跑 scripts/acceptance.mjs —— 即「一个从未适配本项目的
 * 纯标准 MCP Agent」视角做协议级验收，桥在线时 ①~⑤ 全条款可过。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'fake-indexeddb/auto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
import { agentBridge } from '../bridge'
import { settingsRepo } from '@/repositories'
import { DEFAULT_SETTINGS } from '@/db/types'
import { installWebSocketGlobal, startRelay, connectBridge, type RelayProcess } from './e2e.harness'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('§10.4 通用性验收脚本（scripts/acceptance.mjs）· 桥在线', () => {
  let relay: RelayProcess
  beforeAll(async () => {
    installWebSocketGlobal()
    relay = await startRelay({ dev: true })
    await relay.ready
    const url = `ws://127.0.0.1:${relay.port}`
    // 等价于「打开应用 + 设置页启用 AI 桥」（settings ai 段是桥的唯一开关，与主 E2E 同口径）
    await settingsRepo.save({
      ai: { ...DEFAULT_SETTINGS.ai, bridgeEnabled: true, bridgeToken: relay.token, bridgeUrl: url },
    })
    await connectBridge(relay, agentBridge)
  }, 20_000)
  afterAll(async () => {
    await relay?.stop()
  })

  it('全部条款通过（含 tools/list schema 完整性与 confirm_preview 在清单中）', async () => {
    // 必须异步跑脚本：execFileSync 会冻结本进程事件循环，页面桥（同进程）无法应答
    // tools/list → relay 15s 超时 → 脚本先超时误报「桥离线」。
    let out: string
    try {
      const r = await execFileAsync(
        process.execPath,
        [path.join(REPO_ROOT, 'scripts/acceptance.mjs'), '--url', `ws://127.0.0.1:${relay.port}`, '--token', relay.token],
        { encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
      )
      out = r.stdout
    } catch (e) {
      const err = e as { stdout?: string; message?: string }
      throw new Error(`验收脚本失败：\n${err.stdout ?? ''}\n${err.message}`)
    }
    // 桥在线：③④ 组必须真实跑过而不是被跳过
    expect(out).toContain('③-1 tools/list 返回数组且非空')
    expect(out).toContain('③-4 内置 confirm_preview 取票工具在清单中')
    expect(out).toContain('通过 ——')
    expect(out).not.toContain('❌')
  }, 90_000)
})

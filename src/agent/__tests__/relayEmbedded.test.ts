/**
 * Relay 内嵌整合对照测试（Issue #33「把 relay 整合进项目」）
 *
 * 断言的架构事实：relay 从「独立进程 + 独立端口 + 定制 CSP」降级为「一段可挂载的处理逻辑」，
 * 由宿主同源托管：
 *   - `relay/server.mjs` 导出 createRelay，只暴露 handleUpgrade，不自己 listen；
 *   - Vite 插件（scripts/vite-relay-plugin.mjs）把它挂到 dev server 的 `/relay`；
 *   - scripts/serve.mjs 在**同一 Node 进程**里托管 dist 静态站点 + relay，同源 `/relay`。
 * 另覆盖「独立进程形态仍可用」（relay/index.mjs 默认接受根路径，向后兼容）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRelay } from '@relay/server.mjs'

let server: import('node:http').Server | undefined

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server = undefined
})

/** 起一个普通 http server 并挂载 relay，返回可连地址 */
async function mountRelay(opts: { path?: string; token: string }): Promise<{ port: number }> {
  const relay = createRelay({ token: opts.token, path: opts.path ?? '/relay', log: () => {} })
  server = createServer((_req, res) => res.writeHead(200).end('ok'))
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head))
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server!.address()
  return { port: typeof addr === 'object' && addr ? addr.port : 0 }
}

/** 在给定 ws 地址上做一次 MCP initialize */
function initialize(url: string, token: string): Promise<Record<string, unknown>> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url)
    const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 4000)
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { accessToken: token } }))
    ws.onmessage = (e) => { clearTimeout(t); ws.close(); res(JSON.parse(String(e.data))) }
    ws.onerror = (e) => { clearTimeout(t); rej(new Error((e as { message?: string })?.message ?? 'ws error')) }
  })
}

describe('relay 可嵌入内核（createRelay）', () => {
  it('不自己 listen：把 handleUpgrade 挂到宿主的 http server 上即可用（同源 /relay）', async () => {
    const token = 'embedded-token-1234567890'
    const { port } = await mountRelay({ token })
    const out = await initialize(`ws://127.0.0.1:${port}/relay`, token)
    const result = out.result as { serverInfo?: { name?: string } } | undefined
    expect(result?.serverInfo?.name).toBe('workhub-agentops-relay')
  })

  it('错误 token 的 initialize 被拒（安全闸门随内嵌形态保留）', async () => {
    const { port } = await mountRelay({ token: 'right-token-1234567890' })
    const out = await initialize(`ws://127.0.0.1:${port}/relay`, 'wrong-token')
    expect((out.error as { code?: number })?.code).toBe(-32001)
  })

  it('挂载路径可配置：非挂载路径不接管（不抢宿主的其它 WS）', async () => {
    const { port } = await mountRelay({ path: '/ai-bridge', token: 'tok-1234567890abcd' })
    // 挂载路径可用
    const ok = await initialize(`ws://127.0.0.1:${port}/ai-bridge`, 'tok-1234567890abcd')
    expect((ok.result as { serverInfo?: { name?: string } })?.serverInfo?.name).toBe('workhub-agentops-relay')
    // 其它路径被明确拒绝（404），不会挂死
    await expect(initialize(`ws://127.0.0.1:${port}/`, 'tok-1234567890abcd')).rejects.toThrow()
  })
})

describe('整合形态的源码事实（防回归）', () => {
  it('relay/index.mjs 不再自建 relay 核心，改为复用 server.mjs（单实现）', () => {
    const src = readFileSync(resolve(__dirname, '../../../relay/index.mjs'), 'utf8')
    expect(src).toContain("from './server.mjs'")
    // 核心逻辑（confirm_preview / 浏览器回包处理）已不在进程入口里重复实现
    expect(src).not.toContain("const CONFIRM_TOOL = 'confirm_preview'")
  })

  it('vite 配置挂载内嵌插件；serve.mjs 同进程托管 dist + relay', () => {
    const vite = readFileSync(resolve(__dirname, '../../../vite.config.ts'), 'utf8')
    expect(vite).toContain('relayPlugin')
    const serve = readFileSync(resolve(__dirname, '../../../scripts/serve.mjs'), 'utf8')
    expect(serve).toContain('createRelay')
    expect(serve).toContain("server.on('upgrade'")
  })
})

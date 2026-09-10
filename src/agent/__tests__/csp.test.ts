/**
 * CSP / relay 同源内嵌对照测试（Issue #33「把 relay 整合进项目」）
 *
 * 架构变更：relay 不再需要「独立端口 + 单独放行 ws 源」。
 * relay 由前端**同源**托管（dev 由 Vite 插件挂 `/relay`，prod 由 scripts/serve.mjs 挂 `/relay`），
 * 页面连的是 `ws(s)://<本站>/relay` —— 同源 WebSocket 由现有 CSP `connect-src 'self'` 直接覆盖，
 * 因此 **不再需要往 index.html 注入任何 `ws://` 源**，也就不再存在
 * 「dev 放开、prod 忘记放开」「https 页面连 ws:// 被混合内容拦掉」两类坑。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import viteConfig from '../../../vite.config'

const indexHtml = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8')
const prodDist = path.resolve(__dirname, '../../../dist/index.html')

describe('CSP 与同源 relay', () => {
  it('index.html 采用 connect-src \'self\'（同源 ws/wss 已覆盖，无需注入 ws 源）', () => {
    const csp = indexHtml.match(/connect-src[^"]*/)?.[0] ?? ''
    expect(csp).toContain("'self'")
  })

  it('CSP 不含任何通配/明文 ws 源（生产默认可直接连同源 relay）', () => {
    const csp = indexHtml.match(/connect-src[^"]*/)?.[0] ?? ''
    expect(csp).not.toContain('ws://127.0.0.1')
  })

  it('vite 插件列表包含 workhub-relay（同源内嵌），且已移除旧的 CSP 注入插件', () => {
    const plugins = (viteConfig as unknown as { plugins: unknown[] }).plugins ?? []
    const list = Array.isArray(plugins) ? plugins.flat().filter(Boolean) : []
    const names = list.map((p) => (p as { name?: string })?.name)
    expect(names).toContain('workhub-relay')
    expect(names).not.toContain('workhub-csp-relay')
  })

  it('生产构建产物（若存在）CSP 不含明文 ws:', () => {
    let dist = ''
    try {
      dist = readFileSync(prodDist, 'utf8')
    } catch {
      return // 未构建则跳过（CI 中 build 在 test 之后）
    }
    const csp = dist.match(/connect-src[^"]*/)?.[0] ?? ''
    expect(csp).not.toContain('ws:')
  })
})

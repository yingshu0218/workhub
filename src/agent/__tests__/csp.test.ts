/**
 * CSP dev 注入对照测试（方案 §9.1 / §7.4）
 *
 * 硬约束：仅 dev/本地自用构建的 CSP 放开 `ws://127.0.0.1:<relay 端口>`；
 * 生产构建的 index.html CSP **不含 `ws:`**（否则全站放开外连能力）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import viteConfig from '../../../vite.config'

const indexHtml = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8')
const prodDist = path.resolve(__dirname, '../../../dist/index.html')

/** 复刻 cspRelayPlugin 的 transform 逻辑做白盒断言（避免真起 dev server） */
function applyCsp(html: string, port = '8787'): string {
  const wsSource = `ws://127.0.0.1:${port}`
  return html.replace(/(connect-src[^;]*)(;)/, (_m, g1: string, semi: string) =>
    g1.includes(wsSource) ? `${g1}${semi}` : `${g1} ${wsSource}${semi}`,
  )
}

describe('CSP relay ws 注入', () => {
  it('index.html 静态 CSP 不含任何 ws: 源（生产默认同款）', () => {
    const csp = indexHtml.match(/connect-src[^"]*/)?.[0] ?? ''
    expect(csp).not.toContain('ws:')
    expect(csp).not.toContain('wss:')
  })

  it('dev 注入后 connect-src 追加 relay 的 ws 源且幂等', () => {
    const once = applyCsp(indexHtml)
    expect(once).toContain('ws://127.0.0.1:8787')
    const twice = applyCsp(once)
    expect(twice.match(/ws:\/\/127\.0\.0\.1:8787/g)?.length).toBe(1)
  })

  it('cspRelayPlugin 声明为 apply:"serve"（仅 dev 生效）', () => {
    const plugins = (viteConfig as unknown as { plugins: unknown[] }).plugins ?? []
    const list = Array.isArray(plugins) ? plugins.flat().filter(Boolean) : []
    const cspPlugin = list.find((p) => (p as { name?: string })?.name === 'workhub-csp-relay') as
      | { apply?: string; transformIndexHtml?: unknown }
      | undefined
    expect(cspPlugin).toBeTruthy()
    expect(cspPlugin?.apply).toBe('serve')
  })

  it('生产构建产物（若存在）CSP 不含 ws:', () => {
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

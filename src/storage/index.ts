import type { StorageAdapter } from './types'
import { connectionEpoch } from '@/platform/endpoint'

/**
 * StorageAdapter 单例入口 —— 执行链统一从这里 import（agentOps 服务端化 P2 重组）
 *
 * ⚠️ 本文件**零 `@/db/db` 依赖**：服务端执行器 bundle（reads/resolver → 本文件）不能拖 Dexie。
 * - 浏览器：`main.tsx` eager import `./browser` 注册 DexieAdapter；
 * - 服务端：`initServerExecutor`（agent/serverReads.ts）注册 PocketBaseAdapter；
 * - 兜底：都未注册时（vitest 直接 import 被测模块的场景）动态加载 browser 注册——
 *   动态 import 不进服务端 bundle 的静态依赖图。
 */

let current: StorageAdapter | null = null
let loading: Promise<StorageAdapter> | null = null

/** 注入适配器（进程生命周期内通常只调一次；重复注入以最后一次为准） */
export function setStorageAdapter(adapter: StorageAdapter): void {
  current = adapter
  loading = null
}

/** 清除注入（测试隔离用）：回到「未注册」态，下次调用重新走兜底加载 */
export function resetStorageAdapter(): void {
  current = null
  loading = null
}

/** 未注册时兜底加载浏览器适配器（vitest 环境 fake-indexeddb 已就绪，行为与 P1 静态加载等价） */
function ensureAdapter(): Promise<StorageAdapter> {
  if (current) return Promise.resolve(current)
  loading ??= import('./browser').then(() => {
    if (!current) throw new Error('[storage] browser.ts 未完成注册（检查 storage/browser.ts）')
    return current
  })
  return loading
}

/** 执行链统一入口：方法转发到当前适配器（保证 setStorageAdapter 后所有既有 import 立即生效） */
export const storage: StorageAdapter = {
  async query(table, scope) {
    const epoch = connectionEpoch()
    const check = () => { if (connectionEpoch() !== epoch) throw new Error('SESSION_CHANGED: 旧会话不能读取当前缓存') }
    const adapter = await ensureAdapter()
    check()
    if (adapter.query) {
      const rows = await adapter.query(table, scope)
      check()
      return rows as never
    }
    const { inScope } = await import('@/commands/scope')
    check()
    const rows = (await adapter.list<import('@/commands/core').Row>(table)).filter(r => inScope(r, scope)) as never
    check()
    return rows
  },
  async transaction(...args) {
    // 适配器初始化前就固定连接；否则旧表单可能被新账号适配器接收。
    const epoch = connectionEpoch()
    const check = () => { if (connectionEpoch() !== epoch) throw new Error('SESSION_CHANGED: 旧会话不能继续提交') }
    const adapter = await ensureAdapter()
    check()
    const [tables, fn] = args
    const result = await adapter.transaction(tables, async (tx) => {
      check()
      const value = await fn(tx)
      check()
      return value
    })
    check()
    return result
  },
  async get(...args) {
    const epoch = connectionEpoch()
    const adapter = await ensureAdapter()
    if (connectionEpoch() !== epoch) throw new Error('SESSION_CHANGED: 旧会话不能读取当前缓存')
    const result = await adapter.get(...args)
    if (connectionEpoch() !== epoch) throw new Error('SESSION_CHANGED: 旧会话不能读取当前缓存')
    return result as never
  },
  async list(...args) {
    const epoch = connectionEpoch()
    const adapter = await ensureAdapter()
    if (connectionEpoch() !== epoch) throw new Error('SESSION_CHANGED: 旧会话不能读取当前缓存')
    const result = await adapter.list(...args)
    if (connectionEpoch() !== epoch) throw new Error('SESSION_CHANGED: 旧会话不能读取当前缓存')
    return result as never
  },
  async requestSync(...args) {
    const epoch = connectionEpoch()
    const adapter = await ensureAdapter()
    if (connectionEpoch() !== epoch) throw new Error('SESSION_CHANGED: 旧会话不能 requestSync')
    return adapter.requestSync(...args)
  },
}

export async function onlineCommandStorage(): Promise<boolean> { return (await ensureAdapter()).commandMode === true }

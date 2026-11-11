import type { StorageAdapter } from './types'

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
  async transaction(...args) {
    return (await ensureAdapter()).transaction(...args)
  },
  async get(...args) {
    return (await ensureAdapter()).get(...args)
  },
  async list(...args) {
    return (await ensureAdapter()).list(...args)
  },
  async requestSync(...args) {
    return (await ensureAdapter()).requestSync(...args)
  },
}

export async function onlineCommandStorage(): Promise<boolean> { return (await ensureAdapter()).commandMode === true }

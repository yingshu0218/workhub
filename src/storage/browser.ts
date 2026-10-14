import { db } from '@/db/db'
import { syncEngine } from '@/sync/engine'
import { createDexieAdapter } from './dexie'
import { setStorageAdapter } from './index'

/**
 * 浏览器端适配器注册（agentOps 服务端化 P2 重组）
 *
 * ⚠️ 全仓**唯一**允许 import `@/db/db` 的 storage 文件：本文件只做一件事——
 * 用真实 Dexie db + 同步引擎构造 DexieAdapter 并注册进单例。
 * 由 `main.tsx` eager import（副作用注册）；vitest 兜底路径动态 import 本文件。
 * 服务端执行器（agent/serverReads.ts 的 initServerExecutor）**不得** import 本文件，
 * 它注册的是 PocketBaseAdapter。
 */
setStorageAdapter(createDexieAdapter({ db, syncEngine }))

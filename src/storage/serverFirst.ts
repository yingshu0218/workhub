import { db } from '@/db/db'
import {
  deleteRemoteRecord,
  isSyncedTable,
  upsertRemoteRecord,
} from '@/sync/pocketbaseAdapter'
import type { StorageAdapter, StorageTx, TableName } from './types'

/**
 * ServerFirstAdapter —— 「服务端唯一真源」的 Web 端实现（2026-11-03 用户裁决）
 *
 * ## 为什么需要它
 *
 * 在此之前 Web 端 = 本地先写 + 同步队列后推（DexieAdapter + syncEngine）。后果是
 * 「浏览器里有一份能独立于服务器存在的真源」：服务器被清空，页面照样显示全量数据
 * （2026-11-03 正式站事故就是这个形态 —— 服务端 8 个集合全 0，页面仍是 ¥18.5 万）。
 *
 * 用户裁决：**Web 版就是服务器那一套，离线不在 Web 端兜**（离线由桌面端承担）。
 * 于是本适配器把写入顺序倒过来：
 *
 * 1. **写直达 PB**（`upsertRemoteRecord` / `deleteRemoteRecord`）；
 * 2. 服务端成功后才落 Dexie —— Dexie 从此是**镜像缓存**，不是第二份真源；
 * 3. `enqueue` 变 no-op：没有队列，也就没有「攒着等同步」的窗口；
 * 4. 断网 → 写请求抛错 → UI 报错。这是刻意的：Web 端不做离线。
 *
 * ## 边界
 *
 * - 只给**浏览器**用（import `@/db/db`）。桌面端（Tauri）继续纯本地，不注册本适配器。
 * - 本地专属表（`settings` / `focusSessions` / `trashBatches` / `meta` / `syncQueue`）
 *   **不推服务端**，仍直接读写 Dexie。
 * - PB 没有跨表事务：`transaction` 只是顺序执行，任一步失败即中止（types.ts 已声明该近似）。
 * - 读取仍走 Dexie 镜像：调用方（含 20 余处 UI 读路径）不需要改，镜像由启动对齐与
 *   每轮 `convergeFromServer()` 保持与服务器一致。
 */

/** Dexie 表的窄形状视图（执行链只用到这几个方法） */
interface DexieTableLike {
  get(id: string): Promise<unknown>
  put(value: unknown): Promise<unknown>
  update(id: string, changes: Record<string, unknown>): Promise<number>
  delete(id: string): Promise<void>
  toArray(): Promise<unknown[]>
}

function tableOf(name: TableName): DexieTableLike {
  const t = (db as unknown as Record<string, DexieTableLike | undefined>)[name]
  if (!t) throw new Error(`[server-first] 未知表：${name}（检查调用方表名拼写）`)
  return t
}

type Row = Record<string, unknown> & { id: string }

/**
 * 远端写入口（依赖注入）。
 *
 * 为什么注入而不是直接调用：单测里必须能替换掉真实网络调用，但**不能 vi.mock 整个
 * `@/sync/pocketbaseAdapter`** —— 那会把同模块被别处使用的 `isSyncConfigured` /
 * `pocketBaseAdapter` 一起抹成 undefined，全量并发跑时别的用例会挂住（2026-10-30 实测）。
 */
export interface ServerFirstDeps {
  isSynced(table: string): boolean
  upsertRemote(table: string, row: Row): Promise<'written' | 'skipped'>
  deleteRemote(table: string, id: string): Promise<void>
}

const DEFAULT_DEPS: ServerFirstDeps = {
  isSynced: (table) => isSyncedTable(table),
  upsertRemote: (table, row) => upsertRemoteRecord(table, row),
  deleteRemote: (table, id) => deleteRemoteRecord(table, id),
}

/**
 * 写入后的镜像同步策略：
 * - `written`：服务端已接受 → 落镜像（UI 立刻能看到）
 * - `skipped`：服务端更新（别人后写）或远端是墓碑 → **不落镜像**，交给对齐把服务端值拉回来
 */
async function writeThrough(deps: ServerFirstDeps, table: TableName, row: Row): Promise<void> {
  if (!deps.isSynced(table)) {
    await tableOf(table).put(row)
    return
  }
  const outcome = await deps.upsertRemote(table, row)
  if (outcome === 'written') await tableOf(table).put(row)
  else void scheduleConverge()
}

let convergeTimer: ReturnType<typeof setTimeout> | undefined
let convergeRunner: (() => Promise<unknown>) | undefined

/**
 * 对齐调度器由 `convergeFromServer` 注入（避免 storage → sync/converge → storage 的静态环）。
 * 未注入时（如单测）直接跳过。
 */
export function installConvergeRunner(run: () => Promise<unknown>): void {
  convergeRunner = run
}

/** 被服务端拒绝（LWW 过期/墓碑）后，尽快让镜像跟随服务端——2s 去抖，避免连续写触发多次全量 */
function scheduleConverge(): void {
  if (!convergeRunner || convergeTimer) return
  convergeTimer = setTimeout(() => {
    convergeTimer = undefined
    void convergeRunner?.().catch((err) => {
      console.warn('[server-first] 对齐失败（下次轮询会重试）', err)
    })
  }, 2000)
}

function makeTx(deps: ServerFirstDeps): StorageTx {
  return {
    async get(table, id) {
      return (await tableOf(table).get(id)) as never
    },
    async list(table) {
      return (await tableOf(table).toArray()) as never
    },
    async put(table, record) {
      await writeThrough(deps, table, record as Row)
    },
    async update(table, id, patch) {
      const cur = (await tableOf(table).get(id)) as Row | undefined
      // 幽灵记录一律可操作错误（AGENTS.md §6.3）：改不存在的行必须炸，而不是静默成功
      if (!cur) throw new Error(`[server-first] 更新不存在的记录：${table}/${id}`)
      const next: Row = { ...cur, ...patch }
      // Dexie update 语义：patch 里显式 undefined 等于删键
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k]
      await writeThrough(deps, table, next)
    },
    async delete(table, id) {
      if (deps.isSynced(table)) await deps.deleteRemote(table, id)
      await tableOf(table).delete(id)
    },
    // 没有队列可入：服务端唯一真源下「写入即已送达」，入队语义在此终结
    async enqueue() {},
  }
}

export function createServerFirstAdapter(overrides: Partial<ServerFirstDeps> = {}): StorageAdapter {
  const deps: ServerFirstDeps = { ...DEFAULT_DEPS, ...overrides }
  return {
    async transaction(_tables, fn) {
      // PB 无跨表事务：顺序执行、失败即中止（已写入的步骤不回滚，见 types.ts 的近似声明）
      return fn(makeTx(deps))
    },
    async get(table, id) {
      return (await tableOf(table).get(id)) as never
    },
    async list(table) {
      return (await tableOf(table).toArray()) as never
    },
    requestSync() {
      // 已就地写中心，没有「待同步」这回事
    },
  }
}

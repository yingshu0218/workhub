import { db } from '@/db/db'
import { isTombstone, reviveRemoteJsonFields, stripPbMeta, SYNC_TABLES } from '@/sync/remoteNormalize'
import { classifySyncTarget } from '@/sync/connectivity'
import { useSyncStore } from '@/sync/store'
import { fetchAttachmentBlob, listRemoteAll, serverFirstCfg } from '@/sync/pocketbaseAdapter'
import { createPocketBaseAdapter } from '@/storage/pocketbase'
import { getAuthToken } from '@/shared/authToken'
import { installConvergeRunner, withMirrorLock, pinCacheGeneration } from '@/storage/serverFirst'

/** 可重建的服务端镜像；提交和对齐互斥，保留墓碑、正文和恢复快照。 */
export interface ConvergeResult {
  upserted: number
  removed: number
  /** 单条合并失败数（不阻塞整轮：与 pull 的「单条失败不中断整表」同款纪律） */
  failed: number
}

/**
 * 远端读取的注入点（同 `ServerFirstDeps` 的理由：单测不能整模块 mock 掉
 * `@/sync/pocketbaseAdapter`，否则同模块其他导出会变 undefined，拖挂并发用例）。
 */
/** 远端行：PB 记录必有 `id`（哈希主键），其余字段按集合而异 */
export type RemoteRow = { id: string } & Record<string, unknown>

export interface ConvergeDeps {
  generation?(): Promise<string>
  hasToken(): boolean
  listRemote(table: string): Promise<RemoteRow[]>
  loadAttachment?(remote: RemoteRow): Promise<Blob | undefined>
}

const DEFAULT_DEPS: ConvergeDeps = {
  generation: () => createPocketBaseAdapter({ baseUrl: '', token: getAuthToken }).transport.generation(),
  hasToken: () => Boolean(serverFirstCfg().token),
  listRemote: (table) => listRemoteAll(table),
  loadAttachment: (remote) => fetchAttachmentBlob(remote as never),
}

/** 附件的远程文件字段（PB file 类型；对齐时要靠它判断「文件换没换」） */
function attachmentFileOf(remote: Record<string, unknown>): string {
  return typeof remote.file === 'string' ? remote.file : ''
}

/**
 * 附件是否可以跳过：远端时间戳没变、且本地已有文件内容。
 *
 * 只比 `updatedAt` 不够 —— 新设备首次对齐时本地没有 blob，必须下载；
 * 只比 blob 也不够 —— 服务端换了文件但元数据行还在本地时也要重下。两者都要满足才跳过。
 */
function attachmentUnchanged(
  local: Record<string, unknown> | undefined,
  remote: Record<string, unknown>,
  localId: string,
): boolean {
  if (!local || !localId) return false
  if (local.updatedAt !== remote.updatedAt) return false
  const file = attachmentFileOf(remote)
  if (!file) return true // 元数据行没有文件，无需下载
  // 刻意用「有 size 数字」而不是 `instanceof Blob`：跨 realm（jsdom / fake-indexeddb /
  // structuredClone）时 Blob 的构造函数不同，instanceof 会假阴性 → 变成每轮都重下文件
  const blob = local.blob as { size?: unknown } | undefined
  return typeof blob?.size === 'number'
}

async function convergeUnlocked(
  overrides: Partial<ConvergeDeps> = {},
): Promise<ConvergeResult> {
  const deps: ConvergeDeps = { ...DEFAULT_DEPS, ...overrides }
  if (!deps.hasToken()) {
    throw new Error('[converge] 未登录：服务端唯一真源模式需要先登录')
  }

  if (!overrides.listRemote && deps.generation) pinCacheGeneration(await deps.generation())

  // 无队列（ServerFirstAdapter 的 enqueue 是 no-op），索引必为空；传进去只为复用同一签名
  let upserted = 0
  let removed = 0
  let failed = 0

  for (const table of SYNC_TABLES) {
    const remotes = await deps.listRemote(table)
    const mirror = db[table] as unknown as {
      toArray(): Promise<Record<string, unknown>[]>
      delete(id: string): Promise<void>
    }

    const localRows = await mirror.toArray()
    const localById = new Map(localRows.map((r) => [String(r.id), r]))

    const remoteIds = new Set<string>()
    for (const r of remotes) {
      const localId = typeof r.localId === 'string' ? r.localId : ''
      if (localId) remoteIds.add(localId)
    }

    // 1) 远端没有的本地行 → 物理删除（Web 实例不保留「服务端不存在」的业务数据）
    for (const id of localById.keys()) {
      if (!remoteIds.has(id)) {
        await mirror.delete(id)
        removed++
      }
    }

    // 2) 远端有的行 → 先删本地，再 merge（远端必胜）
    for (const remote of remotes) {
      const localId = typeof remote.localId === 'string' ? remote.localId : ''
      if (!localId) continue
      if (table === 'attachments' && attachmentUnchanged(localById.get(localId), remote, localId)) {
        continue
      }
      try {
        const revived = { ...stripPbMeta(remote), id: localId, deleted: isTombstone(remote) ? 1 : 0 }
        reviveRemoteJsonFields(table, revived)
        const current = localById.get(localId)
        if (current && JSON.stringify(current) === JSON.stringify(revived)) continue
        if (table === 'attachments') {
          const blob = await deps.loadAttachment?.(remote)
          if (blob) Object.assign(revived, { blob })
        }
        // 保留墓碑正文和恢复快照；新设备的回收站与服务端一致。
        await db.table(table).put(revived)
        upserted++
      } catch (err) {
        // 单条坏数据不该拖垮整轮对齐（否则一条畸形记录会让整个 Web 实例永远停在旧镜像）
        failed++
        console.warn(`[converge] 合并失败 ${table}/${localId}`, err)
      }
    }
  }

  return { upserted, removed, failed }
}

export function convergeFromServer(overrides: Partial<ConvergeDeps> = {}): Promise<ConvergeResult> {
  return withMirrorLock(() => convergeUnlocked(overrides))
}

let loopTimer: ReturnType<typeof setInterval> | undefined

/**
 * 带状态上报的对齐——**生产路径一律走这个**，不要直接调 `convergeFromServer`。
 *
 * 为什么必须包一层：server-first 模式下同步引擎没启动（没有队列、没有心跳），
 * 而顶栏徽章读的是 `syncStore` 的连通性 —— 没人写它，徽章就永远停在「检测连接…」
 * （2026-11-03 真机验收实测）。所以对齐本身必须兼作连通性探测：成功即在线、失败即离线。
 */
export async function runConverge(overrides: Partial<ConvergeDeps> = {}): Promise<ConvergeResult> {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  const sync = useSyncStore.getState()
  sync.setStatus('syncing')
  sync.setConnectivity({
    serverUrl: origin,
    target: classifySyncTarget(origin),
    reachability: 'checking',
    lastCheckedAt: Date.now(),
  })
  try {
    const result = await convergeFromServer(overrides)
    const done = useSyncStore.getState()
    if (result.failed) throw new Error(`对齐有 ${result.failed} 条记录失败，请重试`)
    done.setStatus('synced')
    done.setConnectivity({
      serverUrl: origin,
      target: classifySyncTarget(origin),
      reachability: 'online',
      lastCheckedAt: Date.now(),
    })
    done.setLastSync(Date.now())
    done.setLastError(null)
    return result
  } catch (err) {
    const failed = useSyncStore.getState()
    failed.setStatus('offline')
    failed.setConnectivity({
      serverUrl: origin,
      target: classifySyncTarget(origin),
      reachability: 'offline',
      lastCheckedAt: Date.now(),
    })
    failed.setLastError(err instanceof Error ? err.message : String(err))
    throw err
  }
}

/**
 * 启动周期对齐（默认 60s）。
 *
 * 为什么还需要轮询：Web 端没有推送通道，另一台设备改完不会主动通知本端。
 * 代价是一次全量 GET（当前数据量下毫秒级），换来「刷新不刷新都看到同一份数据」。
 */
export function startServerFirstLoop(intervalMs = 60_000): void {
  installConvergeRunner(() => runConverge())
  if (loopTimer) return
  loopTimer = setInterval(() => {
    void runConverge().catch((err) => {
      // 断网 / token 失效时只告警：不阻塞 UI，下一轮自动重试
      console.warn('[server-first] 周期对齐失败', err)
    })
  }, intervalMs)
}

export function stopServerFirstLoop(): void {
  if (loopTimer) clearInterval(loopTimer)
  loopTimer = undefined
}

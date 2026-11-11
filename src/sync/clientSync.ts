import { db } from '@/db/db'
import { clientRequest } from '@/platform/request'
import { clientSession, requireClientSession } from '@/storage/clientSession'
import {
  MIRROR_CURSOR,
  publishMirror,
  type SyncBatch,
  type MirrorChange,
} from '@/storage/clientMirror'
import { useSyncStore } from './store'

const running = new Map<string, Promise<void>>()
export async function pullClientChanges(forceSnapshot = false): Promise<void> {
  const key = clientSession()?.key
  if (!key) return
  if (running.has(key)) return running.get(key)!
  const task = run(forceSnapshot).finally(() => {
    running.delete(key)
  })
  running.set(key, task)
  return task
}
async function run(forceSnapshot: boolean) {
  const context = clientSession()
  if (!context) return
  const cache = db,
    store = useSyncStore.getState()
  store.setStatus('syncing')
  try {
    const mirrorVersion = Number((await cache.meta.get('client:mirrorVersion'))?.value || 0)
    const old = await cache.meta.get(MIRROR_CURSOR),
      initial = forceSnapshot ? undefined : (old?.value as string | undefined)
    let cursor = initial,
      mode: 'snapshot' | 'delta' = initial ? 'delta' : 'snapshot',
      changes: MirrorChange[] = [],
      restarts = 0
    // 响应每批200行；快照/增量窗口全部完成才原子发布。中断仅保留可重建暂存。
    for (let page = 0; page < 10000; page++) {
      requireClientSession(context)
      let batch: SyncBatch
      try {
        batch = (await clientRequest('/api/workhub/sync', {
          mode,
          limit: 200,
          ...(cursor ? { cursor } : {}),
        })) as unknown as SyncBatch
      } catch (error) {
        if (
          /SNAPSHOT_RESTART_REQUIRED|SYNC_RESTART_REQUIRED/.test(String(error)) &&
          restarts++ < 2
        ) {
          cursor = initial
          mode = initial ? 'delta' : 'snapshot'
          changes = []
          continue
        }
        throw error
      }
      requireClientSession(context)
      if (
        batch.generation !== context.generation ||
        batch.schema !== context.schema ||
        batch.owner !== context.owner
      )
        throw new Error('RECOVERY_REVIEW_REQUIRED: 缓存世代或身份已改变，请保护草稿后重新登录')
      changes.push(...batch.changes)
      await cache.meta.put({
        key: 'client:stage',
        value: {
          mode,
          cursor: batch.nextCursor,
          watermark: batch.watermark,
          count: changes.length,
        },
      })
      if (batch.complete) {
        await publishMirror(
          changes,
          context,
          batch.nextCursor,
          mode === 'snapshot',
          forceSnapshot ? undefined : initial,
          batch.watermark,
          mirrorVersion,
        )
        store.setStatus('synced')
        store.setLastSync(Date.now())
        store.setLastError(null)
        store.setConnectivity({
          serverUrl: context.server,
          target: 'remote',
          reachability: 'online',
          lastCheckedAt: Date.now(),
        })
        return
      }
      if (cursor === batch.nextCursor) throw new Error('SYNC_NO_PROGRESS: 服务端游标没有前进')
      cursor = batch.nextCursor
    }
    throw new Error('LIMIT_EXCEEDED: 同步窗口过大，请重新建立快照')
  } catch (error) {
    requireClientSession(context)
    store.setStatus('offline')
    store.setLastError(String(error))
    store.setConnectivity({
      serverUrl: context.server,
      target: 'remote',
      reachability: 'offline',
      lastCheckedAt: Date.now(),
    })
    if (String(error).includes('RECOVERY_REVIEW_REQUIRED'))
      window.dispatchEvent(new CustomEvent('workhub:auth-fault', { detail: { status: 409 } }))
    throw error
  }
}
export function startClientSync(interval = 30_000) {
  let disposed = false
  const pull = () => {
    if (!disposed && document.visibilityState !== 'hidden' && navigator.onLine)
      void pullClientChanges().catch(() => {})
  }
  const offline = () => useSyncStore.getState().setStatus('offline')
  const visible = () => {
    if (document.visibilityState === 'visible') pull()
  }
  const timer = setInterval(pull, interval)
  for (const name of ['online', 'pageshow', 'workhub:resume']) window.addEventListener(name, pull)
  window.addEventListener('offline', offline)
  document.addEventListener('visibilitychange', visible)
  pull()
  return () => {
    disposed = true
    clearInterval(timer)
    for (const name of ['online', 'pageshow', 'workhub:resume'])
      window.removeEventListener(name, pull)
    window.removeEventListener('offline', offline)
    document.removeEventListener('visibilitychange', visible)
  }
}

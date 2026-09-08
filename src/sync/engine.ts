import { db } from '@/db/db'
import type { SyncAdapter } from './adapter'
import { pocketBaseAdapter, cleanupTombstones, isSyncConfigured } from './pocketbaseAdapter'
import { useSyncStore } from './store'

/**
 * 同步引擎 —— 触发：启动 / online 事件 / 30s 心跳 / 写入后防抖 2s（repository 层调用 requestSync）
 * 协议：LWW —— 只认 updatedAt，新者胜（开发计划 2.3）
 * 适配器：PocketBase（未配置 serverUrl 时适配器内部退化为本地模式空实现）
 * 拉取游标：持久化 db.meta（pb_cursor:<table>，由适配器维护；全局 cursor 仅为展示/兼容保留）
 */
const CURSOR_KEY = 'sync_cursor'
const TOMBSTONE_CLEANUP_KEY = 'tombstone_cleanup_at'
const TOMBSTONE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000

class SyncEngine {
  private adapter: SyncAdapter = pocketBaseAdapter
  private timer: ReturnType<typeof setInterval> | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null
  private cursor = 0
  private running = false

  setAdapter(adapter: SyncAdapter) {
    this.adapter = adapter
  }

  start() {
    if (this.timer) return
    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    this.timer = setInterval(() => void this.syncNow('heartbeat'), 30_000)
    void db.meta
      .get(CURSOR_KEY)
      .then((entry) => {
        if (typeof entry?.value === 'number') this.cursor = entry.value
      })
      .then(() => this.syncNow('startup'))
  }

  stop() {
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** repository 写入后调用：防抖 2s 合并推送 */
  requestSync() {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.syncNow('write'), 2000)
  }

  private onOnline = () => void this.syncNow('online')
  private onOffline = () => useSyncStore.getState().setStatus('offline')

  async syncNow(_reason: string) {
    const store = useSyncStore.getState()
    if (this.running) return
    if (!navigator.onLine) {
      store.setStatus('offline')
      return
    }
    this.running = true
    store.setStatus('syncing')
    try {
      // 1. 推送本地队列
      const all = await db.syncQueue.toArray()
      const pending = all.filter((p) => !p.sentAt)
      // 清理历史遗留的已发送条目（现在改为推完即删，不再保留 sentAt 标记）
      const staleSent = all
        .filter((p) => p.sentAt)
        .map((p) => p.seq!)
        .filter((s) => s !== undefined)
      if (staleSent.length > 0) {
        await db.syncQueue.where('seq').anyOf(staleSent).delete()
      }
      store.setPending(pending.length)
      if (pending.length > 0) {
        const results = await this.adapter.push(
          pending.map((p) => ({ table: p.table, recordId: p.recordId, op: p.op })),
        )
        const okSeqs = pending
          .filter((p) => results.find((r) => r.ok && r.recordId === p.recordId))
          .map((p) => p.seq!)
        if (okSeqs.length > 0) {
          // 推送成功即删除队列条目，不留全量历史
          await db.syncQueue.where('seq').anyOf(okSeqs).delete()
        }
        store.setPending(pending.length - okSeqs.length)
      }
      // 2. 拉取远端增量（LWW 合并在适配器内完成：远端新 → 写本地盖 rev 不入队）
      const pulled = await this.adapter.pull(this.cursor)
      this.cursor = pulled.cursor
      await db.meta.put({ key: CURSOR_KEY, value: pulled.cursor })
      useSyncStore.getState().setStatus('synced')
      useSyncStore.getState().setLastSync(Date.now())
      // 3. 墓碑物理清理：已配置同步时每天一次（两端各自清理 30 天前软删除）
      if (isSyncConfigured()) {
        const lastCleanup = await db.meta.get(TOMBSTONE_CLEANUP_KEY)
        const last = typeof lastCleanup?.value === 'number' ? lastCleanup.value : 0
        if (Date.now() - last > TOMBSTONE_CLEANUP_INTERVAL) {
          await cleanupTombstones()
          await db.meta.put({ key: TOMBSTONE_CLEANUP_KEY, value: Date.now() })
        }
      }
    } catch {
      // 失败时按队列实际积压如实显示：有未传 → offline（待同步徽章），无未传 → synced
      const s = useSyncStore.getState()
      const pendingCount = await db.syncQueue.filter((p) => !p.sentAt).count()
      s.setPending(pendingCount)
      s.setStatus(!navigator.onLine || pendingCount > 0 ? 'offline' : 'synced')
    } finally {
      this.running = false
    }
  }
}

export const syncEngine = new SyncEngine()

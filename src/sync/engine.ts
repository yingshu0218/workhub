import { db } from '@/db/db'
import { stubAdapter, type SyncAdapter } from './adapter'
import { useSyncStore } from './store'

/**
 * 同步引擎（Phase 0 骨架，Phase 7 实装 PocketBase）
 * 协议：LWW —— 只认 updatedAt，新者胜（开发计划 2.3）
 * 触发：启动 / online 事件 / 30s 心跳 / 写入后防抖 2s（由 repository 层调用 requestSync）
 */
class SyncEngine {
  private adapter: SyncAdapter = stubAdapter
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
    void this.syncNow('startup')
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
      const staleSent = all.filter((p) => p.sentAt).map((p) => p.seq!).filter((s) => s !== undefined)
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
      // 2. 拉取远端增量（stub 恒为空；Phase 7 实装）
      const pulled = await this.adapter.pull(this.cursor)
      this.cursor = pulled.cursor
      useSyncStore.getState().setStatus('synced')
      useSyncStore.getState().setLastSync(Date.now())
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

import { db } from '@/db/db'
import type { SyncAdapter } from './adapter'
import {
  pocketBaseAdapter,
  cleanupTombstones,
  isSyncConfigured,
  getSyncServerUrl,
} from './pocketbaseAdapter'
import { classifySyncTarget, isNetworkFailure, probeSyncCenter } from './connectivity'
import { useSyncStore } from './store'
import { withExclusiveSync } from './engineLock'

/**
 * 同步引擎 —— 触发：启动 / online 事件 / 30s 心跳 / 写入后防抖 2s（repository 层调用 requestSync）
 * 协议：LWW —— 只认 updatedAt，新者胜（开发计划 2.3）
 * 适配器：PocketBase（未配置 serverUrl 时适配器内部退化为本地模式空实现）
 * 拉取游标：持久化 db.meta（pb_cursor:<table>，由适配器维护；全局 cursor 仅为展示/兼容保留）
 * 多标签页：同一浏览器多开时用 IndexedDB 排他锁串行化（engineLock），拿不到锁的标签页跳过本轮
 *
 * ## 连通性是独立的一条线（本次修复）
 *
 * 引擎原先只在两种情况翻 offline：`navigator.onLine === false`，或某一轮同步抛异常。
 * 但**没有待推送数据时根本不会发请求** —— 于是同步中心早就连不上了，顶栏还一直显示
 * 「已同步」（假绿）。所以连通性由 `refreshConnectivity()` **独立探测**，
 * 与「恰好有东西要同步」解耦；探测结果写进 store，展示层统一走 `src/sync/badge.ts`。
 */
const CURSOR_KEY = 'sync_cursor'
const TOMBSTONE_CLEANUP_KEY = 'tombstone_cleanup_at'
const TOMBSTONE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000

/** 心跳周期：同步与连通性探测共用同一节拍 */
const HEARTBEAT_MS = 30_000
/** 写入后防抖：合并密集写入，避免每次落库都推一轮 */
const WRITE_DEBOUNCE_MS = 2_000

class SyncEngine {
  private adapter: SyncAdapter = pocketBaseAdapter
  private timer: ReturnType<typeof setInterval> | null = null
  /** 连通性探测定时器 —— 与同步心跳同节拍，但语义独立（见文件头注释） */
  private probeTimer: ReturnType<typeof setInterval> | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null
  private cursor = 0
  /** 单页内互斥：防止 30s 心跳与写入防抖在同一标签页内重入 */
  private running = false
  /** 连通性探测的互斥：探测比同步快得多，但仍避免慢网下请求堆叠 */
  private probing = false

  setAdapter(adapter: SyncAdapter) {
    this.adapter = adapter
  }

  start() {
    if (this.timer) return
    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    // 后台标签页回到前台立即对齐一次：降低被浏览器节流打断后的数据滞后（Issue #130）
    document.addEventListener('visibilitychange', this.onVisible)
    this.timer = setInterval(() => void this.syncNow('heartbeat'), HEARTBEAT_MS)
    this.probeTimer = setInterval(() => void this.refreshConnectivity(), HEARTBEAT_MS)
    // 启动即探一次：用户打开应用第一眼就该看到真实连接状态，而不是先灰 30 秒
    void this.refreshConnectivity()
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
    document.removeEventListener('visibilitychange', this.onVisible)
    if (this.timer) clearInterval(this.timer)
    if (this.probeTimer) clearInterval(this.probeTimer)
    this.timer = null
    this.probeTimer = null
  }

  /** repository 写入后调用：防抖 2s 合并推送 */
  requestSync() {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.syncNow('write'), WRITE_DEBOUNCE_MS)
  }

  /**
   * 探测同步中心连通性并写入 store。
   *
   * 为什么必须独立于 syncNow：只有「恰好有东西要同步」时才发请求的话，
   * 服务器早就没了而徽章依然显示正常。连通性是独立事实，必须独立探测。
   * 设置页保存同步配置后也会主动调用它，避免等满一个心跳周期。
   */
  async refreshConnectivity(): Promise<void> {
    if (this.probing) return
    this.probing = true
    try {
      let serverUrl = ''
      try {
        serverUrl = await getSyncServerUrl()
      } catch (err) {
        // 读设置失败不致命：按「未配置」处理（见下面的 none 分支）
        console.warn('[sync] 读取同步配置失败', err)
      }

      const target = classifySyncTarget(serverUrl)
      const store = useSyncStore.getState()

      if (target === 'none') {
        // 没配同步中心：连探测都不必发，直接如实记为「仅本机」
        store.setConnectivity({
          serverUrl: '',
          target,
          reachability: 'unknown',
          lastCheckedAt: Date.now(),
        })
        return
      }

      // 先标「检测中」：首次探测最长 5s，这期间徽章不该撒谎说是「已连接」
      store.setConnectivity({
        serverUrl,
        target,
        reachability: 'checking',
        lastCheckedAt: store.lastCheckedAt,
      })

      const result = await probeSyncCenter(serverUrl)
      const next = useSyncStore.getState()
      next.setConnectivity({
        serverUrl,
        target,
        reachability: result.ok ? 'online' : 'offline',
        lastCheckedAt: Date.now(),
      })
      next.setLastError(result.ok ? null : result.error)
    } finally {
      this.probing = false
    }
  }

  async syncNow(_reason: string) {
    const store = useSyncStore.getState()
    // 同一标签页内已有同步在跑：直接跳过（不排队，本轮变更由下一轮心跳/防抖覆盖）
    if (this.running) return
    if (!navigator.onLine) {
      store.setStatus('offline')
      return
    }
    // 跨标签页排他：同一浏览器多开时只有一个标签页真正同步，其余让路（拿不到锁不打状态，
    // 避免把「另一标签页正在同步」误显示为同步失败）；Web Locks 不可用时自动降级为放行
    await withExclusiveSync(() => this.runSync())
  }

  /** 单轮同步实体（调用方负责并发/跨标签页互斥） */
  private async runSync() {
    const store = useSyncStore.getState()
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
      const done = useSyncStore.getState()
      done.setStatus('synced')
      done.setLastSync(Date.now())
      // 这一轮真的跑通了 ⇒ 清掉上一次的失败原因（否则悬浮提示会一直挂着历史错误）
      done.setLastError(null)
      // 3. 墓碑物理清理：已配置同步时每天一次（两端各自清理 30 天前软删除）
      if (isSyncConfigured()) {
        const lastCleanup = await db.meta.get(TOMBSTONE_CLEANUP_KEY)
        const last = typeof lastCleanup?.value === 'number' ? lastCleanup.value : 0
        if (Date.now() - last > TOMBSTONE_CLEANUP_INTERVAL) {
          await cleanupTombstones()
          await db.meta.put({ key: TOMBSTONE_CLEANUP_KEY, value: Date.now() })
        }
      }
    } catch (err) {
      // 失败时按队列实际积压如实显示：有未传 → offline（待同步徽章），无未传 → synced
      const s = useSyncStore.getState()
      s.setLastError(err instanceof Error ? err.message : '同步失败')
      // 只有「网络层面连不上」才动连通性：401/验证失败说明中心是活的，
      // 报成「无法连接」会把用户引去查网络，而真正的问题在凭据。
      if (isNetworkFailure(err) && s.target !== 'none') {
        s.setConnectivity({
          serverUrl: s.serverUrl,
          target: s.target,
          reachability: 'offline',
          lastCheckedAt: Date.now(),
        })
      }
      const pendingCount = await db.syncQueue.filter((p) => !p.sentAt).count()
      s.setPending(pendingCount)
      s.setStatus(!navigator.onLine || pendingCount > 0 ? 'offline' : 'synced')
    } finally {
      this.running = false
    }
  }

  private onOnline = () => {
    void this.refreshConnectivity()
    void this.syncNow('online')
  }

  private onOffline = () => {
    // 浏览器判定断网 ⇒ 同步中心必然不可达。不等探测结果，立刻如实反映，
    // 否则会出现「浏览器已知断网、徽章还说已连接」这个最多 30s 的窗口。
    const s = useSyncStore.getState()
    s.setStatus('offline')
    if (s.target !== 'none') {
      s.setConnectivity({
        serverUrl: s.serverUrl,
        target: s.target,
        reachability: 'offline',
        lastCheckedAt: Date.now(),
      })
    }
  }

  private onVisible = () => {
    if (document.visibilityState !== 'visible') return
    void this.refreshConnectivity()
    void this.syncNow('visible')
  }
}

export const syncEngine = new SyncEngine()

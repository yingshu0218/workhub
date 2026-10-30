import { db } from '@/db/db'
import { listTrash, purgeTrashRecord } from '@/repositories/trash'

/**
 * 回收站保留期清扫（2026-10-30）。
 *
 * ## 为什么必须独立存在
 *
 * 现有的墓碑清理是 `pocketbaseAdapter.cleanupTombstones()`，它**只在已配置同步时**才跑
 * （`engine.ts` 里被 `isSyncConfigured()` 门着）。于是本地模式（没连服务器）的用户，
 * 回收站里的东西永远不会到期消失 —— 与「7/15/30 天自动彻底删除」的承诺直接矛盾。
 *
 * ## 两条硬约束
 *
 * 1. **逐条 try/catch**：`purgeTrashRecord` 内部先推墓碑再物理删，推送失败会抛。
 *    批量清理里一条失败不能中断整轮，否则离线用户永远清不完。
 * 2. **24h 节流**：走 `db.meta`，与 `engine.ts` 的墓碑清理同一套写法；不做成每次启动全表扫。
 */

const SWEEP_AT_KEY = 'trash_sweep_at'
const SWEEP_INTERVAL_MS = 24 * 3600 * 1000
const DAY_MS = 24 * 3600 * 1000
export const DEFAULT_RETENTION_DAYS = 30

/**
 * 清掉超过保留期的回收站条目，返回物理删除条数。
 *
 * 保留期读 `settings.security.trashRetentionDays`（7/15/30，缺省 30）——
 * 与回收站页面展示的「剩余 N 天」必须是同一个来源，否则展示与行为会打架。
 */
export async function sweepExpiredTrash(): Promise<number> {
  const now = Date.now()

  const last = await db.meta.get(SWEEP_AT_KEY)
  if (typeof last?.value === 'number' && now - last.value < SWEEP_INTERVAL_MS) return 0

  let purged = 0
  try {
    const settings = await db.settings.get('singleton')
    const days = settings?.security?.trashRetentionDays ?? DEFAULT_RETENTION_DAYS
    const cutoff = now - days * DAY_MS

    const items = await listTrash()
    for (const item of items) {
      // deletedAt 缺失的老墓碑：listTrash 已回退用 updatedAt 近似，这里只管比较
      if (item.deletedAt >= cutoff) continue
      try {
        await purgeTrashRecord(item.table, item.id)
        purged += 1
      } catch (e) {
        // 单条失败（离线/401/子项被占用）不该中断整轮 —— 下一轮继续
        console.warn('[trash] 到期清理失败，已跳过', item.table, item.id, e)
      }
    }
  } finally {
    // 无论成功与否都记节流时间：避免"一直失败 → 每次启动都重试"把日志刷爆
    await db.meta.put({ key: SWEEP_AT_KEY, value: now })
  }
  return purged
}

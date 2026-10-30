import dayjs from 'dayjs'
import { db } from '@/db/db'
import { listRemoteIds } from '@/sync/pocketbaseAdapter'
import { SYNC_TABLES } from '@/sync/remoteNormalize'

/**
 * 对账：把「本地以为已同步、服务端却没有」的孤儿记录送进回收站（2026-10-30）。
 *
 * ## 为什么必须有它
 *
 * 同步是 LWW + 增量拉取，**从不做「本地有、远端没有」的核对**。于是：
 * - 演示种子（标记 `synced:1` 却从未上传）永远留在我本地，删不掉；
 * - 一端删了并在 30 天内推了墓碑，另一端若长期离线没收到墓碑，那行也会永远留着。
 * 两者本质是同一个问题：**没有事实源**。这条规则补上：远端没有 ⇒ 本地这份是孤儿。
 *
 * ## 判据只认一条：`synced === 1 && 远端无此 id`
 *
 * - `synced === 0` 是**还没推上去的真实新数据**，永远不动；
 * - `deleted === 1` 已经是墓碑，跳过（回收站里本来就有）。
 *
 * ## 孤儿不物理删，走「软删进回收站」
 *
 * 写 `deleted=1 / deletedAt`，回收站可见、可恢复（`canRestore` 不依赖 `trashSnapshot`，
 * 见 `trash.ts:212`）。**不写 trashSnapshot**：写空快照反而可能让 `restoreTrashRecord`
 * 回填出错。**不 enqueue**：远端本就没有这条，推删除只是噪音。
 *
 * ## 只跑一次
 *
 * `db.meta.reconcile_done_at` 标记。若某张表拉取失败则**不写标记**，留给下一轮重试 ——
 * 否则一次网络抖动就会被永久记成"对账完成"。
 */

const DONE_KEY = 'reconcile_done_at'
export const RECONCILE_BATCH_REASON = 'reconcile' as const

export async function reconcileOrphansOnce(): Promise<number> {
  const done = await db.meta.get(DONE_KEY)
  if (done) return 0

  const now = Date.now()
  const members: Array<{ table: string; id: string }> = []
  let failed = false

  for (const table of SYNC_TABLES) {
    let remote: Set<string>
    try {
      remote = await listRemoteIds(table)
    } catch (e) {
      // 单表失败（离线/401/权限）不阻断其余表，但也不写完成标记
      console.warn('[reconcile] 拉取远端 id 失败，本轮跳过该表：', table, e)
      failed = true
      continue
    }

    const rows = (await db.table(table).toArray()) as Array<{
      id: string
      synced?: number
      deleted?: number
      rev?: number
    }>
    for (const r of rows) {
      if (r.deleted === 1) continue
      if (r.synced !== 1) continue
      if (remote.has(r.id)) continue
      await db.table(table).update(r.id, {
        deleted: 1,
        deletedAt: now,
        updatedAt: now,
        rev: (r.rev ?? 0) + 1,
      })
      members.push({ table, id: r.id })
    }
  }

  if (members.length > 0) {
    // 批次名由**事件时间**生成（用户要求：系统按事件重命名），回收站据此分组展示
    await db.trashBatches.put({
      id: `rb-${now}`,
      label: `冲突删除 · ${dayjs(now).format('YYYY-MM-DD HH:mm')}`,
      reason: RECONCILE_BATCH_REASON,
      createdAt: now,
      members,
    })
  }

  if (!failed) await db.meta.put({ key: DONE_KEY, value: now })
  return members.length
}

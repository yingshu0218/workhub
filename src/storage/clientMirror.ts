import { db } from '@/db/db'
import { SYNC_TABLES } from '@/sync/remoteNormalize'
import { clientSession, requireClientSession, type ClientSession } from './clientSession'
import type { Row } from '@/commands/core'

export interface MirrorChange {
  table: string
  id: string
  row: Row | null
  file?: { id: string; name: string }
}
export interface SyncBatch {
  mode: 'snapshot' | 'delta'
  generation: string
  schema: number
  owner: string
  watermark: number
  changes: MirrorChange[]
  nextCursor: string
  complete: boolean
  readCount: number
}
export const MIRROR_CURSOR = 'client:cursor'
export function notifyMirrorChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('workhub:changed'))
}
/** 缓存事务与游标必须共提交，缺页永远不发布半套首轮快照。 */
export async function publishMirror(
  changes: MirrorChange[],
  context: ClientSession,
  cursor?: string,
  snapshot = false,
  expectedCursor?: string,
  watermark?: number,
  expectedMirrorVersion?: number,
) {
  requireClientSession(context)
  const target = db
  let changed = changes.length > 0 || snapshot
  await target.transaction(
    'rw',
    [...SYNC_TABLES.map((t) => target.table(t)), target.meta],
    async () => {
      requireClientSession(context)
      const prior = await target.meta.get(MIRROR_CURSOR)
      changed ||= !!cursor && prior?.value !== cursor
      const completed = await target.meta.get('client:watermark')
      if (!cursor && completed) {
        if (watermark === undefined)
          throw new Error('RECEIPT_WATERMARK_REQUIRED: 回执缺少水位，请同步重建缓存')
        if (watermark <= Number(completed.value)) {
          changed = false
          return
        }
      }
      if (expectedCursor !== undefined && prior?.value !== expectedCursor)
        throw new Error('STALE_SYNC_BATCH: 已由较新批次更新')
      if (
        snapshot &&
        expectedMirrorVersion !== undefined &&
        Number((await target.meta.get('client:mirrorVersion'))?.value || 0) !==
          expectedMirrorVersion
      )
        throw new Error('SNAPSHOT_RESTART_REQUIRED: 快照期间镜像已被提交回执更新')
      if (
        snapshot &&
        Number((await target.meta.get('client:latestCommit'))?.value || 0) > Number(watermark ?? 0)
      )
        throw new Error('SNAPSHOT_RESTART_REQUIRED: 快照期间本端已有新提交')
      if (snapshot) {
        // 活动镜像只在全部快照完成后替换；旧库、旧草稿和旧队列完全不参与。
        for (const table of SYNC_TABLES) await target.table(table).clear()
        // 同世代删除登记跨修复快照保留，旧回执不能趁重建复活对象。
      }
      for (const change of changes) {
        if (!(SYNC_TABLES as readonly string[]).includes(change.table))
          throw new Error('INVALID_SYNC_TABLE')
        const table = target.table(change.table),
          mark = 'purged:' + change.table + '/' + change.id
        if (!change.row) {
          await table.delete(change.id)
          await target.meta.put({ key: mark, value: true })
          continue
        }
        if (await target.meta.get(mark)) continue
        const old = (await table.get(change.id)) as Row | undefined
        if (old && Number(old.rev || 0) > Number(change.row.rev || 0)) continue
        const row = { ...change.row, ...(change.file ? { remoteFile: change.file } : {}) }
        if (change.table === 'attachments' && old?.blob && old.rev === row.rev)
          Object.assign(row, { blob: old.blob })
        await table.put(row)
      }
      if (watermark !== undefined && !cursor)
        await target.meta.put({
          key: 'client:latestCommit',
          value: Math.max(
            Number((await target.meta.get('client:latestCommit'))?.value || 0),
            watermark,
          ),
        })
      if (!cursor)
        await target.meta.put({
          key: 'client:mirrorVersion',
          value: Number((await target.meta.get('client:mirrorVersion'))?.value || 0) + 1,
        })
      if (cursor) {
        await target.meta.put({ key: MIRROR_CURSOR, value: cursor })
        if (watermark !== undefined)
          await target.meta.put({ key: 'client:watermark', value: watermark })
      }
      if (changed) {
        const keys = await target.meta.toCollection().primaryKeys()
        await target.meta.bulkDelete(keys.filter((k) => String(k).startsWith('query:')))
      }
      await target.meta.delete('client:stage')
    },
  )
  requireClientSession(context)
  if (changed) notifyMirrorChanged()
}
export async function applyClientReceipt(
  receipt: { generation?: string; sequence?: number; changes?: MirrorChange[] },
  context = clientSession(),
) {
  if (!context || !receipt.changes) return
  if (receipt.generation !== context.generation)
    throw new Error('RECOVERY_REVIEW_REQUIRED: 回执世代不同')
  await publishMirror(receipt.changes, context, undefined, false, undefined, receipt.sequence)
}

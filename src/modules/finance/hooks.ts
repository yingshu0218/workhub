import type { Attachment } from '@/db/db'
import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'
import { syncEngine } from '@/sync/engine'
import type { SyncMeta } from '@/db/types'

/**
 * 财务模块领域查询 Hook（附件读写在 hooks 层封装，组件不直碰 Dexie）
 */

const EMPTY_LIST: Attachment[] = []

/** 某笔交易的附件列表（凭证存根） */
export function useTransactionAttachments(transactionId: string | undefined): Attachment[] {
  const list = useQuery<Attachment[]>(
    () =>
      transactionId
        ? db.attachments.where('refId').equals(transactionId).toArray()
        : Promise.resolve(EMPTY_LIST),
    [transactionId],
  )
  return list ?? EMPTY_LIST
}

/** 某条记录的附件计数角标（count() 只走索引计数，不反序列化 Blob） */
export function useAttachmentCount(refId: string | undefined): number {
  const count = useQuery<number>(
    () =>
      refId
        ? db.attachments.where('refId').equals(refId).count()
        : Promise.resolve(0),
    [refId],
  )
  return count ?? 0
}

/**
 * 交易级联删除：单 Dexie 事务覆盖 transactions / attachments / syncQueue 三表，
 * 任一步失败整体回滚。语义：
 * 1. 软删交易（盖章 + 入队 delete）
 * 2. 软删该交易全部附件存根（盖章 + 入队 delete）
 * 交易不存在时静默返回（幂等）。
 */
export async function deleteTransactionCascade(txnId: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', [db.transactions, db.attachments, db.syncQueue], async () => {
    const prev = await db.transactions.get(txnId)
    if (!prev || prev.deleted) return

    await db.transactions.update(txnId, {
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
    })
    await db.syncQueue.add({
      table: 'transactions',
      recordId: txnId,
      op: 'delete',
      createdAt: now,
    })

    const atts = await db.attachments.where('refId').equals(txnId).toArray()
    for (const att of atts) {
      const stamped = att as Attachment & Partial<SyncMeta>
      await db.attachments.update(att.id, {
        deleted: 1,
        updatedAt: now,
        rev: (stamped.rev ?? 0) + 1,
      } as unknown as Partial<Attachment>)
      await db.syncQueue.add({
        table: 'attachments',
        recordId: att.id,
        op: 'delete',
        createdAt: now,
      })
    }
  })
  syncEngine.requestSync()
}

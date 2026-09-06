import type { Attachment } from '@/db/db'
import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'

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

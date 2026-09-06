import type { Attachment } from '@/db/db'
import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'

/**
 * 财务模块领域查询 Hook（附件读写在 hooks 层封装，组件不直碰 Dexie）
 */

const EMPTY_LIST: Attachment[] = []
const EMPTY_COUNTS: Map<string, number> = new Map()

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

/** 全表附件计数（refId → 笔数），供流水列表渲染附件数角标 */
export function useAttachmentCounts(): Map<string, number> {
  const counts = useQuery<Map<string, number>>(async () => {
    const all = await db.attachments.toArray()
    const map = new Map<string, number>()
    for (const a of all) map.set(a.refId, (map.get(a.refId) ?? 0) + 1)
    return map
  }, [])
  return counts ?? EMPTY_COUNTS
}

import type { Attachment } from '@/db/db'
import { db } from '@/db/db'
import { storage } from '@/storage'

import { useQuery } from '@/queries/hooks'
import type { Ledger, Transaction } from '@/db/types'

/**
 * 财务模块领域查询 Hook（附件读写在 hooks 层封装，组件不直碰 Dexie）
 */

const EMPTY_LIST: Attachment[] = []

/**
 * 某笔交易的存活附件（软删已过滤）。
 *
 * `deleted` 过滤不能省：附件是**软删**表 —— `deleteTransactionCascade` 只置 `deleted=1`，
 * 记录仍留在库里；跨设备传播删除与 pull 回来的远端删除也走同一形状。
 * 直查 `refId` 会把已删存根一并返回，表现为「删了凭证，附件仍挂在别的入口上」。
 * 缺 `deleted` 字段的存量记录按「未删除」处理（`!undefined === true`），不会误判成已删。
 *
 * 抽成模块级函数而不是内联进 hook：UI、单测与后续任何读入口共用同一实现
 * （与 `deleteTodoCascade` 同款纪律），「软删过滤」这条语义才有可断言的真源。
 */
export function listTransactionAttachments(transactionId: string): Promise<Attachment[]> {
  return db.attachments.where('refId').equals(transactionId).filter((a) => !a.deleted).toArray()
}

/** 某条记录的存活附件数（先走 refId 索引收窄，再过滤软删；不反序列化 Blob） */
export function countAttachments(refId: string): Promise<number> {
  return db.attachments.where('refId').equals(refId).filter((a) => !a.deleted).count()
}

/** 某笔交易的附件列表（凭证存根） */
export function useTransactionAttachments(transactionId: string | undefined): Attachment[] {
  const list = useQuery<Attachment[]>(
    () =>
      transactionId ? listTransactionAttachments(transactionId) : Promise.resolve(EMPTY_LIST),
    [transactionId],
  )
  return list ?? EMPTY_LIST
}

/** 某条记录的附件计数角标 */
export function useAttachmentCount(refId: string | undefined): number {
  const count = useQuery<number>(
    () => (refId ? countAttachments(refId) : Promise.resolve(0)),
    [refId],
  )
  return count ?? 0
}

/**
 * 交易级联删除：单事务覆盖 transactions / attachments / syncQueue 三表，
 * 任一步失败整体回滚。语义：
 * 1. 软删交易（盖章 + 入队 delete）
 * 2. 软删该交易全部附件存根（盖章 + 入队 delete）
 * 交易不存在或已删时静默返回（幂等）。
 *
 * ⚠️ 写入经 `storage.transaction`（StorageAdapter 原语），不直写 Dexie
 * —— 审计 P1（2026-10-21）：模块直写 `db.transaction` 的 30 处不会随存储适配器迁移。
 */
export async function deleteTransactionCascade(txnId: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['transactions', 'attachments', 'syncQueue'], async (tx) => {
    const prev = await tx.get<Transaction>('transactions', txnId)
    if (!prev || prev.deleted) return

    await tx.update('transactions', txnId, {
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
    })
    await tx.enqueue('transactions', txnId, 'delete', now)

    const atts = (await tx.list<Attachment>('attachments')).filter((a) => a.refId === txnId)
    for (const att of atts) {
      await tx.update('attachments', att.id, {
        deleted: 1,
        updatedAt: now,
        rev: (att.rev ?? 0) + 1,
      })
      await tx.enqueue('attachments', att.id, 'delete', now)
    }
  })
  storage.requestSync()
}

// ===== 账本左侧树（数据层与 todo 自定义清单同款事务纪律） =====

/** 新建账本的排序尾值 */
export async function nextLedgerSortOrder(): Promise<number> {
  const all = await db.ledgers.toArray()
  return all.filter((l) => !l.deleted).length
}

/** 拖拽排序：按传入的 id 顺序重写 sortOrder（事务 + 入同步队列，同 todoLists） */
export async function reorderLedgers(orderedIds: string[]): Promise<void> {
  const now = Date.now()
  await storage.transaction(['ledgers', 'syncQueue'], async (tx) => {
    const all = await tx.list<Ledger>('ledgers')
    for (let i = 0; i < orderedIds.length; i++) {
      const l = all.find((x) => x.id === orderedIds[i])
      if (!l || l.deleted || l.sortOrder === i) continue
      await tx.put('ledgers', { ...l, sortOrder: i, updatedAt: now, rev: l.rev + 1 })
      await tx.enqueue('ledgers', l.id, 'upsert', now)
    }
  })
  storage.requestSync()
}

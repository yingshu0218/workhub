import type { Attachment } from '@/db/db'
import { db } from '@/db/db'
import { nextSortOrder, reorderBySortOrder } from '@/repositories/sortOrder'

import { useQuery } from '@/queries/hooks'

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
 * 交易级联删除（保存凭证时同事务清附件存根）。
 *
 * ⚠️ **实现已下沉到 `@/repositories`（2026-10-21）**：级联语义属落库口径，与
 * `deleteCustomerCascade` / `deleteHabitCascade` 同处才谈得上「单一事实源」；
 * 本文件带 React 查询钩子，agentOps 引用它会被绑到 UI 层。这里只做 re-export，
 * UI / 测试的导入路径保持不变，UI 与 AI 走同一条落库路径。
 */
export { deleteTransactionCascade } from '@/repositories'

// ===== 账本左侧树（数据层与 todo 自定义清单同款事务纪律） =====

/** 新建账本的排序尾值（收口实现：max+1，非 length —— 见 repositories/sortOrder.ts） */
export async function nextLedgerSortOrder(): Promise<number> {
  return nextSortOrder('ledgers')
}

/** 拖拽排序：按传入的 id 顺序重写 sortOrder（收口实现，见 repositories/sortOrder.ts） */
export async function reorderLedgers(orderedIds: string[]): Promise<void> {
  await reorderBySortOrder('ledgers', orderedIds)
}

import { db } from '@/db/db'
import { syncEngine } from '@/sync/engine'
import { createRepository, newId } from './repository'
import type { PutInput } from './repository'
import type {
  Customer,
  Interaction,
  Ledger,
  Transaction,
  Todo,
  Note,
  QuickNote,
  Habit,
  HabitLog,
  Trophy,
} from '@/db/types'
import type { SyncMeta } from '@/db/types'
import type { Attachment } from '@/db/db'

/** 模块统一从这里拿仓储实例，不直接触碰 Dexie */
export const customerRepo = createRepository<Customer>('customers')
export const interactionRepo = createRepository<Interaction>('interactions')
export const ledgerRepo = createRepository<Ledger>('ledgers')
export const transactionRepo = createRepository<Transaction>('transactions')
export const todoRepo = createRepository<Todo>('todos')
export const noteRepo = createRepository<Note>('notes')
export const quickNoteRepo = createRepository<QuickNote>('quickNotes')
export const habitRepo = createRepository<Habit>('habits')
export const habitLogRepo = createRepository<HabitLog>('habitLogs')
export const trophyRepo = createRepository<Trophy>('trophies')
export const attachmentRepo = createRepository<Attachment>('attachments')

export { newId }

/** 习惯打卡确定性 id：同日同习惯恒为同一条记录（幂等，杜绝重复打卡/幽灵记录） */
export function habitLogId(habitId: string, date: string): string {
  return `hl-${habitId}-${date}`
}

/**
 * 交易 + 附件存根原子落库：单 Dexie 事务覆盖 transactions / attachments / syncQueue 三表，
 * 任一步失败整体回滚（避免"交易已落库而附件写入失败"的半成品数据）。
 * 每条记录统一盖章 updatedAt/rev/deleted 并入同步队列，语义与 repository.put 一致。
 */
export async function saveTransactionWithAttachments(
  txn: PutInput<Transaction>,
  attachments: PutInput<Attachment>[] = [],
): Promise<string> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.transactions, db.attachments, db.syncQueue],
    async () => {
      const putStamped = async <T extends { id: string }>(
        tableName: 'transactions' | 'attachments',
        record: T & Partial<SyncMeta>,
      ) => {
        const table = db[tableName] as unknown as {
          get(id: string): Promise<(T & SyncMeta) | undefined>
          put(value: T): Promise<string>
        }
        const prev = await table.get(record.id)
        await table.put({
          ...record,
          updatedAt: now,
          rev: (prev?.rev ?? 0) + 1,
          deleted: 0 as const,
        } as T)
        await db.syncQueue.add({
          table: tableName,
          recordId: record.id,
          op: 'upsert',
          createdAt: now,
        })
      }
      await putStamped('transactions', txn as Transaction & Partial<SyncMeta>)
      for (const att of attachments) {
        await putStamped('attachments', att as Attachment & Partial<SyncMeta>)
      }
    },
  )
  syncEngine.requestSync()
  return txn.id
}

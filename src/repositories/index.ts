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

/**
 * 沟通日志 + 客户最近联系时间原子落库：单 Dexie 事务覆盖 interactions / customers / syncQueue 三表，
 * 任一步失败整体回滚（避免"日志已落库而 lastContactAt 未刷新"的数据不一致）。
 * 客户侧先 get 最新记录再仅 update lastContactAt 单字段（禁止整记录展开覆盖并发写入的其他字段）。
 */
export async function saveInteractionAndTouchCustomer(
  interaction: PutInput<Interaction>,
  customerId: string,
): Promise<string> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.interactions, db.customers, db.syncQueue],
    async () => {
      const interactionTable = db.interactions as unknown as {
        get(id: string): Promise<(Interaction & SyncMeta) | undefined>
        put(value: Interaction): Promise<string>
      }
      const prevInteraction = await interactionTable.get(interaction.id)
      await interactionTable.put({
        ...interaction,
        updatedAt: now,
        rev: (prevInteraction?.rev ?? 0) + 1,
        deleted: 0 as const,
      } as Interaction)
      await db.syncQueue.add({
        table: 'interactions',
        recordId: interaction.id,
        op: 'upsert',
        createdAt: now,
      })

      const prevCustomer = await db.customers.get(customerId)
      if (!prevCustomer || prevCustomer.deleted) {
        // 客户不存在/已删除：抛错让整个事务回滚，杜绝孤儿日志
        throw new Error(`saveInteractionAndTouchCustomer: customer ${customerId} not found`)
      }
      await db.customers.update(customerId, {
        lastContactAt: interaction.at,
        updatedAt: now,
        rev: prevCustomer.rev + 1,
      })
      await db.syncQueue.add({
        table: 'customers',
        recordId: customerId,
        op: 'upsert',
        createdAt: now,
      })
    },
  )
  syncEngine.requestSync()
  return interaction.id
}

/**
 * 客户级联删除：单 Dexie 事务覆盖 customers / interactions / transactions / todos / syncQueue 五表，
 * 任一步失败整体回滚。语义：
 * 1. 软删客户（盖章 + 入队 delete）
 * 2. 软删该客户全部沟通日志（盖章 + 入队 delete）
 * 3. 解绑该客户名下交易/待办：customerId 置 undefined（盖章 + 入队 upsert）
 * 客户不存在时静默返回（幂等），其余记录已属事务内一致状态。
 */
export async function deleteCustomerCascade(customerId: string): Promise<void> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.customers, db.interactions, db.transactions, db.todos, db.syncQueue],
    async () => {
      const prevCustomer = await db.customers.get(customerId)
      if (!prevCustomer || prevCustomer.deleted) return

      await db.customers.update(customerId, {
        deleted: 1,
        updatedAt: now,
        rev: prevCustomer.rev + 1,
      })
      await db.syncQueue.add({
        table: 'customers',
        recordId: customerId,
        op: 'delete',
        createdAt: now,
      })

      const interactions = await db.interactions
        .where('customerId')
        .equals(customerId)
        .filter((it) => !it.deleted)
        .toArray()
      for (const it of interactions) {
        await db.interactions.update(it.id, {
          deleted: 1,
          updatedAt: now,
          rev: it.rev + 1,
        })
        await db.syncQueue.add({
          table: 'interactions',
          recordId: it.id,
          op: 'delete',
          createdAt: now,
        })
      }

      const txns = await db.transactions
        .where('customerId')
        .equals(customerId)
        .toArray()
      for (const txn of txns) {
        if (txn.deleted) continue
        await db.transactions.update(txn.id, {
          customerId: undefined,
          updatedAt: now,
          rev: txn.rev + 1,
        })
        await db.syncQueue.add({
          table: 'transactions',
          recordId: txn.id,
          op: 'upsert',
          createdAt: now,
        })
      }

      const todos = await db.todos
        .where('customerId')
        .equals(customerId)
        .toArray()
      for (const todo of todos) {
        if (todo.deleted) continue
        await db.todos.update(todo.id, {
          customerId: undefined,
          updatedAt: now,
          rev: todo.rev + 1,
        })
        await db.syncQueue.add({
          table: 'todos',
          recordId: todo.id,
          op: 'upsert',
          createdAt: now,
        })
      }
    },
  )
  syncEngine.requestSync()
}

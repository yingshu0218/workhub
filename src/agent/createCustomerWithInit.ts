import { db } from '@/db/db'
import { newId } from '@/repositories'
import { syncEngine } from '@/sync/engine'
import type { Customer, Interaction } from '@/db/types'

/**
 * 客户建档 + 跨模块关联初始化 —— 从 modules/crm/hooks.ts 下沉（§9.6 不变式：
 * AI 层只依赖 repositories + shared，不反向依赖业务模块 hook）。
 *
 * 本文件是搬迁的中间落点：迁移后 modules/crm/hooks.ts re-export 此实现，
 * 待第 2 步「事件下沉」时并入 repositories/index.ts 统一收口。
 * 逻辑与原实现逐行等价（单事务五表，任一步失败整体回滚）。
 */
export interface CustomerInitOptions {
  /** 创建一条 opening 沟通日志（类型=拜访） */
  openingLog?: boolean
  /** 关联已有交易：把该交易的 customerId 指向新客户 */
  linkTransactionId?: string
}

export async function createCustomerWithInit(
  customer: Customer,
  opts: CustomerInitOptions = {},
): Promise<void> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.customers, db.todos, db.interactions, db.transactions, db.syncQueue],
    async () => {
      const prev = await db.customers.get(customer.id)
      await db.customers.put({
        ...customer,
        updatedAt: now,
        rev: (prev?.rev ?? 0) + 1,
        deleted: 0 as const,
      } as Customer)
      await db.syncQueue.add({
        table: 'customers',
        recordId: customer.id,
        op: 'upsert',
        createdAt: now,
      })

      if (opts.openingLog) {
        const itx = {
          id: newId('itx'),
          customerId: customer.id,
          type: '拜访' as const,
          content: '客户建档 · 首次建立联系（opening）',
          at: now,
        }
        await db.interactions.put({
          ...itx,
          updatedAt: now,
          rev: 1,
          deleted: 0 as const,
        } as Interaction)
        await db.syncQueue.add({
          table: 'interactions',
          recordId: itx.id,
          op: 'upsert',
          createdAt: now,
        })
      }

      if (opts.linkTransactionId) {
        const txn = await db.transactions.get(opts.linkTransactionId)
        if (txn && !txn.deleted) {
          await db.transactions.update(txn.id, {
            customerId: customer.id,
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
      }
    },
  )
  syncEngine.requestSync()
}

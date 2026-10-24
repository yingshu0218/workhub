import { storage } from '@/storage'
import { toLinkFieldPatch } from '@/repositories'
import { txnTodoIds } from '@/modules/finance/links'
import type { Todo, Transaction, TrashSnapshot, Note } from '@/db/types'

/**
 * 待办级联删除（Issue #148 后续 · #140 审计留档项的收口）：
 * 软删待办的同时，把 `transactions.todoIds` 里指向它的关联**解绑**。
 *
 * 为什么必须级联（此前靠读取端兜底，属隐性欠账）：
 * `transactions.todoIds` 是弱引用数组，待办被删后读取端 `links.ts` 的
 * `pruneTxnLinkIds` / 存活实体过滤会把它滤掉，所以界面不炸 —— 但库里留下悬挂 id，
 * 后续任何**按 todoIds 直查**的路径（导出、统计、Agent 读投影）都会命中幽灵引用。
 * 与 `deleteCustomerCascade` / `deleteProjectCascade` 同款纪律：删除即解绑，
 * 悬挂由写入端消除，而不是全仓指望每一处读取都记得过滤。
 *
 * 单 Dexie 事务覆盖 todos / transactions / syncQueue，任一步失败整体回滚；
 * 待办不存在或已删除时静默返回（幂等）。
 *
 * @returns 解绑的流水条数（供 Agent 工具回传副作用清单 `sideEffects.unlinked`）
 */
export async function deleteTodoCascade(todoId: string): Promise<number> {
  const now = Date.now()
  let unlinked = 0
  await storage.transaction(['todos', 'transactions', 'notes', 'syncQueue'], async (tx) => {
    const prev = await tx.get<Todo>('todos', todoId)
    if (!prev || prev.deleted) return

    // transactions.todoIds 已数组化（Issue #140 v11）：按数组解绑，空数组不落键（toLinkFieldPatch）。
    // 不能写 `todoId: undefined` —— 既解不掉数组里的 id，还会按「双写不双读」留下永不读取的旧键。
    const txns = (await tx.list<Transaction>('transactions'))
      .filter((t) => !t.deleted)
      .filter((t) => txnTodoIds(t).includes(todoId))
    // 笔记里指向该待办的 mention 一并剪掉（2026-10-24 补漏，与客户/项目 cascade 同款）。
    // 渲染层有 EntityMissing 兜底不会崩，但「删除即解绑」是写入端纪律。
    const mentionedNotes = (await tx.list<Note>('notes')).filter(
      (n) => !n.deleted && (n.mentions ?? []).some((m) => m.type === 'todo' && m.id === todoId),
    )
    const trashSnapshot: TrashSnapshot = {
      children: [],
      links: [
        ...txns.map((t) => ({
          table: 'transactions' as const,
          id: t.id,
          field: 'todoIds',
          mode: 'append' as const,
          value: todoId,
        })),
        ...mentionedNotes.flatMap((n) =>
          (n.mentions ?? [])
            .filter((m) => m.type === 'todo' && m.id === todoId)
            .map((m) => ({
              table: 'notes' as const,
              id: n.id,
              field: 'mentions',
              mode: 'mention' as const,
              value: m,
            })),
        ),
      ],
    }

    await tx.update('todos', todoId, {
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot,
    })
    await tx.enqueue('todos', todoId, 'delete', now)

    for (const txn of txns) {
      await tx.update('transactions', txn.id, {
        ...toLinkFieldPatch('todoIds', txnTodoIds(txn).filter((id) => id !== todoId)),
        updatedAt: now,
        rev: txn.rev + 1,
      })
      await tx.enqueue('transactions', txn.id, 'upsert', now)
      unlinked++
    }

    for (const note of mentionedNotes) {
      await tx.update('notes', note.id, {
        mentions: (note.mentions ?? []).filter((m) => !(m.type === 'todo' && m.id === todoId)),
        updatedAt: now,
        rev: note.rev + 1,
      })
      await tx.enqueue('notes', note.id, 'upsert', now)
    }
  })
  storage.requestSync()
  return unlinked
}

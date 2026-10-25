import { storage } from '@/storage'
import { cascadeSoftDeleteLinks } from '@/repositories'
import type { Link, Todo, TrashSnapshot } from '@/db/types'

/**
 * 待办级联删除（Issue #148 后续 · #140 审计留档项的收口）：
 * 软删待办的同时，把指向它的关联（related / mention link）一并墓碑化。
 *
 * 为什么必须级联（此前靠读取端兜底，属隐性欠账）：关联是弱引用，待办被删后
 * 读取端的存活过滤会把它滤掉，界面不炸 —— 但库里留下悬挂引用，后续任何
 * 按关联直查的路径（导出、统计、Agent 读投影）都会命中幽灵。
 * 与 `deleteCustomerCascade` / `deleteProjectCascade` 同款纪律：删除即解绑，
 * 悬挂由写入端消除，而不是全仓指望每一处读取都记得过滤。
 *
 * 关联层 Phase 2（v15）后「解绑」= 墓碑化指向待办的 link
 * （cascadeSoftDeleteLinks，快照 cascadeLinkIds 留档、恢复时随待办复活）；
 * 此前「transactions.todoIds 数组解绑 + mode:'append' 快照」路径整体退役。
 *
 * 单 Dexie 事务覆盖 todos / links / syncQueue，任一步失败整体回滚；
 * 待办不存在或已删除时静默返回（幂等）。
 *
 * @returns 被解绑的流水关联数（供 Agent 工具回传副作用清单 `sideEffects.unlinked`；
 *   统计在墓碑化**之前**做 —— 删完就查不到了，恒为 0 是假报「无副作用」）
 */
export async function deleteTodoCascade(todoId: string): Promise<number> {
  const now = Date.now()
  let unlinked = 0
  await storage.transaction(['todos', 'links', 'syncQueue'], async (tx) => {
    const prev = await tx.get<Todo>('todos', todoId)
    if (!prev || prev.deleted) return

    // 统计先于删除：有多少笔流水的 related link 指向该待办（todo_deleteTodo 的 sideEffects）
    unlinked = (await tx.list<Link>('links')).filter(
      (l) =>
        !l.deleted &&
        l.kind === 'related' &&
        l.fromType === 'transactions' &&
        l.toType === 'todos' &&
        l.toId === todoId,
    ).length

    // 关联层钩子：指向待办的 link（related / mention）一并墓碑化，恢复时随待办复活
    const cascadeLinkIds = await cascadeSoftDeleteLinks(tx, [{ type: 'todos', id: todoId }], now)

    const trashSnapshot: TrashSnapshot = {
      children: [],
      links: [],
      ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
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
  })
  storage.requestSync()
  return unlinked
}

import { storage } from '@/storage'
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
  Workspace,
  ModuleConfig,
  RelationCategory,
  CustomerRelation,
  Project,
  ProjectMilestone,
} from '@/db/types'
import type { SyncMeta, TrashSnapshot } from '@/db/types'
import type { Attachment } from '@/db/db'
import type { Link } from '@/db/types'
import { eventBus } from '@/shared/eventBus'
import {
  cascadeSoftDeleteLinks,
  putLinkTx,
  syncMemberLinks,
  syncMentionLinks,
  syncRelatedLinks,
  syncRelationLinks,
  linkAtoms,
  linkRepo,
} from './links'
import { buildLinkId } from './linkId'
import type { TxnRelatedInput } from './links'
import { extractMentions } from '@/modules/notes/mentionParse'

/** 模块统一从这里拿仓储实例，不直接触碰 Dexie */
export const workspaceRepo = createRepository<Workspace>('workspaces')
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
export const todoListRepo = createRepository<import('@/db/types').TodoList>('todoLists')
export const noteFolderRepo = createRepository<import('@/db/types').NoteFolder>('noteFolders')
export const projectRepo = createRepository<import('@/db/types').Project>('projects')
export const projectMilestoneRepo =
  createRepository<import('@/db/types').ProjectMilestone>('projectMilestones')
export const attachmentRepo = createRepository<Attachment>('attachments')
export const moduleConfigRepo = createRepository<ModuleConfig>('moduleConfigs')
export const customerGroupRepo =
  createRepository<import('@/db/types').CustomerGroup>('customerGroups')

export { newId }
// 关联层（原子化一期）：模块统一从这里拿 links 的读写入口，与其它仓储同口径
export {
  linkRepo,
  buildLinkId,
  linkAtoms,
  unlinkAtoms,
  putLinkTx,
  syncMentionLinks,
  linksOf,
  linksTo,
  cascadeSoftDeleteLinks,
  reviveCascadeLinks,
} from './links'

/**
 * 笔记 + @提及原子落库（关联层 Phase 2）：笔记行与 mention links 单事务，
 * 盖章/入队与 repository.put 同款口径（含 restoredAt 粘性、deletedAt 清理）。
 * 提及从 markdown 运行时解析（mentionParse.extractMentions）—— mentions 字段已随
 * v15 迁 links，笔记行不再持有。UI（编辑器自动保存 / 速记 / 新建）与 agentOps
 * （note_createNote）都经此，禁止各写一份。
 */
export async function saveNoteWithMentions(
  note: PutInput<Note>,
  folderId?: string | null,
): Promise<string> {
  const now = Date.now()
  await storage.transaction(
    ['notes', 'links', 'customers', 'todos', 'ledgers', 'projects', 'noteFolders', 'syncQueue'],
    async (tx) => {
      const prev = await tx.get<Note>('notes', note.id)
      const reviving = prev?.deleted === 1
      const restoredAt = reviving ? now : (note.restoredAt ?? prev?.restoredAt)
      await tx.put('notes', {
        ...note,
        updatedAt: now,
        rev: (prev?.rev ?? 0) + 1,
        deleted: 0 as const,
        deletedAt: undefined,
        ...(restoredAt ? { restoredAt } : {}),
      } as Note)
      await tx.enqueue('notes', note.id, 'upsert', now)
      await syncMentionLinks(
        tx,
        note.id,
        typeof note.markdown === 'string' ? extractMentions(note.markdown) : [],
        now,
      )
      // 归属已迁 links（v16 member）：folderId 三态（undefined=不动 / null=根层 / string=移入）
      if (folderId !== undefined) {
        await syncMemberLinks(
          tx,
          { type: 'notes', id: note.id },
          'noteFolders',
          folderId ?? undefined,
          now,
        )
      }
    },
  )
  storage.requestSync()
  return note.id
}

/**
 * 笔记部分更新 +（markdown 变更时）mention 重同步：与 saveNoteWithMentions 同款事务纪律，
 * patch 语义沿用 repository.update（幽灵防护：不存在的 id 不动库不入队）。
 * 消费方：agentOps note_updateNote（markdown 变了提及就要跟着变，不能只改行）。
 */
export async function updateNoteWithMentions(
  id: string,
  patch: Partial<Note>,
  folderId?: string | null,
): Promise<void> {
  await storage.transaction(
    ['notes', 'links', 'customers', 'todos', 'ledgers', 'projects', 'noteFolders', 'syncQueue'],
    async (tx) => {
      const prev = await tx.get<Note>('notes', id)
      if (!prev || prev.deleted) return
      const now = Date.now()
      await tx.update('notes', id, { ...patch, updatedAt: now, rev: (prev.rev ?? 0) + 1 })
      await tx.enqueue('notes', id, 'upsert', now)
      if (typeof patch.markdown === 'string') {
        await syncMentionLinks(tx, id, extractMentions(patch.markdown), now)
      }
      if (folderId !== undefined) {
        await syncMemberLinks(tx, { type: 'notes', id }, 'noteFolders', folderId ?? undefined, now)
      }
    },
  )
  storage.requestSync()
}

/**
 * 笔记级联删除：软删笔记 + 清扫其名下全部 link（同一事务）。
 *
 * 为什么必须有它：v15 起 mention link（from=笔记）、v16 起 member link（文件夹归属）
 * 都是**独立于笔记行**的记录 —— 裸 softDelete 会留下「指向已删笔记的活 link」
 * （幽灵纪律③）。此前笔记删除一直无级联（mention 一族在 Phase 2 就欠着，只是
 * 消费端有 EntityMissing 兜底、界面上看不出来），member 落地后归属关系也会幽灵。
 *
 * 快照 `cascadeLinkIds` 留档：恢复笔记时 mention/member 随两端存活逐条复活。
 * 笔记不存在 / 已删时静默返回（幂等）。
 */
export async function deleteNoteCascade(noteId: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['notes', 'links', 'syncQueue'], async (tx) => {
    const prev = await tx.get<Note>('notes', noteId)
    if (!prev || prev.deleted) return
    const cascadeLinkIds = await cascadeSoftDeleteLinks(tx, [{ type: 'notes', id: noteId }], now)
    const trashSnapshot: TrashSnapshot = {
      children: [],
      links: [],
      ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
    }
    await tx.update('notes', noteId, {
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot,
    })
    await tx.enqueue('notes', noteId, 'delete', now)
  })
  storage.requestSync()
}

/**
 * 仅改文件夹归属（不动笔记行）：移动到文件夹 / 移回根层的快捷路径。
 * 幽灵笔记静默返回（repository.update 同款幂等口径）；幽灵文件夹抛错回滚。
 */
export async function setNoteFolder(
  noteId: string,
  folderId: string | undefined,
): Promise<void> {
  const now = Date.now()
  await storage.transaction(['notes', 'noteFolders', 'links', 'syncQueue'], async (tx) => {
    const note = await tx.get<Note>('notes', noteId)
    if (!note || note.deleted) return
    await syncMemberLinks(tx, { type: 'notes', id: noteId }, 'noteFolders', folderId, now)
  })
  storage.requestSync()
}

/**
 * 默认账本唯一性收口（P1 补强 · 第 4/7 步跨轮一致性）：
 *
 * 现状是 UI（`LedgerFormDrawer.save()`）与 agentOps（`fin_createLedger`）**各自内联**同一段
 * 「先清其它账本 isDefault 再落库」，属 §9.7 第 3 步注同款「全仓重复的内联约定」——
 * 两处一旦漂移（如漏掉某一侧、或某侧漏传 updatedAt/rev）就会出现「两个默认账本」，
 * 而 `TransactionFormDrawer` 的记账缺省账本取 `ledgers.find(l => l.isDefault)` 是**取第一个命中**，
 * 双默认下记账会静默挂到不确定的账本上。故收口为唯一实现，两路共用。
 *
 * 语义与 UI 完全一致：只清「非自身」的默认标记；清标记走 ledgerRepo.put（自动盖章 + 入队）。
 */
export async function clearOtherDefaultLedgers(keepId?: string): Promise<void> {
  const now = Date.now()
  const others = (await storage.list<Ledger>('ledgers')).filter(
    (l) => !l.deleted && l.isDefault && l.id !== keepId,
  )
  for (const l of others) {
    const { isDefault: _drop, ...rest } = l
    await ledgerRepo.put({ ...rest, updatedAt: now, rev: l.rev + 1 })
  }
}

/** 习惯打卡确定性 id：同日同习惯恒为同一条记录（幂等，杜绝重复打卡/幽灵记录） */
export function habitLogId(habitId: string, date: string): string {
  return `hl-${habitId}-${date}`
}

/**
 * 习惯打卡 / 取消打卡 —— 领域命令单点收口（方案 §9.6.1 / §9.7 第 5 步）。
 *
 * 收口前「打卡」逻辑内联重复在 3 处（`HabitsPage` 手工 toggle / `dashboard/cards` HabitLoopCard /
 * `shared/effects` 专注→习惯联动），各自 `put` + `emit('habit:checked')`，存在漂移风险：
 * 任一处漏 emit 或软删按 `existing.id` 而非确定性 `habitLogId` 派生 id，同一习惯就会出现
 * 「一条记录两套删除语义」。本函数把语义收敛为唯一一份。
 *
 * 幂等口径（§2.3 skill 幂等语义）：
 * - `checkinHabit` 只在**实际新建**（或软删后原地复活）时 emit `habit:checked`，已存在即 `{ created: false }` 且不 emit；
 * - 事件在**事务 commit 之后**发出（与 §2.1 事件纪律一致）；
 * - `uncheckHabit` 软删确定性 id，**不 emit**（取消不是「打卡成功」）；
 * - 打卡为空操作（新建/复活/已存在）语义由返回值 `{ created }` 表达，供调用方与测试观察。
 *
 * @param date YYYY-MM-DD；缺省为业务日（由调用方传入，保持与 UI「今天」口径同源）
 * @param opts.evidence 专注联动证据文案（`shared/effects` 传入）
 */
export async function checkinHabit(
  habitId: string,
  date: string,
  opts: { evidence?: string } = {},
): Promise<{ created: boolean }> {
  const id = habitLogId(habitId, date)
  const prev = await habitLogRepo.get(id)
  // 已存在（未软删）→ 幂等空操作，不落库不 emit
  if (prev) return { created: false }
  await habitLogRepo.put({
    id,
    habitId,
    date,
    completedAt: Date.now(),
    ...(opts.evidence ? { evidence: opts.evidence } : {}),
  } as PutInput<HabitLog>)
  // 事务 commit 之后 emit（仅实际新建/复活时）
  eventBus.emit('habit:checked', { habitId, date })
  return { created: true }
}

/** 取消打卡：软删确定性 id 派生的记录；不 emit `habit:checked`（§9.6.1 收口口径） */
export async function uncheckHabit(habitId: string, date: string): Promise<void> {
  await habitLogRepo.softDelete(habitLogId(habitId, date))
}

/**
 * 习惯级联删除：单 Dexie 事务覆盖 habits / habitLogs / syncQueue 三表，
 * 任一步失败整体回滚。语义：
 * 1. 软删习惯（盖章 + 入队 delete）
 * 2. 软删该习惯全部打卡日志（盖章 + 入队 delete）
 * 习惯不存在时静默返回（幂等），其余记录已属事务内一致状态。
 */
export async function deleteHabitCascade(habitId: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['habits', 'habitLogs', 'links', 'syncQueue'], async (tx) => {
    const prevHabit = await tx.get<Habit>('habits', habitId)
    if (!prevHabit || prevHabit.deleted) return

    const logs = (await tx.list<HabitLog>('habitLogs')).filter(
      (l) => l.habitId === habitId && !l.deleted,
    )
    // 关联层钩子：指向习惯及其打卡日志（子记录端点）的 link 一并墓碑化，恢复时随根复活
    const cascadeLinkIds = await cascadeSoftDeleteLinks(
      tx,
      [
        { type: 'habits', id: habitId },
        ...logs.map((l) => ({ type: 'habitLogs' as const, id: l.id })),
      ],
      now,
    )
    const trashSnapshot: TrashSnapshot = {
      children: logs.map((l) => ({ table: 'habitLogs' as const, id: l.id })),
      links: [],
      ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
    }

    await tx.update('habits', habitId, {
      deleted: 1,
      updatedAt: now,
      rev: prevHabit.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot,
    })
    await tx.enqueue('habits', habitId, 'delete', now)

    for (const log of logs) {
      await tx.update('habitLogs', log.id, {
        deleted: 1,
        updatedAt: now,
        rev: log.rev + 1,
        deletedAt: now,
        restoredAt: undefined,
        trashSnapshot: undefined,
      })
      await tx.enqueue('habitLogs', log.id, 'delete', now)
    }
  })
  storage.requestSync()
}

/**
 * 账本级联删除：单事务覆盖 ledgers / transactions / links / syncQueue 四表。
 *
 * 边界（2026-10-26 T4 收口）：**有流水的账本禁止删除** —— 流水.ledgerId 是强归属
 * （恢复侧 `pruneDeadRefs` 对「所属账本已删除」直接抛错），解绑流水会让账目失去归属口径；
 * 该守卫此前只长在 FinancePage 的 UI 层，绕过 UI 的调用方（未来的 agent 删除工具）会静默
 * 删掉带流水的账本 —— 收口到数据层，UI 预检保留（为了在确认前就显示计数）。
 *
 * 空账本删除才走到软删；名下的 mention link（笔记 @账本）随本事务墓碑化，
 * 快照 `cascadeLinkIds` 留档、恢复时复活 —— 与其余 cascade 同口径，
 * 修复「账本的 mention 仍无级联」欠账（PROGRESS 2026-10-24 ⑩ 遗留项）。
 * 账本不存在 / 已删时静默返回（幂等）。
 *
 * @throws 可操作错误：名下仍有未删流水（附计数），事务整体回滚。
 */
export async function deleteLedgerCascade(ledgerId: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['ledgers', 'transactions', 'links', 'syncQueue'], async (tx) => {
    const prevLedger = await tx.get<Ledger>('ledgers', ledgerId)
    if (!prevLedger || prevLedger.deleted) return

    const txnCount = (await tx.list<Transaction>('transactions')).filter(
      (t) => t.ledgerId === ledgerId && !t.deleted,
    ).length
    if (txnCount > 0) {
      throw new Error(`账本「${prevLedger.name}」下仍有 ${txnCount} 笔流水，无法删除`)
    }

    // 关联层钩子：指向账本的 mention link 墓碑化（ledgers 在 LinkEndpointTable 内）
    const cascadeLinkIds = await cascadeSoftDeleteLinks(
      tx,
      [{ type: 'ledgers', id: ledgerId }],
      now,
    )
    const trashSnapshot: TrashSnapshot = {
      children: [],
      links: [],
      ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
    }

    await tx.update('ledgers', ledgerId, {
      deleted: 1,
      updatedAt: now,
      rev: prevLedger.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot,
    })
    await tx.enqueue('ledgers', ledgerId, 'delete', now)
  })
  storage.requestSync()
}

/**
 * 待办 + 清单归属原子落库（Phase 3 集合层 · v16 起归属在 member link）。
 *
 * listId 三态与 saveTransactionWithAttachments(…, related?) 同款约定：
 * - `undefined` = 不动既有归属（agent 编辑未提清单时）；
 * - `null` = 移回收集箱（既有 member link 墓碑化）；
 * - `string` = 移入该清单（幽灵容器抛可操作错误、事务整体回滚）。
 * 行字段不再持有 listId（类型已删），收集箱 = 无 member link（不为收集箱建记录）。
 */
export async function saveTodoWithList(
  todo: PutInput<Todo>,
  listId?: string | null,
): Promise<string> {
  const now = Date.now()
  await storage.transaction(['todos', 'todoLists', 'links', 'syncQueue'], async (tx) => {
    const prev = await tx.get<Todo>('todos', todo.id)
    const reviving = prev?.deleted === 1
    const restoredAt = reviving ? now : (todo.restoredAt ?? prev?.restoredAt)
    await tx.put('todos', {
      ...todo,
      updatedAt: now,
      rev: (prev?.rev ?? 0) + 1,
      deleted: 0 as const,
      deletedAt: undefined,
      ...(restoredAt ? { restoredAt } : {}),
    } as Todo)
    await tx.enqueue('todos', todo.id, 'upsert', now)
    if (listId !== undefined) {
      await syncMemberLinks(
        tx,
        { type: 'todos', id: todo.id },
        'todoLists',
        listId ?? undefined,
        now,
      )
    }
  })
  storage.requestSync()
  return todo.id
}

/**
 * 仅改清单归属（不动待办行）：拖拽入清单 / 移回收集箱的快捷路径。
 * 幽灵待办静默返回（repository.update 同款幂等口径）；幽灵清单抛错回滚。
 */
export async function setTodoList(todoId: string, listId: string | undefined): Promise<void> {
  const now = Date.now()
  await storage.transaction(['todos', 'todoLists', 'links', 'syncQueue'], async (tx) => {
    const todo = await tx.get<Todo>('todos', todoId)
    if (!todo || todo.deleted) return
    await syncMemberLinks(tx, { type: 'todos', id: todoId }, 'todoLists', listId, now)
  })
  storage.requestSync()
}

/**
 * 交易 + 附件存根原子落库：单 Dexie 事务覆盖 transactions / attachments / syncQueue 三表，
 * 任一步失败整体回滚（避免"交易已落库而附件写入失败"的半成品数据）。
 * 每条记录统一盖章 updatedAt/rev/deleted 并入同步队列，语义与 repository.put 一致。
 *
 * **事件下沉（P1 第 2 步 / §2.1 事件纪律）**：`transaction:created` 在此统一发出，替代原先
 * UI（TransactionFormDrawer）内联 emit。落点是 repositories 层，时机是**事务 commit 之后**
 * （事务体之外的同一函数出口），永不进事务体。
 *
 * **create 门控（§2.1 边界① / §9.5 bug1）**：仅**新 id**（事务开始前该记录不存在）才 emit，
 * 编辑既有流水不再误发（旧实现编辑模式也会 emit，重复触发奖杯评估）。
 * 判断依据为事务内 `prev` 是否存在；返回值 `created` 供调用方与对照测试观察。
 */
export async function saveTransactionWithAttachments(
  txn: PutInput<Transaction>,
  attachments: PutInput<Attachment>[] = [],
  /**
   * 关联选择集（Phase 2 迁 links）：三组 id 与表单/Agent 契约同构；缺省 undefined =
   * **不动既有关联**（如仅改金额的编辑路径不带关联参数时不解绑）。空数组才是显式清空。
   */
  related?: TxnRelatedInput,
): Promise<{ id: string; created: boolean }> {
  const now = Date.now()
  let created = false
  await storage.transaction(
    ['transactions', 'attachments', 'links', 'customers', 'todos', 'projects', 'syncQueue'],
    async (tx) => {
      const putStamped = async <T extends { id: string }>(
        tableName: 'transactions' | 'attachments',
        record: T & Partial<SyncMeta>,
      ) => {
        const prev = await tx.get<T>(tableName, record.id)
        await tx.put(tableName, {
          ...record,
          updatedAt: now,
          rev: (prev?.rev ?? 0) + 1,
          deleted: 0 as const,
        } as T)
        await tx.enqueue(tableName, record.id, 'upsert', now)
      }
      // create 门控判据：事务开始前交易记录是否已存在（edited 既有记录 → prev 有值 → 不发事件）
      const prevTxn = await tx.get<Transaction>('transactions', txn.id)
      created = !prevTxn || !!prevTxn.deleted
      await putStamped('transactions', txn as Transaction & Partial<SyncMeta>)
      for (const att of attachments) {
        await putStamped('attachments', att)
        // 附件归属（Phase 2 迁 links）：宿主与附件刚在上方落库，事务内可见，走 putLinkTx
        await putLinkTx(
          tx,
          {
            from: { type: 'transactions', id: txn.id },
            to: { type: 'attachments', id: att.id },
            kind: 'attachment',
          },
          now,
        )
      }
      // 客户/待办/项目多关联（Phase 2 迁 links）：与流水行同事务 diff 同步
      if (related) {
        await syncRelatedLinks(tx, txn.id, related, now)
      }
    },
  )
  // 事务 commit 之后：仅在新建时发送事件（载荷与旧 UI 内联 emit 逐字段一致，无多余字段）
  if (created) {
    eventBus.emit('transaction:created', {
      transactionId: txn.id,
      // 事件载荷保持单值口径（Issue #140）：下游订阅方（灵感引擎失效、AI 事件流）按单值消费，
      // 多关联时代取首个关联客户即可表达"这笔钱和谁有关"，不放大事件契约的破坏面。
      customerId: (related?.customerIds ?? [])[0],
    })
  }
  storage.requestSync()
  return { id: txn.id, created }
}

/**
 * 沟通日志 + 客户最近联系时间原子落库：单 Dexie 事务覆盖 interactions / customers / syncQueue 三表，
 * 任一步失败整体回滚（避免"日志已落库而 lastContactAt 未刷新"的数据不一致）。
 * 客户侧先 get 最新记录再仅 update lastContactAt 单字段（禁止整记录展开覆盖并发写入的其他字段）。
 *
 * `touchAt`（可选，默认 = interaction.at）：客户侧「最近联系时间」的落库值。
 * 传入它允许调用方把「日志真实时间」与「客户最近联系时间」解耦 —— agentOps 补录历史沟通时
 * 用 `max(prev, at)` 避免把 lastContactAt 拉回过去（否则客户久未跟进提醒永久静默）。
 * 缺省行为与历史完全一致（= interaction.at），UI 两个入口不受影响。
 *
 * **事件下沉（P1 第 2 步 / §2.1 边界②）**：`customer:contacted` 在此统一发出，替代原先
 * 仅 CustomerDetailPage 内联 emit 的孤例。项目跟进（ProjectDetailPage）经本函数落库时
 * 同样获得事件（v0.3 裁决：项目跟进也算客户联系），消除「同一函数两条调用路径只一侧发事件」的漂移。
 * 时机为**事务 commit 之后**（函数出口），永不进事务体。`customer:contacted` 是孤儿事件（无消费者），
 * 对照测试降级为「emit 调用发生」级断言（§七.1）。
 */
export async function saveInteractionAndTouchCustomer(
  interaction: PutInput<Interaction>,
  customerId: string,
  touchAt?: number,
): Promise<string> {
  const now = Date.now()
  await storage.transaction(['interactions', 'customers', 'syncQueue'], async (tx) => {
    const prevInteraction = await tx.get<Interaction>('interactions', interaction.id)
    await tx.put('interactions', {
      ...interaction,
      updatedAt: now,
      rev: (prevInteraction?.rev ?? 0) + 1,
      deleted: 0 as const,
    } as Interaction)
    await tx.enqueue('interactions', interaction.id, 'upsert', now)

    const prevCustomer = await tx.get<Customer>('customers', customerId)
    if (!prevCustomer || prevCustomer.deleted) {
      // 客户不存在/已删除：抛错让整个事务回滚，杜绝孤儿日志
      throw new Error(`saveInteractionAndTouchCustomer: customer ${customerId} not found`)
    }
    await tx.update('customers', customerId, {
      lastContactAt: touchAt ?? interaction.at,
      updatedAt: now,
      rev: prevCustomer.rev + 1,
    })
    await tx.enqueue('customers', customerId, 'upsert', now)
  })
  // 事务 commit 之后：统一 emit（UI 两个入口 + agentOps 都经此，单点收口）
  eventBus.emit('customer:contacted', { customerId })
  storage.requestSync()
  return interaction.id
}

/**
 * 客户关系新增（关联层 Phase 2 · v15 起实现为 kind='relation' link）。
 *
 * 历史口径「双向落两侧 relations[]」（v0.2）已退役：canonical 存储（两端 id 字典序）
 * 下一条 link 就是这对客户的这条语义关系，A/B 任一侧、任一设备发起都操作同一条记录。
 * 单一来源不变：UI（CustomerFormDrawer 经 saveCustomer/createCustomerWithInit 的
 * relations 选择集）与 agentOps（crm_addRelation）都经本层，不各写一份盖章/入队。
 *
 * @returns `{ relationId, deduped }`；同 `目标 + 语义` 已有活 link 时幂等返回（deduped=true）
 */
export async function addCustomerRelation(
  customerId: string,
  targetId: string,
  label: string,
  category?: RelationCategory,
): Promise<{ relationId: string; deduped: boolean }> {
  if (customerId === targetId) throw new Error('addCustomerRelation: 不能与自身建立关系')
  // 关联层 Phase 2（v15）：关系 = kind='relation' link（canonical 排序 + meta{label,category}），
  // 双侧镜像数组退役 —— A/B 任一侧看到的是同一条记录，多端并发天然合流。
  const id = buildLinkId(
    { type: 'customers', id: customerId },
    { type: 'customers', id: targetId },
    'relation',
    { label, ...(category ? { category } : {}) },
  )
  // 同 目标+语义 判重（与 UI 同款纪律，Issue #39）：已有活 link 即幂等返回，不重复盖章
  const prev = await linkRepo.get(id)
  if (prev) return { relationId: id, deduped: true }
  // linkAtoms 前置校验两端客户存活（幽灵纪律③），违例抛可操作错误
  await linkAtoms({
    from: { type: 'customers', id: customerId },
    to: { type: 'customers', id: targetId },
    kind: 'relation',
    meta: { label, ...(category ? { category } : {}) },
  })
  return { relationId: id, deduped: false }
}

/**
 * 客户保存 + 关系选择集原子落库（关联层 Phase 2）：客户行与 relation links 单事务，
 * 盖章/入队与 repository.put 同款口径。UI（CustomerFormDrawer 编辑态）走此，
 * 禁止再整记录展开携带 relations 字段（该字段已随 v15 迁 links）。
 */
export async function saveCustomer(
  customer: PutInput<Customer>,
  relations?: CustomerRelation[],
): Promise<string> {
  const now = Date.now()
  await storage.transaction(['customers', 'links', 'syncQueue'], async (tx) => {
    const prev = await tx.get<Customer>('customers', customer.id)
    const reviving = prev?.deleted === 1
    const restoredAt = reviving ? now : (customer.restoredAt ?? prev?.restoredAt)
    await tx.put('customers', {
      ...customer,
      updatedAt: now,
      rev: (prev?.rev ?? 0) + 1,
      deleted: 0 as const,
      deletedAt: undefined,
      ...(restoredAt ? { restoredAt } : {}),
    } as Customer)
    await tx.enqueue('customers', customer.id, 'upsert', now)
    if (relations) {
      await syncRelationLinks(tx, customer.id, relations, now)
    }
  })
  storage.requestSync()
  return customer.id
}

/**
 * 客户级联删除：单 Dexie 事务覆盖 customers / interactions / transactions / todos / syncQueue 五表，
 * 任一步失败整体回滚。语义：
 * 1. 软删客户（盖章 + 入队 delete）
 * 2. 软删该客户全部沟通日志（盖章 + 入队 delete）
 * 3. 解绑该客户名下交易/待办/项目：customerId 置 undefined（盖章 + 入队 upsert）
 *    —— projects.customerId 必须一并解绑，否则关系画布会出现「边指向已删除客户节点」的悬挂引用（崩溃根因）。
 * 4. 解绑其它客户 relations 里指向被删者的条目（双向弱引用清理），否则全景图/聚焦图再次悬挂。
 * 客户不存在时静默返回（幂等），其余记录已属事务内一致状态。
 */
export async function deleteCustomerCascade(customerId: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(
    ['customers', 'interactions', 'todos', 'projects', 'links', 'syncQueue'],
    async (tx) => {
      const prevCustomer = await tx.get<Customer>('customers', customerId)
      if (!prevCustomer || prevCustomer.deleted) return

      const interactions = (await tx.list<Interaction>('interactions')).filter(
        (it) => it.customerId === customerId && !it.deleted,
      )
      // transactions.customerIds 已迁 links（v15）：指向该客户的 related link 由
      // cascadeSoftDeleteLinks 统一墓碑化（快照留档、恢复复活），「数组解绑 + mode:'append'
      // 快照」路径退役 —— 本函数不再触碰 transactions 表。
      const todos = (await tx.list<Todo>('todos')).filter(
        (t) => t.customerId === customerId && !t.deleted,
      )
      // relations 已迁 links（v15）：指向该客户的 relation link 由 cascadeSoftDeleteLinks
      // 统一墓碑化（canonical 一条记录，无「双侧清扫」），快照留档、恢复复活 —— 退役
      // 原「遍历全部客户剪 relations 数组 + mode:'relation' 快照」路径。
      // 解绑名下项目：项目不随客户消失，只清挂靠关系（弱引用语义，画布/CRM 下钻不悬挂）
      const projects = (await tx.list<import('@/db/types').Project>('projects')).filter(
        (p) => p.customerId === customerId && !p.deleted,
      )
      /**
       * 笔记 mention 已迁 links（v15）：指向该客户的 mention link 由下方
       * cascadeSoftDeleteLinks 统一墓碑化（快照 cascadeLinkIds 留档、恢复时复活），
       * 此前「剪 mentions 字段 + mode:'mention' 快照」路径整体退役。
       * 账本删除的 mention 级联已由 deleteLedgerCascade 收口（2026-10-26 T4）。
       */

      // 关联层钩子：指向客户及其沟通日志（子记录端点）的 link 一并墓碑化。
      // 被解绑的 txns/todos/projects 仍是活记录 —— 它们身上不触及客户的 link 不动。
      const cascadeLinkIds = await cascadeSoftDeleteLinks(
        tx,
        [
          { type: 'customers', id: customerId },
          ...interactions.map((it) => ({ type: 'interactions' as const, id: it.id })),
        ],
        now,
      )

      const trashSnapshot: TrashSnapshot = {
        children: interactions.map((it) => ({ table: 'interactions' as const, id: it.id })),
        links: [
          ...todos.map((t) => ({
            table: 'todos' as const,
            id: t.id,
            field: 'customerId',
            mode: 'set' as const,
            value: customerId,
          })),
          ...projects.map((p) => ({
            table: 'projects' as const,
            id: p.id,
            field: 'customerId',
            mode: 'set' as const,
            value: customerId,
          })),
        ],
        ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
      }

      await tx.update('customers', customerId, {
        deleted: 1,
        updatedAt: now,
        rev: prevCustomer.rev + 1,
        deletedAt: now,
        restoredAt: undefined,
        trashSnapshot,
      })
      await tx.enqueue('customers', customerId, 'delete', now)

      for (const it of interactions) {
        await tx.update('interactions', it.id, {
          deleted: 1,
          updatedAt: now,
          rev: it.rev + 1,
          deletedAt: now,
          restoredAt: undefined,
          trashSnapshot: undefined,
        })
        await tx.enqueue('interactions', it.id, 'delete', now)
      }

      for (const todo of todos) {
        await tx.update('todos', todo.id, {
          customerId: undefined,
          updatedAt: now,
          rev: todo.rev + 1,
        })
        await tx.enqueue('todos', todo.id, 'upsert', now)
      }


      for (const proj of projects) {
        await tx.update('projects', proj.id, {
          customerId: undefined,
          updatedAt: now,
          rev: proj.rev + 1,
        })
        await tx.enqueue('projects', proj.id, 'upsert', now)
      }
    },
  )
  storage.requestSync()
}

/**
 * 客户建档 + 跨模块关联初始化（原 modules/crm/hooks.ts → 暂存 @/agent → 第 2 步下沉于此，§9.6 不变式）。
 *
 * 单事务五表（customers / todos / interactions / transactions / syncQueue），任一步失败整体回滚。
 * 事件口径（P1 第 2 步）：本函数**不新增任何事件**——`openingLog` 是建档初始化的一部分，
 * 建档本身在 TOOL_EVENTS 声明表里无既有事件（§2.1「crm_createCustomer 无既有事件，不加新的」），
 * 故保持原行为（不 emit），与本步骤「不改既有语义、只收口漂移」的边界一致。
 */
export interface CustomerInitOptions {
  /** 创建一条 opening 沟通日志 */
  openingLog?: boolean
  /** 关联已有交易：建「流水 → 新客户」related link */
  linkTransactionId?: string
  /** 建档即建关系（v15 起为 relation link 选择集，随建档同事务 diff 同步） */
  relations?: CustomerRelation[]
}

export async function createCustomerWithInit(
  customer: Customer,
  opts: CustomerInitOptions = {},
): Promise<void> {
  const now = Date.now()
  await storage.transaction(
    ['customers', 'todos', 'interactions', 'transactions', 'links', 'syncQueue'],
    async (tx) => {
      const prev = await tx.get<Customer>('customers', customer.id)
      await tx.put('customers', {
        ...customer,
        updatedAt: now,
        rev: (prev?.rev ?? 0) + 1,
        deleted: 0 as const,
      } as Customer)
      await tx.enqueue('customers', customer.id, 'upsert', now)

      if (opts.relations?.length) {
        await syncRelationLinks(tx, customer.id, opts.relations, now)
      }

      if (opts.openingLog) {
        const itx = {
          id: newId('itx'),
          customerId: customer.id,
          content: '客户建档 · 首次建立联系（opening）',
          at: now,
        }
        await tx.put('interactions', {
          ...itx,
          updatedAt: now,
          rev: 1,
          deleted: 0 as const,
        } as Interaction)
        await tx.enqueue('interactions', itx.id, 'upsert', now)
      }

      if (opts.linkTransactionId) {
        const txn = await tx.get<Transaction>('transactions', opts.linkTransactionId)
        if (txn && !txn.deleted) {
          // 关联已迁 links（v15）：建 related link（确定性 id 幂等，重复建档不重复建联）
          await putLinkTx(
            tx,
            {
              from: { type: 'transactions', id: txn.id },
              to: { type: 'customers', id: customer.id },
              kind: 'related',
            },
            now,
          )
        }
      }
    },
  )
  storage.requestSync()
}

/**
 * 交易级联删除：单事务覆盖 transactions / attachments / syncQueue 三表，任一步失败整体回滚。
 * 1. 软删交易（盖章 + 入队 delete）
 * 2. 软删该交易全部附件存根（盖章 + 入队 delete）
 *
 * **为什么下沉到 repositories（2026-10-21）**：与 `deleteCustomerCascade` / `deleteHabitCascade`
 * 同处一层 —— 级联语义是「落库口径」，不该散落在某个模块的 hooks 文件里。原实现的文件
 * （`modules/finance/hooks.ts`）还带着 React 查询钩子，agentOps 执行器引用它就会被绑到 UI 层；
 * 更糟的是「AI 侧另写一份软删 + 清附件」= 同一语义两份实现，改了一边忘另一边时，
 * AI 删过的流水会留下附件幽灵记录（凭证仍能点开）。故上移为本层唯一实现，
 * modules 侧改为 re-export，UI 与 AI 走同一条路径。
 */
export async function deleteTransactionCascade(txnId: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['transactions', 'attachments', 'links', 'syncQueue'], async (tx) => {
    const prev = await tx.get<Transaction>('transactions', txnId)
    if (!prev || prev.deleted) return

    // 附件归属已迁 links（v15）：按 kind='attachment' 的 from 方向找子附件
    // （含墓碑 link —— 归属关系一旦建立就随流水走，墓碑只代表「当下已删」而非「从未归属」）
    const attLinks = (await tx.list<Link>('links')).filter(
      (l) =>
        l.kind === 'attachment' && l.fromType === 'transactions' && l.fromId === txnId,
    )
    const atts: Attachment[] = []
    for (const l of attLinks) {
      const a = await tx.get<Attachment>('attachments', l.toId)
      if (a && !a.deleted) atts.push(a)
    }
    // 关联层钩子：指向流水及其附件（子记录端点）的 link 一并墓碑化
    const cascadeLinkIds = await cascadeSoftDeleteLinks(
      tx,
      [
        { type: 'transactions', id: txnId },
        ...atts.map((a) => ({ type: 'attachments' as const, id: a.id })),
      ],
      now,
    )
    const trashSnapshot: TrashSnapshot = {
      children: atts.map((a) => ({ table: 'attachments' as const, id: a.id })),
      links: [],
      ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
    }

    await tx.update('transactions', txnId, {
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot,
    })
    await tx.enqueue('transactions', txnId, 'delete', now)

    for (const att of atts) {
      await tx.update('attachments', att.id, {
        deleted: 1,
        updatedAt: now,
        rev: (att.rev ?? 0) + 1,
        deletedAt: now,
        restoredAt: undefined,
        trashSnapshot: undefined,
      })
      await tx.enqueue('attachments', att.id, 'delete', now)
    }
  })
  storage.requestSync()
}

/**
 * 项目级联删除（照 deleteCustomerCascade / deleteTodoListCascade 纪律，单事务）：
 * 1. 软删项目 + 软删名下全部里程碑（里程碑是项目专属刻度，随项目消亡）
 * 2. 解绑弱引用：transactions/todos/notes/interactions 的 projectId 置 undefined
 *    —— 账目/待办/笔记不能因项目没了而消失（「待办只是一次」语义），只清关联。
 * 项目不存在时静默返回（幂等）。
 *
 * **为什么下沉到 repositories**：同 deleteTransactionCascade —— 级联语义属落库口径，
 * 与 `deleteCustomerCascade` / `deleteHabitCascade` 同处才谈得上「单一事实源」；
 * 原文件带 React 查询钩子，agentOps 引用它会被绑到 UI 层。
 */
export async function deleteProjectCascade(projectId: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(
    ['projects', 'projectMilestones', 'todos', 'notes', 'interactions', 'links', 'syncQueue'],
    async (tx) => {
      const prev = await tx.get<Project>('projects', projectId)
      if (!prev || prev.deleted) return

      const milestones = (await tx.list<ProjectMilestone>('projectMilestones')).filter(
        (m) => m.projectId === projectId && !m.deleted,
      )
      // 单值弱引用表（todos/notes/interactions）：projectId 置 undefined 即解绑
      const [todos, notes, interactions] = await Promise.all([
        tx.list<Todo>('todos'),
        tx.list<Note>('notes'),
        tx.list<Interaction>('interactions'),
      ])
      const linkedSingle = [
        ...todos.filter((r) => !r.deleted && r.projectId === projectId).map((r) => ({
          table: 'todos' as const,
          record: r,
        })),
        ...notes.filter((r) => !r.deleted && r.projectId === projectId).map((r) => ({
          table: 'notes' as const,
          record: r,
        })),
        ...interactions
          .filter((r) => !r.deleted && r.projectId === projectId)
          .map((r) => ({ table: 'interactions' as const, record: r })),
      ]
      // 笔记 mention 已迁 links（v15）：指向该项目的 mention link 由下方
      // cascadeSoftDeleteLinks 统一墓碑化，「剪 mentions 字段 + mode:'mention' 快照」退役

      // 关联层钩子：指向项目及其里程碑（子记录端点）的 link 一并墓碑化；
      // 被解绑的 txns/todos/notes/interactions 仍是活记录，不触及项目的 link 不动
      const cascadeLinkIds = await cascadeSoftDeleteLinks(
        tx,
        [
          { type: 'projects', id: projectId },
          ...milestones.map((m) => ({ type: 'projectMilestones' as const, id: m.id })),
        ],
        now,
      )

      const trashSnapshot: TrashSnapshot = {
        children: milestones.map((m) => ({ table: 'projectMilestones' as const, id: m.id })),
        links: [
          ...linkedSingle.map(({ table, record }) => ({
            table,
            id: record.id,
            field: 'projectId',
            mode: 'set' as const,
            value: projectId,
          })),
        ],
        ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
      }

      await tx.update('projects', projectId, {
        deleted: 1,
        updatedAt: now,
        rev: prev.rev + 1,
        deletedAt: now,
        restoredAt: undefined,
        trashSnapshot,
      })
      await tx.enqueue('projects', projectId, 'delete', now)

      for (const m of milestones) {
        await tx.update('projectMilestones', m.id, {
          deleted: 1,
          updatedAt: now,
          rev: m.rev + 1,
          deletedAt: now,
          restoredAt: undefined,
          trashSnapshot: undefined,
        })
        await tx.enqueue('projectMilestones', m.id, 'delete', now)
      }

      // transactions.projectIds 已迁 links（v15）：指向该项目的 related link 由
      // cascadeSoftDeleteLinks 统一墓碑化（快照留档、恢复复活），数组解绑路径退役。
      for (const { table, record } of linkedSingle) {
        await tx.update(table, record.id, {
          projectId: undefined,
          updatedAt: now,
          rev: record.rev + 1,
        })
        await tx.enqueue(table, record.id, 'upsert', now)
      }
    },
  )
  storage.requestSync()
}

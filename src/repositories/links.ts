import { storage } from '@/storage'
import type { StorageTx } from '@/storage/types'
import { db } from '@/db/db'
import type { Link, LinkEndpointTable, LinkKind, LinkMeta } from '@/db/types'
import { createRepository } from './repository'
import { buildLinkId, canonicalEndpoints, type LinkEndpoint } from './linkId'

// 纯函数层（id / canonical / 旧字段映射）在 linkId.ts —— db.ts 的 v15 upgrade 也要用，
// 放这里会构成 db → storage 运行时循环；从这里 re-export 保持既有导入路径不变。
export { buildLinkId } from './linkId'
export type { LinkEndpoint } from './linkId'

/**
 * 关联层 links —— 原子间关联的唯一真源（docs/关联层设计方案-20261025.md）。
 *
 * Phase 1 = 零消费方地基：表、同步登记、读写 API、测试锁就位，UI / Agent 工具面不动；
 * Phase 2 起依次迁入 attachments 归属 → notes.mentions → transactions 数组 → customer.relations。
 *
 * 分工与纪律：
 * - 写（linkAtoms/unlinkAtoms）：事务 + 盖章 + 入队，与 repositories 复合函数同纪律；
 * - 读（linksOf/linksTo）：直接 db.links 复合索引查询 —— AGENTS.md §4 读路径不受
 *   storage.transaction 收口限制；本表存在的意义之一就是替换全表内存扫描，不能退回去；
 * - Phase 1 不发事件（无消费方；事件总线泛化是独立议题，方案拍板 6）。
 */

export const linkRepo = createRepository<Link>('links')

/**
 * 事务内建联原语：盖章 + 落库 + 入队，**不做端点校验**（调用方保证两端记录已在
 * 同一事务内落库或已存在 —— 复合函数如 saveTransactionWithAttachments 在同一事务里
 * 先落实体再建联时，校验反而会误伤刚写入、事务内可见的行）。幂等：确定性 id 覆盖盖章。
 */
export async function putLinkTx(
  tx: StorageTx,
  input: { from: LinkEndpoint; to: LinkEndpoint; kind: LinkKind; meta?: LinkMeta },
  now: number,
): Promise<string> {
  const [from, to] = canonicalEndpoints(input.from, input.to, input.kind)
  // buildLinkId 内部做同样的 canonical，保证 id 与落库方向恒一致
  const id = buildLinkId(input.from, input.to, input.kind, input.meta)
  const prev = await tx.get<Link>('links', id)
  const reviving = prev?.deleted === 1
  await tx.put('links', {
    id,
    fromType: from.type,
    fromId: from.id,
    toType: to.type,
    toId: to.id,
    kind: input.kind,
    ...(input.meta ? { meta: input.meta } : {}),
    // 幂等重建沿用首次创建时间（rev 递增但语义是同一条关联）
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    rev: (prev?.rev ?? 0) + 1,
    deleted: 0 as const,
    // 活记录不得带删除时间（与 repository.put 同口径：防展开墓碑对象残留脏值）
    deletedAt: undefined,
    // 复活凭证粘性语义与 repository.put 一致：软删后重建 = 显式复活
    ...(reviving ? { restoredAt: now } : prev?.restoredAt ? { restoredAt: prev.restoredAt } : {}),
  } as Link)
  await tx.enqueue('links', id, 'upsert', now)
  return id
}

/**
 * 建立原子间关联（幂等：同语义重复调用 = 覆盖盖章，rev 递增，不产生第二条）。
 *
 * 纪律：
 * - 关联校验前置（幽灵纪律③）：两端必须存在且未删，否则抛可操作错误并整体回滚 ——
 *   建联产生悬挂引用比失败更危险。Phase 2 迁移回填遇到已删端点应**跳过**，不走本函数；
 * - kind='relation' 要求 meta.label（关系语义是 id 判重维度，缺失会让多条关系塌缩成一条）；
 * - 禁止自关联（from 与 to 同实体）。
 */
export async function linkAtoms(input: {
  from: LinkEndpoint
  to: LinkEndpoint
  kind: LinkKind
  meta?: LinkMeta
}): Promise<string> {
  const { kind } = input
  if (input.from.type === input.to.type && input.from.id === input.to.id) {
    throw new Error('linkAtoms: 不能与自身建立关联')
  }
  if (kind === 'relation' && !input.meta?.label) {
    throw new Error('linkAtoms: kind=relation 需要 meta.label（关系语义参与判重）')
  }
  let id = ''
  await storage.transaction(
    [...new Set([input.from.type, input.to.type, 'links', 'syncQueue'])],
    async (tx) => {
      for (const ep of [input.from, input.to]) {
        const rec = await tx.get<{ id: string }>(ep.type, ep.id)
        if (!rec || rec.deleted) {
          throw new Error(`linkAtoms: 端点不存在或已删除（${ep.type}:${ep.id}）`)
        }
      }
      id = await putLinkTx(tx, input, Date.now())
    },
  )
  storage.requestSync()
  return id
}

/**
 * 解除关联：软删确定性 id。
 * 幂等口径与 softDelete 的幽灵防护一致且更严：从未存在 / 已是墓碑 → 静默返回。
 * 不重复盖章不是洁癖：重复 bump 会把 deletedAt 拉漂，回收站「删除于 / 剩余 N 天」
 * 与 30 天清理 cutoff 都会失真（deletedAt 独立字段的立字理由，见 db/types.ts#SyncMeta）。
 */
export async function unlinkAtoms(input: {
  from: LinkEndpoint
  to: LinkEndpoint
  kind: LinkKind
  meta?: LinkMeta
}): Promise<void> {
  const id = buildLinkId(input.from, input.to, input.kind, input.meta)
  const alive = await linkRepo.get(id) // get 已过滤墓碑：只有活记录才需要解绑
  if (!alive) return
  await linkRepo.softDelete(id)
}

/** from 方向关联查询（[fromType+fromId] 复合索引；过滤墓碑；可选 kind 收窄） */
export async function linksOf(
  table: LinkEndpointTable,
  id: string,
  kind?: LinkKind,
): Promise<Link[]> {
  const rows = await db.links.where('[fromType+fromId]').equals([table, id]).toArray()
  return rows.filter((l) => !l.deleted && (kind === undefined || l.kind === kind))
}

/** to 方向关联查询（[toType+toId] 复合索引；过滤墓碑；可选 kind 收窄） */
export async function linksTo(
  table: LinkEndpointTable,
  id: string,
  kind?: LinkKind,
): Promise<Link[]> {
  const rows = await db.links.where('[toType+toId]').equals([table, id]).toArray()
  return rows.filter((l) => !l.deleted && (kind === undefined || l.kind === kind))
}

// ─────────────────────────── mention 同步（Phase 2 · 笔记保存时与笔记行同事务） ───────────────────────────

/** 提及目标类型 → 表名（与 mentionParse 的 NoteMention.type 一一对应） */
const MENTION_TARGET_TABLE = {
  customer: 'customers',
  todo: 'todos',
  ledger: 'ledgers',
  project: 'projects',
} as const

/**
 * 笔记保存时的 mention link 同步（diff 式）：
 * - 正文里仍存在的提及 → putLinkTx（确定性 id：同笔记同目标恒同一条；label 变了只更新 meta）；
 * - 已从正文移除的提及 → 软删对应 link（墓碑可随「重新提及」复活，putLinkTx 同 id 覆盖即复活）；
 * - 提及指向已删/不存在实体 → 跳过不建（幽灵纪律③；渲染层 EntityMissing 兜底）。
 * 必须与笔记行同一事务调用（saveNoteWithMentions / updateNoteWithMentions 收口）。
 */
export async function syncMentionLinks(
  tx: StorageTx,
  noteId: string,
  mentions: ReadonlyArray<{ type: string; id: string; label: string }>,
  now: number,
): Promise<void> {
  const existing = (await tx.list<Link>('links')).filter(
    (l) => l.kind === 'mention' && l.fromType === 'notes' && l.fromId === noteId,
  )
  const wantedKeys = new Set<string>()
  for (const m of mentions) {
    const toType = MENTION_TARGET_TABLE[m.type as keyof typeof MENTION_TARGET_TABLE]
    if (!toType) continue
    const key = `${toType}:${m.id}`
    wantedKeys.add(key)
    const rec = await tx.get<{ id: string }>(toType, m.id)
    if (!rec || rec.deleted) continue
    await putLinkTx(
      tx,
      {
        from: { type: 'notes', id: noteId },
        to: { type: toType, id: m.id },
        kind: 'mention',
        meta: { label: m.label },
      },
      now,
    )
  }
  for (const l of existing) {
    if (wantedKeys.has(`${l.toType}:${l.toId}`)) continue
    if (l.deleted === 1) continue
    await tx.update('links', l.id, {
      deleted: 1,
      updatedAt: now,
      rev: (l.rev ?? 0) + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot: undefined,
    })
    await tx.enqueue('links', l.id, 'delete', now)
  }
}

// ─────────────────────────── related 同步（Phase 2 · 流水保存时与流水行同事务） ───────────────────────────

/** 流水「多关联」目标组（kind='related'；与表单/Agent 契约的三组 id 同构） */
export interface TxnRelatedInput {
  customerIds?: string[]
  todoIds?: string[]
  projectIds?: string[]
}

const RELATED_TARGET_TABLE = {
  customers: 'customerIds',
  todos: 'todoIds',
  projects: 'projectIds',
} as const

/**
 * 流水保存时的 related link 同步（diff 式，与 syncMentionLinks 同款纪律）：
 * - 选择集里仍存在的关联 → putLinkTx（确定性 id 幂等；related 无 disc，同对恒一条）；
 * - 已被移除的关联 → 软删对应 link（重新选回时同 id 复活）；
 * - 指向已删/不存在实体的 id → 跳过（弱引用纪律：解绑不报错）。
 * 必须与流水行同一事务调用（saveTransactionWithAttachments 收口）。
 */
export async function syncRelatedLinks(
  tx: StorageTx,
  txnId: string,
  wanted: TxnRelatedInput,
  now: number,
): Promise<void> {
  const existing = (await tx.list<Link>('links')).filter(
    (l) => l.kind === 'related' && l.fromType === 'transactions' && l.fromId === txnId,
  )
  const wantedKeys = new Set<string>()
  for (const [toType, field] of Object.entries(RELATED_TARGET_TABLE)) {
    const ids = wanted[field as keyof TxnRelatedInput] ?? []
    for (const id of [...new Set(ids)]) {
      const key = `${toType}:${id}`
      wantedKeys.add(key)
      const rec = await tx.get<{ id: string }>(toType as LinkEndpointTable, id)
      if (!rec || rec.deleted) continue
      await putLinkTx(
        tx,
        { from: { type: 'transactions', id: txnId }, to: { type: toType as LinkEndpointTable, id }, kind: 'related' },
        now,
      )
    }
  }
  for (const l of existing) {
    if (wantedKeys.has(`${l.toType}:${l.toId}`)) continue
    if (l.deleted === 1) continue
    await tx.update('links', l.id, {
      deleted: 1,
      updatedAt: now,
      rev: (l.rev ?? 0) + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot: undefined,
    })
    await tx.enqueue('links', l.id, 'delete', now)
  }
}

// ─────────────────────────── 级联 / 恢复钩子（R2 · 与实体软删恢复同事务） ───────────────────────────

/**
 * 级联钩子（供 deleteXxxCascade 在**同一事务内**调用）：软删指向这组端点（根 + 子记录）
 * 的全部活 link，返回被墓碑化的 link id —— 调用方写进根墓碑的 `trashSnapshot.cascadeLinkIds`，
 * 恢复路径据此精确复活（见 reviveCascadeLinks 头注释）。
 *
 * 幂等：已是墓碑的 link 跳过 —— 同一 link 可能同时触及本次删除的根与另一端实体
 * （如两端先后删除），只墓碑化一次、只在**首次**删除方的快照留档（后删方看不到它）。
 * 由此产生一条恢复顺序边界：先删的一方后恢复（它的快照复活时对端已回来），
 * 反过来则该 link 永久保持墓碑（用户可手动重建，不为猜意图而复活）。
 *
 * 查询走 tx.list 全表过滤：StorageTx 没有索引查询原语，与既有 cascade 的弱引用
 * 解绑同款写法（级联是低频用户动作，量级无关痛痒；读侧高频路径才必须走复合索引）。
 */
export async function cascadeSoftDeleteLinks(
  tx: StorageTx,
  endpoints: LinkEndpoint[],
  now: number,
): Promise<string[]> {
  const keys = new Set(endpoints.map((e) => `${e.type}:${e.id}`))
  const hit = (await tx.list<Link>('links')).filter(
    (l) =>
      !l.deleted &&
      (keys.has(`${l.fromType}:${l.fromId}`) || keys.has(`${l.toType}:${l.toId}`)),
  )
  for (const l of hit) {
    await tx.update('links', l.id, {
      deleted: 1,
      updatedAt: now,
      rev: (l.rev ?? 0) + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot: undefined,
    })
    await tx.enqueue('links', l.id, 'delete', now)
  }
  return hit.map((l) => l.id)
}

/**
 * 恢复钩子（供 restoreTrashRecord 在同一事务内、根与子记录**复活之后**调用）：
 * 按 `snapshot.cascadeLinkIds` 逐条复活 —— **两端实体都存活**才复活，一端已删/已清理
 * 则跳过并计数（不为恢复关联复活无关记录，与回收站既有口径一致）。
 * 必须在实体复活之后调用：同事务内 tx.get 要能看到刚复活的活行。
 *
 * 永久删除（purge）刻意**不**连带物理删 link 墓碑（as-built 裁决，2026-10-25）：
 * links 不进回收站 UI（不可见、不可独立恢复），墓碑由 cleanupTombstones 按
 * 30 天保留期统一清理 —— 保留期正是其它设备拉到墓碑的窗口，与实体墓碑同生命周期；
 * 反之把 link 塞进 purgeTargets 会扩大「先推后删」顺序硬约束的风险面，收益为零。
 */
export async function reviveCascadeLinks(
  tx: StorageTx,
  linkIds: string[],
  now: number,
): Promise<{ revived: number; skipped: number }> {
  let revived = 0
  let skipped = 0
  for (const id of linkIds) {
    const link = await tx.get<Link>('links', id)
    if (!link || link.deleted !== 1) continue // 已被 30 天清理或已是活记录：无事可做
    const from = await tx.get<{ id: string }>(link.fromType, link.fromId)
    const to = await tx.get<{ id: string }>(link.toType, link.toId)
    if (!from || from.deleted || !to || to.deleted) {
      skipped++
      continue
    }
    await tx.update('links', id, {
      deleted: 0,
      updatedAt: now,
      // restoredAt 是同步层放行复活的唯一凭证（SyncMeta 协议），与实体恢复同款
      restoredAt: now,
      rev: (link.rev ?? 0) + 1,
      deletedAt: undefined,
    })
    await tx.enqueue('links', id, 'upsert', now)
    revived++
  }
  return { revived, skipped }
}

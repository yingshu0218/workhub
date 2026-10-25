import { storage } from '@/storage'
import type { StorageTx } from '@/storage/types'
import { db } from '@/db/db'
import { sha256ToBase36_15 } from '@/sync/remoteNormalize'
import type { Link, LinkEndpointTable, LinkKind, LinkMeta } from '@/db/types'
import { createRepository } from './repository'

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

/** 端点输入形态（与 Link 的平铺字段同构） */
export interface LinkEndpoint {
  type: LinkEndpointTable
  id: string
}

/**
 * 对称关系的 canonical 排序：kind='relation' 时按端点 id 字典序定 from/to ——
 * 任一端、任一设备发起都得到同一条记录（方向本无业务含义，今日 relations 是双侧镜像）。
 * 其余 kind 保持调用方给出的方向（from = 主动方/容器，to = 被指向方，方案 §2.3）。
 */
function canonicalEndpoints(
  from: LinkEndpoint,
  to: LinkEndpoint,
  kind: LinkKind,
): [LinkEndpoint, LinkEndpoint] {
  if (kind !== 'relation') return [from, to]
  return from.id <= to.id ? [from, to] : [to, from]
}

/**
 * 同端点对同 kind 的多条语义区分（仅 relation 用）：label 参与 id 判重 ——
 * 同一对客户可保留多条不同语义关系（Issue #39 条目级去重口径），同语义则判重为一条。
 */
function discriminator(kind: LinkKind, meta?: LinkMeta): string {
  if (kind !== 'relation') return ''
  return `${meta?.label ?? ''}#${meta?.category ?? ''}`
}

/**
 * 确定性 link id：`lk-` + sha256ToBase36_15(seed)。
 * 同输入恒同 id → 重复建联幂等；双端离线各建同一关联时 LWW 直接合流、不产生重复
 * （先例：habitLogId 确定性打卡 id、同步层 localId→pbId 映射，hash 助手同一份）。
 * seed 用 `|` 分隔：端点 id 本身可含 `:`（newId 产物），hash 输入不解析、无歧义。
 */
export function buildLinkId(
  from: LinkEndpoint,
  to: LinkEndpoint,
  kind: LinkKind,
  meta?: LinkMeta,
): string {
  const [f, t] = canonicalEndpoints(from, to, kind)
  return `lk-${sha256ToBase36_15(`${f.type}:${f.id}|${t.type}:${t.id}|${kind}|${discriminator(kind, meta)}`)}`
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
  const [from, to] = canonicalEndpoints(input.from, input.to, kind)
  // buildLinkId 内部做同样的 canonical，保证 id 与落库方向恒一致
  const id = buildLinkId(input.from, input.to, kind, input.meta)
  const now = Date.now()
  await storage.transaction(
    [...new Set([from.type, to.type, 'links', 'syncQueue'])],
    async (tx) => {
      for (const ep of [from, to]) {
        const rec = await tx.get<{ id: string }>(ep.type, ep.id)
        if (!rec || rec.deleted) {
          throw new Error(`linkAtoms: 端点不存在或已删除（${ep.type}:${ep.id}）`)
        }
      }
      const prev = await tx.get<Link>('links', id)
      const reviving = prev?.deleted === 1
      await tx.put('links', {
        id,
        fromType: from.type,
        fromId: from.id,
        toType: to.type,
        toId: to.id,
        kind,
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

import {
  buildLinkId,
  legacyLinkSpecs,
  LEGACY_LINK_FIELDS,
  MIGRATED_LINK_TABLES,
} from '@/repositories/linkId'

/**
 * v15 迁移体：把旧形态关联字段翻成 links 记录（迁移族由 MIGRATED_LINK_TABLES 圈定，
 * Phase 2 逐族扩大；db.ts 的 version(15).upgrade 与 migrateV15.test.ts 共用本实现 ——
 * 单一事实源，不复制迁移体）。
 *
 * 派生 link 的盖章纪律：`updatedAt: 0 / rev: 0 / deleted: 0`，且**不入同步队列** ——
 * 派生行给最低优先级戳，远端真实 link 记录一到即按 LWW 胜出；本端后续真实编辑
 * （linkAtoms 同 id 覆盖）自然会盖真戳并入队。不入队的理由：多端各自从同一份旧字段
 * 派生，确定性 id 保证天然合流，推到服务端反而要处理「双端同 POST 同 localId」的
 * 竞态（v11 数组迁移无此问题，links 是独立记录故有此设计）。
 *
 * 端点已删/缺失的旧关联跳过（关联在语义上已解绑）；旧键就地清掉（双写不双读）。
 */
export interface LegacyMigrateTable {
  toArray(): Promise<Record<string, unknown>[]>
  get(id: string): Promise<Record<string, unknown> | undefined>
  put(record: Record<string, unknown>): Promise<unknown>
  update(id: string, patch: Record<string, unknown>): Promise<unknown>
}

export async function migrateLegacyLinks(
  tableOf: (name: string) => LegacyMigrateTable,
): Promise<number> {
  let derived = 0
  for (const table of MIGRATED_LINK_TABLES) {
    const rows = await tableOf(table).toArray()
    for (const rec of rows) {
      const rid = typeof rec.id === 'string' ? rec.id : ''
      if (!rid) continue
      const specs = legacyLinkSpecs(table, rec)
      for (const s of specs) {
        // 端点存活性：指向已删/不存在实体的旧关联，语义上已解绑，不迁移成 link
        const from = await tableOf(s.from.type).get(s.from.id)
        if (!from || from.deleted) continue
        const to = await tableOf(s.to.type).get(s.to.id)
        if (!to || to.deleted) continue
        const id = buildLinkId(s.from, s.to, s.kind, s.meta)
        if (await tableOf('links').get(id)) continue // 幂等：已有同语义 link 不重复派生
        await tableOf('links').put({
          id,
          fromType: s.from.type,
          fromId: s.from.id,
          toType: s.to.type,
          toId: s.to.id,
          kind: s.kind,
          ...(s.meta ? { meta: s.meta } : {}),
          createdAt: s.createdAt ?? 0,
          updatedAt: 0,
          rev: 0,
          deleted: 0,
        })
        derived++
      }
      if (specs.length > 0) {
        const patch: Record<string, unknown> = {}
        for (const key of LEGACY_LINK_FIELDS[table] ?? []) patch[key] = undefined
        await tableOf(table).update(rid, patch)
      }
    }
  }
  return derived
}

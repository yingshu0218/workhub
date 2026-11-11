import { storage } from '@/storage'
import { queryRows } from '@/storage/scoped'
import type { Activity, Interaction, Link } from '@/db/types'
import type { PutInput, Repository } from './repository'
import { projectInteractions } from '@/domain/activityProjection'
import { putLinkTx, cascadeSoftDeleteLinks } from './links'
import type { StorageTx } from '@/storage/types'

export async function putInteractionActivity(tx: StorageTx, input: PutInput<Interaction>, now: number, previousIdentity?: Pick<Interaction, 'customerId' | 'projectId'>): Promise<string> {
  const mapped = await queryRows<Activity>(tx, 'activities', { where: { sourceTable: 'interactions', sourceId: input.id } })
  const id = mapped[0]?.id || input.id, previous = await tx.get<Activity>('activities', id)
  if (previous?.deleted) throw new Error('DELETED: 请显式恢复事件')
  if (input.rev !== undefined && previous && input.rev !== previous.rev) throw new Error('VERSION_CONFLICT: 沟通已修改')
  await tx.put('activities', { ...previous, id, title: previous?.title || input.content.slice(0, 60), summary: input.content, occurredAt: input.at, recordedAt: previous?.recordedAt ?? now, timePrecision: previous?.timePrecision || 'minute', timeZone: previous?.timeZone || 'Asia/Shanghai', category: 'communication', tags: previous?.tags || [], rev: (previous?.rev || 0) + 1, updatedAt: now, deleted: 0 } as Activity)
  await tx.enqueue('activities', id, 'upsert', now)
  if (previous) {
    const current = await queryRows<Link>(tx, 'links', { where: { fromType: 'activities', fromId: id, kind: 'related' } })
    for (const [type, next, old] of [['customers', input.customerId, previousIdentity?.customerId], ['projects', input.projectId, previousIdentity?.projectId]] as const) {
      // 旧入口只修改其选中的单身份；事件中的其它参与者保持独立关联。
      const prior = old ?? current.filter(l => !l.deleted && l.toType === type).sort((a,b) => a.id < b.id ? -1 : 1)[0]?.toId
      if (prior && prior !== next) for (const link of current) if (!link.deleted && link.toType === type && link.toId === prior) {
        await tx.update('links', link.id, { deleted: 1, deletedAt: now, updatedAt: now, rev: link.rev + 1 }); await tx.enqueue('links', link.id, 'delete', now)
      }
    }
  }
  for (const [type, target] of [['customers', input.customerId], ['projects', input.projectId]] as const) if (target) {
    const endpoint = await tx.get(type, target)
    if (!endpoint || endpoint.deleted) throw new Error('REFERENCE_NOT_FOUND: ' + type + '/' + target)
    await putLinkTx(tx, { from: { type: 'activities', id }, to: { type, id: target }, kind: 'related', meta: { sourceKind: 'participation' } }, now)
  }
  return id
}
export async function listInteractionProjection(includeDeleted = false): Promise<Interaction[]> {
  const [activities, links, legacy] = await Promise.all([storage.list<Activity>('activities'), storage.list<Link>('links'), storage.list<Interaction>('interactions')])
  return projectInteractions(activities, links, legacy, { includeDeleted })
}
/** 业务副本保存活动原字段；兼容投影含重复参与者，不能用作可还原的数据源。 */
export async function exportActivityData() {
  const [all,legacy] = await Promise.all([storage.list<Activity>('activities'),storage.list<Interaction>('interactions')])
  const mapped = new Set(all.filter(a=>a.sourceTable==='interactions').map(a=>a.sourceId))
  return {activities:all.filter(a=>!a.deleted),interactions:legacy.filter(r=>!r.deleted && !mapped.has(r.id))}
}
export const interactionProjectionRepo: Repository<Interaction> = {
  async get(id) { return (await listInteractionProjection()).find(r => r.id === id) },
  list: () => listInteractionProjection(),
  async put(input) { const now = Date.now(); await storage.transaction(['activities', 'links', 'customers', 'projects', 'syncQueue'], tx => putInteractionActivity(tx, input, now)); storage.requestSync(); return input.id },
  async update(id, patch) { const old = await this.get(id); if (!old) throw new Error('NOT_FOUND: 沟通'); const now=Date.now();await storage.transaction(['activities','links','customers','projects','syncQueue'],tx=>putInteractionActivity(tx,{...old,...patch},now,old));storage.requestSync() },
  async softDelete(id) { const old = await this.get(id); if (!old) throw new Error('NOT_FOUND: 沟通'); await storage.transaction(['activities', 'links', 'syncQueue'], async tx => { const mapped = await queryRows<Activity>(tx, 'activities', { where: { sourceTable: 'interactions', sourceId: id } }); const actual = mapped[0]?.id || id, row = await tx.get<Activity>('activities', actual); if (!row) throw new Error('MIGRATION_REQUIRED: 先迁移历史沟通'); const now = Date.now(); const ids = await cascadeSoftDeleteLinks(tx, [{ type: 'activities', id: actual }], now); await tx.put('activities', { ...row, deleted: 1, deletedAt: now, updatedAt: now, rev: row.rev + 1, trashSnapshot: { children: [], links: [], cascadeLinkIds: ids } }); await tx.enqueue('activities', actual, 'delete', now) }); storage.requestSync() },
}

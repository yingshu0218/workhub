import type { Activity, Interaction, Link } from '@/db/types'

/** 旧沟通只是一种读投影；同来源已迁移时，冻结旧正文永远不会覆盖活动。 */
export function projectInteractions(activities: readonly Activity[], links: readonly Link[], legacy: readonly Interaction[] = [], filter: { customerId?: string; customerIds?: string[]; projectId?: string; includeDeleted?: boolean } = {}): Interaction[] {
  const migrated = new Set(activities.filter(a => a.sourceTable === 'interactions').map(a => a.sourceId))
  const index = new Map<string, Link[]>()
  for (const l of links) if (!l.deleted && l.fromType === 'activities') { const list = index.get(l.fromId) || []; list.push(l); index.set(l.fromId, list) }
  const matches = (i: Interaction) => (filter.includeDeleted || !i.deleted) && (!filter.customerId || i.customerId === filter.customerId) && (!filter.customerIds || filter.customerIds.includes(i.customerId)) && (!filter.projectId || i.projectId === filter.projectId)
  const rows: Interaction[] = legacy.filter(i => !migrated.has(i.id) && matches(i))
  for (const a of activities) {
    if (!filter.includeDeleted && a.deleted) continue
    const ls = index.get(a.id) || [], cids = [...new Set(ls.filter(l => l.toType === 'customers').map(l => l.toId))], pids = [...new Set(ls.filter(l => l.toType === 'projects').map(l => l.toId))]
    // 旧单客户视图逐身份展开；新的全局事件流直接使用 activity ID，不复制事件。
    for (const cid of cids.length ? cids : ['']) {
      const record: Interaction = { id: a.sourceTable === 'interactions' && a.sourceId ? a.sourceId : a.id, customerId: cid, projectId: filter.projectId && pids.includes(filter.projectId) ? filter.projectId : pids[0], content: a.summary, at: a.occurredAt, rev: a.rev, updatedAt: a.updatedAt, deleted: a.deleted, deletedAt: a.deletedAt, restoredAt: a.restoredAt }
      if (matches(record)) rows.push(record)
    }
  }
  const unique=filter.projectId?rows.filter((row,i)=>rows.findIndex(r=>r.id===row.id)===i):rows
  return unique.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

import { fail, stable, financeTotals, BUSINESS_TABLES, type Command, type Row, type Write } from './core'
import type { Scope } from './scope'
import { buildLinkId, canonicalEndpoints } from '@/repositories/linkId'
import type { LinkEndpointTable, LinkKind, LinkMeta } from '@/db/types'

export interface Select extends Scope { projection?: 'list' | 'identity' | 'link' | 'effect' | 'edge' | 'totals' | 'grouped'; excludeIds?: string[]; limit?: number; offset?: number; sort?: string; from?: number; to?: number; timeField?: string; ids?: string[]; idField?: 'localId' | 'recordId'; q?: string }
export interface PersonalHost {
  get(table: string, id: string): Row | undefined
  select(table: string, query: Select): Row[]
  groupedFinance?(activitySelection: Select): string[]
  hash(text: string): string
  now: number
  owner: string
  client: string
  can(table: string, write?: boolean): boolean
}
export interface Ref { table: string; id: string }
export const TABLE_DOMAIN: Record<string, string> = { activities: 'activity', customers: 'crm', projects: 'project', todos: 'todo', transactions: 'fin', ledgers: 'fin', notes: 'note', attachments: 'attachment', links: 'link', habits: 'habit' }
export function recordPath(table: string, id: string): string {
  const value = encodeURIComponent(id)
  return table === 'activities' ? '/activities/' + value : table === 'operations' ? '/operations/' + value : table === 'todos' ? '/todo?focus=' + value : table === 'transactions' ? '/finance?focus=' + value : table === 'customers' ? '/crm/' + value : table === 'projects' ? '/projects/' + value : table === 'notes' ? '/notes/' + value : ''
}
export function refOf(table: string, r: Row) { return { table, id: r.id, revision: Number(r.rev || 0), path: recordPath(table, r.id) } }
function text(v: unknown, max = 1000): string { return typeof v === 'string' ? v.slice(0, max) : '' }
function strings(v: unknown, max = 50): string[] {
  if (v == null) return []
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || !x || x.length > 240)) fail('INVALID_LIST', '需要有限标识/标签数组')
  return [...new Set(v as string[])]
}
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) fail('INVALID_INPUT', '需要结构化对象'); return v as Record<string, unknown> }
function list(v: unknown, max = 50): Record<string, unknown>[] { if (v == null) return []; if (!Array.isArray(v) || v.length > max) fail('LIMIT_EXCEEDED', '动作数组超限'); return v.map(object) }
function requireText(v: unknown, label: string, max = 1000): string { const s = text(v, max + 1).trim(); if (!s || s.length > max) fail('INVALID_INPUT', label); return s }
export function parseTime(v: unknown, zone = 'Asia/Shanghai'): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 8640000000000000) return v
  if (typeof v !== 'string') return fail('INVALID_DATE', '请明确发生日期与时区')
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(v)
  if (!parts) return fail('INVALID_DATE', '日期或偏移格式不合法：' + v)
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]), days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (!year || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(parts[4] || 0) > 23 || Number(parts[5] || 0) > 59 || Number(parts[6] || 0) > 59) return fail('INVALID_DATE', '日历日期不合法：' + v)
  if (parts[8] && parts[8] !== 'Z') { const offset = parts[8].slice(1).split(':').map(Number); if (offset[0] > 14 || offset[1] > 59 || offset[0] === 14 && offset[1] !== 0) return fail('INVALID_DATE', '时区偏移不合法') }
  let input = v
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    if (!['Asia/Shanghai', 'UTC'].includes(zone)) return fail('DATE_OFFSET_REQUIRED', '此时区的日期需提供明确 UTC 偏移')
    input += zone === 'UTC' ? 'T00:00:00Z' : 'T00:00:00+08:00'
  } else if (!/(Z|[+-]\d\d:\d\d)$/.test(v)) return fail('DATE_OFFSET_REQUIRED', '日期时间必须含 UTC 偏移')
  const n = Date.parse(input)
  if (!Number.isFinite(n)) return fail('INVALID_DATE', v)
  return n
}
export function rangeEnd(v: unknown, zone = 'Asia/Shanghai'): number { return parseTime(v, zone) + (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? 86399999 : 0) }
function live(h: PersonalHost, table: string, id: string): Row {
  if (!h.can(table)) fail('FORBIDDEN', table)
  const r = h.get(table, id)
  if (!r || r.deleted) return fail('NOT_FOUND', table + '/' + id)
  return r
}
function endpoint(type: string, id: string): Scope { return { anyOf: [{ fromType: type, fromId: id }, { toType: type, toId: id }] } }
function links(h: PersonalHost, type: string, id: string, limit = 1000): Row[] {
  const rows = h.select('links', { ...endpoint(type, id), where:{deleted:0}, projection:'link', limit: limit + 1 })
  if (rows.length > limit) fail('LIMIT_EXCEEDED', '该对象关联超过单次范围，请缩小操作')
  return rows.filter(l => !l.deleted)
}
function other(l: Row, table: string, id: string): Ref { return l.fromType === table && l.fromId === id ? { table: String(l.toType), id: String(l.toId) } : { table: String(l.fromType), id: String(l.fromId) } }
export function activityLinkId(_h: Pick<PersonalHost, 'hash'>, from: Ref, to: Ref, kind = 'related', meta?: Record<string, unknown>): string {
  return buildLinkId({ type: from.table as LinkEndpointTable, id: from.id }, { type: to.table as LinkEndpointTable, id: to.id }, kind as LinkKind, meta as LinkMeta)
}
class Builder {
  reads = new Map<string, { table: string; id: string; rev: number | null }>()
  scans: Command['scans'] = []
  writes = new Map<string, Write>()
  result: Record<string, unknown> = {}
  constructor(readonly h: PersonalHost, readonly generation: string, readonly requestId: string, readonly kind: string, readonly input: unknown) {}
  get(table: string, id: string): Row | undefined {
    if (BUSINESS_TABLES.includes(table) && !this.h.can(table)) fail('FORBIDDEN', '缺少读取能力：' + table)
    const key = table + '/' + id
    if (this.writes.has(key)) return this.writes.get(key)?.value
    const r = this.h.get(table, id)
    this.reads.set(key, { table, id, rev: r ? Number(r.rev || 0) : null })
    return r
  }
  select(table: string, scope: Scope): Row[] {
    const rows = this.h.select(table, { ...scope, limit: 1001, sort: 'localId' })
    if (rows.length > 1000) fail('LIMIT_EXCEEDED', '单次影响范围超过一千条：' + table)
    if (BUSINESS_TABLES.includes(table)) this.scans.push({ table, scope, versions: rows.map(r => [r.id, Number(r.rev || 0)] as [string, number]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) })
    for (const r of rows) this.get(table, r.id)
    return rows
  }
  alive(table: string, id: string): Row { const r = this.get(table, id); if (!r || r.deleted) return fail('NOT_FOUND', table + '/' + id); return r }
  put(table: string, row: Row, sourceScope?: string) {
    if (!this.h.can(table, true)) fail('FORBIDDEN', '缺少写能力：' + table)
    this.get(table, row.id)
    this.writes.set(table + '/' + row.id, { table, id: row.id, kind: 'put', value: row, sourceScope })
  }
  id(kind: string, key: string) { return kind + '-' + this.h.hash(this.h.owner + '/' + this.requestId + '/' + kind + '/' + key).slice(0, 32) }
  link(from: Ref, to: Ref, sourceScope?: string, kind = 'related', meta: Record<string, unknown> = {}) {
    this.alive(from.table, from.id); this.alive(to.table, to.id)
    const id = activityLinkId(this.h, from, to, kind, meta)
    const prev = this.get('links', id)
    const evidence = sourceScope && (this.writes.has('activities/' + sourceScope) || this.h.get('activities', sourceScope)) ? sourceScope : undefined
    const oldMeta = prev?.meta && typeof prev.meta === 'object' ? prev.meta as Record<string, unknown> : {}
    const sourceIds = [...new Set([...strings(oldMeta.sourceActivityIds), ...(typeof oldMeta.sourceActivityId === 'string' ? [oldMeta.sourceActivityId] : []), ...(evidence ? [evidence] : [])])]
    const merged = { ...oldMeta, ...meta, ...(evidence ? { sourceActivityId: evidence, sourceActivityIds: sourceIds.slice(-50) } : {}) }
    const [f, t] = canonicalEndpoints({ type: from.table as LinkEndpointTable, id: from.id }, { type: to.table as LinkEndpointTable, id: to.id }, kind as LinkKind)
    this.put('links', { id, fromType: f.type, fromId: f.id, toType: t.type, toId: t.id, kind, meta: merged, createdAt: prev?.createdAt || this.h.now, deleted: 0, ...(prev?.deleted ? { restoredAt: this.h.now } : {}) }, sourceScope)
  }
  unlinkFor(table: string, id: string) {
    const ids: string[]=[]
    for (const persisted of this.select('links', endpoint(table, id))) {
      const l=this.get('links',persisted.id)!
      if(!l.deleted){this.put('links', { ...l, deleted: 1, deletedAt: this.h.now }, String(l.fromType === 'activities' ? l.fromId : ''));ids.push(l.id)}
    }
    return ids
  }
  command(): Command {
    return { protocol: 1, generation: this.generation, requestId: this.requestId, operationId: this.h.hash(this.h.owner + '/' + this.requestId).slice(0, 15), kind: this.kind, intent: { kind: this.kind, input: this.input }, reads: [...this.reads.values()], scans: this.scans, writes: [...this.writes.values()], result: this.result }
  }
}

function capture(b: Builder, d: Record<string, unknown>) {
  const contacts = new Map<string, string>(), topics = new Map<string, string>(), seen = new Set<string>()
  const key = (v: unknown) => { const k = requireText(v, '每项需要稳定 key', 80); if (seen.has(k)) fail('DUPLICATE_KEY', k); seen.add(k); return k }
  for (const c of list(d.contacts)) {
    const k = key(c.key), id = c.id ? String(c.id) : b.id('contact', k)
    if (c.id) b.alive('customers', id)
    else b.put('customers', { id, name: requireText(c.name, '联系人姓名', 120), aliases: strings(c.aliases), preferredName: text(c.preferredName, 120), contactType: c.contactType || 'unspecified', company: text(c.company, 120), title: text(c.title,120), decisionLevel:'', tags: [], phone: text(c.phone,120), wechat: text(c.wechat,120), email: text(c.email,240), address: text(c.address,500), lastContactAt: 0, createdAt: b.h.now })
    contacts.set(k, id)
  }
  for (const p of list(d.topics)) {
    const k = key(p.key), id = p.id ? String(p.id) : b.id('topic', k)
    if (p.id) b.alive('projects', id)
    else b.put('projects', { id, name: requireText(p.name, '事项名称', 160), aliases: strings(p.aliases), color: '#0065b8', status: 'active', createdAt: b.h.now })
    topics.set(k, id)
  }
  const events = list(d.activities, 20)
  if (!events.length) fail('INVALID_CAPTURE', '至少一项已发生经历')
  const created: Ref[] = [], duplicateEvidence: unknown[] = []
  for (const a of events) {
    const k = key(a.key), id = b.id('activity', k), scope = id
    const zone = requireText(a.timeZone || d.timeZone || 'Asia/Shanghai', '时区', 80)
    const precision = a.timePrecision || 'date'
    if (!['date', 'minute', 'range'].includes(String(precision))) fail('INVALID_TIME_PRECISION', k)
    const at = parseTime(a.occurredAt, zone), until = a.occurredUntil == null ? null : parseTime(a.occurredUntil, zone)
    if (at > b.h.now + 60000 || until && until > b.h.now + 60000) fail('NOT_OCCURRED', '未来计划请记录为待办')
    if ((until && until < at) || (precision === 'range' && !until)) fail('INVALID_TIME_RANGE', k)
    const cids = strings(a.contactIds).map(x => contacts.get(x) || x), pids = strings(a.topicIds).map(x => topics.get(x) || x)
    b.put('activities', { id, title: requireText(a.title, '事件主题', 240), summary: requireText(a.summary || a.title, '事件摘要', 4000), occurredAt: at, occurredUntil: until, timePrecision: precision, timeZone: zone, recordedAt: b.h.now, category: text(a.category, 60), tags: strings(a.tags), sourceOperationId: b.command().operationId, sourceText: text(a.sourceText, 8000), deleted: 0 }, scope)
    for (const cid of cids) {
      const c = b.alive('customers', cid)
      b.link({ table: 'activities', id }, { table: 'customers', id: cid }, scope, 'related', { sourceKind: 'participation' })
      if (a.category === 'communication') b.put('customers', { ...c, lastContactAt: Math.max(Number(c.lastContactAt || 0), at) }, scope)
    }
    for (const pid of pids) b.link({ table: 'activities', id }, { table: 'projects', id: pid }, scope)
    for (const t of list(a.transactions, 20)) {
      const tid = t.existingId ? String(t.existingId) : b.id('transaction', key(t.key))
      if (t.existingId) b.alive('transactions', tid)
      else {
        if (t.fact !== 'occurred') fail('NOT_OCCURRED', '报价、开票和预计收款不能作为实际收支；请明确 fact=occurred')
        if (!Number.isSafeInteger(t.amountMinor) || Number(t.amountMinor) <= 0) fail('MONEY_PRECISION', 'amountMinor 为正整数分')
        const ledger = b.alive('ledgers', requireText(t.ledgerId, '请指定账本', 240))
        if (t.currency !== ledger.currency) fail('CURRENCY_CONFLICT', tid)
        const candidates = b.h.select('transactions', { where: { ledgerId: ledger.id, type: String(t.type) }, from: at - 86400000, to: at + 86400000, timeField: 'occurredAt', limit: 1001 }).filter(r => !r.deleted && r.amountMinor === t.amountMinor && r.currency === t.currency)
        if (candidates.length) duplicateEvidence.push({ key: t.key, candidates: candidates.slice(0, 10).map(r => refOf('transactions', r)), truncated: candidates.length > 10 })
        if (candidates.length && t.duplicateDecision !== 'new') fail('DUPLICATE_REVIEW_REQUIRED', JSON.stringify(duplicateEvidence))
        b.put('transactions', { id: tid, ledgerId: ledger.id, type: t.type, amountMinor: t.amountMinor, amount: Number(t.amountMinor) / 100, currency: t.currency, summary: requireText(t.summary || a.title, '流水摘要', 240), channel: text(t.channel, 120), status: t.status || '待对账', occurredAt: t.occurredAt == null ? at : parseTime(t.occurredAt, zone), tags: [], note: text(t.note, 2000) }, scope)
      }
      b.link({ table: 'activities', id }, { table: 'transactions', id: tid }, scope, 'related', { sourceKind: 'finance' })
      for (const cid of cids) b.link({ table: 'transactions', id: tid }, { table: 'customers', id: cid }, scope)
      for (const pid of pids) b.link({ table: 'transactions', id: tid }, { table: 'projects', id: pid }, scope)
    }
    for (const t of list(a.tasks, 20)) {
      const tid = t.existingId ? String(t.existingId) : b.id('todo', key(t.key))
      if (t.existingId) b.alive('todos', tid)
      else b.put('todos', { id: tid, title: requireText(t.title, '承诺内容', 240), desc: text(t.desc, 4000), priority: t.priority || 'none', status: 'todo', dueAt: t.dueAt == null ? null : parseTime(t.dueAt, zone), customerId: cids[0] || null, projectId: pids[0] || null, createdAt: b.h.now, tags: [] }, scope)
      b.link({ table: 'activities', id }, { table: 'todos', id: tid }, scope)
      for (const cid of cids) b.link({ table: 'todos', id: tid }, { table: 'customers', id: cid }, scope)
    }
    for (const r of list(a.records)) { const table = String(r.table), rid = requireText(r.id, '关联对象', 240); if (!['notes', 'attachments'].includes(table)) fail('INVALID_REFERENCE', table); b.link({ table: 'activities', id }, { table, id: rid }, scope, table === 'attachments' ? 'attachment' : 'related') }
    for (const r of list(a.relations, 20)) { const fromId = contacts.get(String(r.fromContactId)) || String(r.fromContactId), toId = contacts.get(String(r.toContactId)) || String(r.toContactId); if (fromId === toId) fail('INVALID_RELATION', '不能关联自身'); b.link({ table: 'customers', id: fromId }, { table: 'customers', id: toId }, scope, 'relation', { label: requireText(r.label, '明确关系语义', 120), category: r.category || 'person', sourceKind: 'explicit' }) }
    created.push({ table: 'activities', id })
  }
  b.result = { records: created.map(r => ({ ...r, path: recordPath(r.table, r.id) })), duplicateEvidence, referenceAt: d.referenceAt || b.h.now, timeZone: d.timeZone || 'Asia/Shanghai' }
}
const PATCH_FIELDS: Record<string, readonly string[]> = {
  activities: ['title', 'summary', 'occurredAt', 'occurredUntil', 'timePrecision', 'timeZone', 'category', 'tags'],
  customers: ['name', 'aliases', 'preferredName', 'contactType', 'company', 'title', 'phone', 'email', 'wechat', 'address', 'tags'],
  projects: ['name', 'aliases', 'status', 'note'],
  transactions: ['amountMinor', 'summary', 'note', 'status', 'occurredAt', 'ledgerId', 'currency'],
  todos: ['title', 'desc', 'dueAt', 'status', 'priority', 'customerId', 'projectId', 'tags'], notes: ['title', 'markdown', 'projectId', 'tags'],
}
function amend(b: Builder, d: Record<string, unknown>) {
  const changes = list(d.changes, 50)
  if (!changes.length) fail('INVALID_AMEND', '请指定修正对象')
  const diffs: unknown[] = []
  for (const change of changes) {
    const table = String(change.table), id = requireText(change.id, '对象 ID', 240), old = b.alive(table, id), patch = { ...object(change.patch || {}) }
    if (change.expectedRev !== old.rev) fail('VERSION_CONFLICT', table + '/' + id)
    for (const field of Object.keys(patch)) if (!PATCH_FIELDS[table]?.includes(field)) fail('INVALID_PATCH', table + '/' + field)
    const zone = String(patch.timeZone || change.timeZone || old.timeZone || 'Asia/Shanghai')
    for (const field of table === 'activities' ? ['occurredAt', 'occurredUntil'] : table === 'transactions' ? ['occurredAt'] : table === 'todos' ? ['dueAt'] : []) if (Object.prototype.hasOwnProperty.call(patch, field)) {
      if (patch[field] == null) { if (field === 'occurredAt') fail('INVALID_DATE', '发生日期不可清空') }
      else patch[field] = parseTime(patch[field], zone)
    }
    const next: Row = { ...old, ...patch }
    if(table==='activities' && (Number(next.occurredAt)>b.h.now+60000 || Number(next.occurredUntil)>b.h.now+60000))fail('NOT_OCCURRED','未来计划请记录为待办')
    if (table === 'transactions' && patch.amountMinor !== undefined) { if (!Number.isSafeInteger(patch.amountMinor) || Number(patch.amountMinor) <= 0) fail('MONEY_PRECISION', id); next.amount = Number(patch.amountMinor) / 100 }
    if (table === 'todos' && patch.status !== undefined) {
      if (!['todo', 'done', 'voided'].includes(String(patch.status))) fail('INVALID_STATUS', id)
      next.completedAt = patch.status === 'done' ? b.h.now : null; next.voidedAt = patch.status === 'voided' ? b.h.now : null
    }
    b.put(table, next, table === 'activities' ? id : undefined)
    diffs.push({ ...refOf(table, old), before: bounded(pick(old, Object.keys(patch))), after: bounded(pick(next, Object.keys(patch))) })
    if (['activities', 'transactions', 'todos'].includes(table)) for (const pair of [['contactIds', 'customers'], ['topicIds', 'projects']]) {
      if (change[pair[0]] === undefined) continue
      const wanted = strings(change[pair[0]])
      const existing = b.select('links', { where: { fromType: table, fromId: id, toType: pair[1], kind: 'related' } })
      for (const l of existing) if (!l.deleted && !wanted.includes(String(l.toId))) b.put('links', { ...l, deleted: 1, deletedAt: b.h.now }, id)
      for (const target of wanted) b.link({ table, id }, { table: pair[1], id: target }, id)
      if (table === 'todos') b.put(table, { ...b.alive(table, id), [pair[0] === 'contactIds' ? 'customerId' : 'projectId']: wanted[0] || null })
      diffs.push({ table, id, relation: pair[0], before: existing.filter(l => !l.deleted).map(l => l.toId), after: wanted })
    }
  }
  b.result = { differences: diffs }
}
function dependencies(b: Builder, table: string, id: string, included: Set<string>) {
  for (const l of b.select('links', endpoint(table, id))) if (!l.deleted && !included.has('links/' + l.id)) fail('DEPENDENCY_CONFLICT', '后续关联：links/' + l.id)
  for (const pair of (table === 'customers' ? [['todos', 'customerId'], ['projects', 'customerId']] : table === 'projects' ? [['todos', 'projectId'], ['notes', 'projectId']] : table === 'ledgers' ? [['transactions', 'ledgerId']] : [])) {
    for (const r of b.select(pair[0], { where: { [pair[1]]: id } })) if (!r.deleted && !included.has(pair[0] + '/' + r.id)) fail('DEPENDENCY_CONFLICT', pair[0] + '/' + r.id)
  }
}
function undo(b: Builder, d: Record<string, unknown>) {
  const operationId = requireText(d.operationId, 'operationId', 80), op = b.h.get('operations', operationId)
  if (!op || op.status !== 'committed') fail('NOT_FOUND', operationId)
  const all = b.h.select('operation_effects', { where: { operationId }, limit: 501 })
  if (all.length > 500) fail('LIMIT_EXCEEDED', '撤销范围超限')
  const chosen = d.effectIds === undefined ? all : all.filter(e => strings(d.effectIds, 500).includes(e.id))
  if (!chosen.length) fail('INVALID_UNDO', '没有选中可撤销变更')
  const included = new Set(chosen.map(e => e.tableName + '/' + e.recordId))
  const differences: unknown[] = []
  for (const e of chosen) {
    if (e.redacted || e.action === 'purge') fail('REDACTED_NOT_RECOVERABLE', String(e.recordId))
    const table = String(e.tableName), id = String(e.recordId), current = b.get(table, id)
    if (!current || Number(current.rev || 0) !== e.afterRev) fail('DEPENDENCY_CONFLICT', '后续修改：' + table + '/' + id)
    if (e.action === 'create') { dependencies(b, table, id, included); b.put(table, { ...current, deleted: 1, deletedAt: b.h.now }) }
    else { const before = object(e.before); b.put(table, { ...before, id, rev: current.rev, ...(current.deleted && !before.deleted ? { restoredAt: b.h.now } : {}) }) }
    differences.push({ effectId: e.id, table, id, action: e.action === 'create' ? 'delete_created' : 'restore_previous' })
  }
  b.result = { undoOf: operationId, differences }
}
function merge(b: Builder, d: Record<string, unknown>) {
  const source = b.alive('customers', String(d.sourceId)), target = b.alive('customers', String(d.targetId))
  if (source.id === target.id) fail('INVALID_MERGE', '不能合并自身')
  if (source.rev !== d.sourceRev || target.rev !== d.targetRev) fail('VERSION_CONFLICT', '联系人版本')
  for (const l of b.select('links', endpoint('customers', source.id))) {
    if (l.deleted) continue
    const next: Row = { ...l }
    if (l.fromType === 'customers' && l.fromId === source.id) next.fromId = target.id
    if (l.toType === 'customers' && l.toId === source.id) next.toId = target.id
    b.put('links', { ...l, deleted: 1, deletedAt: b.h.now })
    if (!(next.fromType === next.toType && next.fromId === next.toId)) b.link({ table: String(next.fromType), id: String(next.fromId) }, { table: String(next.toType), id: String(next.toId) }, undefined, String(next.kind), object(next.meta || {}))
  }
  for (const table of ['todos', 'projects']) for (const row of b.select(table, { where: { customerId: source.id } })) if (!row.deleted) b.put(table, { ...row, customerId: target.id })
  b.put('customers', { ...target, aliases: [...new Set([...strings(target.aliases), String(source.name), ...strings(source.aliases)])], lastContactAt: Math.max(Number(source.lastContactAt || 0), Number(target.lastContactAt || 0)) })
  b.put('customers', { ...source, deleted: 1, deletedAt: b.h.now, mergedIntoId: target.id })
  b.result = { mergedFrom: source.id, mergedInto: target.id }
}
function remove(b: Builder, d: Record<string, unknown>, purge: boolean) {
  const targets = list(d.targets, 100), ids = new Map<string, Ref>()
  for (const t of targets) {
    const table = String(t.table), id = String(t.id)
    if (!PATCH_FIELDS[table] && table !== 'attachments') fail('INVALID_TARGET', table)
    const row = b.get(table, id); if (!row) fail('NOT_FOUND', table + '/' + id)
    if (row.rev !== t.expectedRev) fail('VERSION_CONFLICT', table + '/' + id)
    ids.set(table + '/' + id, { table, id })
    if (purge && table === 'activities') {
      for (const l of b.select('links', endpoint(table, id))) {
        const r = other(l, table, id)
        if (r.table === 'attachments') ids.set(r.table + '/' + r.id, r)
      }
      if (row.sourceTable === 'interactions' && row.sourceId && b.get('interactions',String(row.sourceId))) ids.set('interactions/' + row.sourceId, { table: 'interactions', id: String(row.sourceId) })
    }
  }
  if (!ids.size) fail('INVALID_TARGET', '请明确清理范围')
  // 共享附件不是事件的私有副本；清理必须显式覆盖所有引用来源。
  if (purge) for (const target of ids.values()) if (target.table === 'attachments') for (const l of b.select('links',endpoint('attachments',target.id))) {
    const ref = other(l,'attachments',target.id)
    if (!ids.has(ref.table+'/'+ref.id)) fail('PRIVACY_SCOPE_REQUIRED','附件仍由其他事实引用：'+ref.table+'/'+ref.id)
  }
  for (const target of [...ids.values()]) if (purge && target.table === 'customers') {
    const related = b.select('links', endpoint('customers', target.id)).filter(l => !l.deleted).map(l => other(l, 'customers', target.id)).filter(r => r.table === 'activities' && !ids.has(r.table + '/' + r.id))
    if (related.length) fail('PRIVACY_SCOPE_REQUIRED', '还需明确相关事件清理范围：' + JSON.stringify(related))
  }
  for (const { table, id } of ids.values()) {
    const row = b.get(table, id)!
    const children: Ref[] = [], scalarLinks: unknown[] = []
    if (table === 'projects') {
      for (const child of b.select('projectMilestones', { where: { projectId: id } })) if (!child.deleted) { children.push({ table: 'projectMilestones', id: child.id }); ids.set('projectMilestones/' + child.id, { table: 'projectMilestones', id: child.id }) }
      for (const t of ['todos', 'notes']) for (const r of b.select(t, { where: { projectId: id } })) if (!r.deleted) { scalarLinks.push({ table: t, id: r.id, field: 'projectId', mode: 'set', value: id }); b.put(t, { ...r, projectId: null }) }
    }
    if (table === 'transactions') for (const link of b.select('links', { where: { fromType: table, fromId: id, kind: 'attachment' } })) if (!link.deleted) { const attachment = b.get('attachments', String(link.toId)); if (attachment && !attachment.deleted) { const ref = { table: 'attachments', id: attachment.id }; children.push(ref); ids.set(ref.table + '/' + ref.id, ref) } }
    const cascadeLinkIds: string[]=[]
    if (purge) for (const l of b.select('links', endpoint(table, id))) ids.set('links/' + l.id, { table: 'links', id: l.id })
    else for(const ref of [{table,id},...children])cascadeLinkIds.push(...b.unlinkFor(ref.table,ref.id))
    if (table === 'customers') for (const t of ['todos', 'projects']) for (const r of b.select(t, { where: { customerId: id } })) if (!r.deleted) { scalarLinks.push({ table: t, id: r.id, field: 'customerId', mode: 'set', value: id }); b.put(t, { ...r, customerId: null }) }
    if (purge) {
      if (!b.h.can(table, true)) fail('FORBIDDEN', table)
      b.writes.set(table + '/' + id, { table, id, kind: 'delete', sourceScope: table === 'activities' ? id : undefined })
    } else b.put(table, { ...row, deleted: 1, deletedAt: b.h.now, trashSnapshot: { children, links: scalarLinks, cascadeLinkIds: [...new Set(cascadeLinkIds)] } })
  }
  b.result = { records: [...ids.values()], privacyCleanup: purge }
}
export function planPersonal(h: PersonalHost, kind: string, input: unknown, generation: string, requestId: string): Command {
  const d = object(input), b = new Builder(h, generation, requestId, kind, input)
  if (kind === 'capture') capture(b, d)
  else if (kind === 'amend') amend(b, d)
  else if (kind === 'undo') undo(b, d)
  else if (kind === 'merge') merge(b, d)
  else if (kind === 'delete' || kind === 'purge') remove(b, d, kind === 'purge')
  else fail('UNKNOWN_ACTION', kind)
  if (b.writes.size > 500) fail('LIMIT_EXCEEDED', '复合操作影响超过五百条')
  return b.command()
}
function pick(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> { const out: Record<string, unknown> = {}; for (const k of fields) if (row[k] !== undefined) out[k] = row[k]; return out }
function bounded(value: unknown): unknown {
  if(typeof value==='string')return value.length>500?{text:value.slice(0,500),length:value.length,truncated:true}:value
  if(Array.isArray(value))return value.slice(0,50).map(bounded)
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bounded(v)]))
  return value
}
export function projectRecord(h: Pick<PersonalHost, 'can'>, table: string, row: Row): Record<string, unknown> {
  if (!h.can(table)) return { restricted: true }
  const fields = table === 'activities' ? ['title', 'summary', 'occurredAt', 'occurredUntil', 'timePrecision', 'timeZone', 'recordedAt', 'category', 'tags', 'sourceOperationId'] : table === 'transactions' ? ['summary', 'amountMinor', 'currency', 'type', 'status', 'occurredAt', 'ledgerId'] : table === 'todos' ? ['title', 'status', 'dueAt', 'completedAt', 'voidedAt', 'priority', 'customerId', 'projectId'] : table === 'customers' ? ['name', 'aliases', 'preferredName', 'contactType', 'company', 'lastContactAt', 'tags'] : table === 'projects' ? ['name', 'aliases', 'status'] : table === 'notes' ? ['title', 'tags'] : ['name', 'mime', 'size']
  const value = pick(row, fields)
  for(const key of ['customerId','projectId','dueAt','completedAt','voidedAt','occurredUntil'])if(key in value && !value[key])value[key]=null
  const truncatedFields: string[] = []
  for(const key of Object.keys(value)) {
    if(typeof value[key]==='string' && value[key].length>500){value[key]=value[key].slice(0,500);truncatedFields.push(key)}
    if(Array.isArray(value[key])){if(value[key].length>50)truncatedFields.push(key);value[key]=value[key].slice(0,50).map((v: unknown)=>typeof v==='string'?v.slice(0,240):v)}
  }
  return { ...refOf(table, row), ...value, ...(truncatedFields.length?{truncatedFields}:{}), ...(table === 'transactions' ? { amountUnit: 'minor' } : {}) }
}
export interface FeedItem { key: string; sourceType: string; sourceId: string; at: number; record: Record<string, unknown>; operationId?: string }
export function eventFeed(h: PersonalHost, d: Record<string, unknown>, take: number): FeedItem[] {
  const from = d.from == null ? undefined : parseTime(d.from, String(d.timeZone || 'Asia/Shanghai')), to = d.to == null ? undefined : rangeEnd(d.to, String(d.timeZone || 'Asia/Shanghai'))
  let ids: string[] | undefined
  const filterRefs = [...(d.contactId ? [{ table: 'customers', id: String(d.contactId) }] : []), ...(d.topicId ? [{ table: 'projects', id: String(d.topicId) }] : [])]
  for (const filterRef of filterRefs) {
    live(h, filterRef.table, filterRef.id)
    const matched = links(h, filterRef.table, filterRef.id, 20000).map(l => other(l, filterRef.table, filterRef.id)).filter(r => r.table === 'activities').map(r => r.id)
    ids = ids ? ids.filter(id => matched.includes(id)) : matched
  }
  const out: FeedItem[] = []
  const activitySelection:Select={where:{deleted:0,...(d.category?{category:String(d.category)}:{})},ids,from,to,timeField:'occurredAt',q:text(d.q,120),sort:'-occurredAt,localId'}
  const boundedActivities=!!h.groupedFinance || d.sourceType==='activity'
  const matchingActivities = h.can('activities') && (!ids || ids.length) ? h.select('activities', {...activitySelection,projection:boundedActivities?'list':'identity',limit:boundedActivities?take:20001}) : []
  if (matchingActivities.length > 20000) fail('LIMIT_EXCEEDED', '事件范围超过两万条，请缩小日期')
  matchingActivities.sort((a,b)=>Number(b.occurredAt)-Number(a.occurredAt) || (a.id<b.id?-1:a.id>b.id?1:0))
  const selected=matchingActivities.slice(0,take)
  const displayed=boundedActivities?selected:h.select('activities',{ids:selected.map(a=>a.id),projection:'list',limit:take})
  const displayedById=new Map(displayed.map(a=>[a.id,a]))
  for (const selectedActivity of selected) {
    const a=displayedById.get(selectedActivity.id)!
    if(!a)continue
    out.push({ key: a.sourceTable && a.sourceId ? a.sourceTable + ':' + a.sourceId : 'activity:' + a.id, sourceType: 'activity', sourceId: a.id, at: Number(a.occurredAt), operationId: String(a.sourceOperationId || ''), record: projectRecord(h, 'activities', a) })
  }
  if (d.sourceType !== 'activity' && !d.category && h.can('todos')) {
    const taskIds = filterRefs.length ? taskRows(h, { ...d, status: 'all' }).map(r => r.id) : undefined
    const effects = h.select('operation_effects', { where: { tableName: 'todos' }, ids: taskIds, idField: 'recordId', from, to, timeField: 'occurredAt', sort: '-occurredAt,id', limit: 20001 })
    if (effects.length > 20000) fail('LIMIT_EXCEEDED', '执行历史范围过大，请缩小日期')
    for (const e of effects) {
      if (e.redacted || !e.before || !e.after) continue
      const before = object(e.before), after = object(e.after)
      if (before.status === after.status && before.dueAt === after.dueAt) continue
      const t = h.get('todos', String(e.recordId)); if (!t || t.deleted) continue
      out.push({ key: 'effect:' + e.id, sourceType: 'task_change', sourceId: e.id, at: Number(e.occurredAt), operationId: String(e.operationId), record: { ...projectRecord(h, 'todos', t), before: pick(before, ['status', 'dueAt']), after: pick(after, ['status', 'dueAt']) } })
    }
  }
  if (d.sourceType !== 'activity' && !d.category && h.can('transactions')) {
    let grouped:Set<string>
    if(h.groupedFinance && h.can('activities'))grouped=new Set(h.groupedFinance(activitySelection))
    else {
      const activityEdges = h.select('links', { where: { fromType: 'activities', toType: 'transactions', deleted: 0 }, projection:'edge', limit: 20001 })
      if (activityEdges.length > 20000) fail('LIMIT_EXCEEDED', '事件财务关联范围超限，请缩小查询')
      const represented = new Set(matchingActivities.map(a => a.id))
      grouped = new Set(activityEdges.filter(l => represented.has(String(l.fromId))).map(l => String(l.toId)))
    }
    if(grouped.size>20000)fail('LIMIT_EXCEEDED','事件财务关联范围超限，请缩小查询')
    const txns=h.select('transactions',{...financeSelection(h,d),excludeIds:[...grouped].map(String),limit:take})
    for (const t of txns) {
      out.push({ key: 'transaction:' + t.id, sourceType: 'legacy_finance', sourceId: t.id, at: Number(t.occurredAt), record: projectRecord(h, 'transactions', t) })
    }
  }
  const q = text(d.q, 120).toLocaleLowerCase()
  return out.filter(r => (!d.sourceType || d.sourceType === r.sourceType) && (!q || r.sourceType === 'activity' || String(r.record.title || r.record.summary || '').toLocaleLowerCase().includes(q))).sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, take)
}
export function resolvePersonal(h: PersonalHost, table: 'customers' | 'projects', d: Record<string, unknown>) {
  if (!h.can(table)) fail('FORBIDDEN', table)
  if (d.id) return { status: 'resolved', candidates: [{ ...projectRecord(h, table, live(h, table, String(d.id))), match: 'id' }], id: d.id }
  const q = requireText(d.query, '请提供姓名、别名或身份线索', 120).toLocaleLowerCase()
  const pool = h.select(table, { where: { deleted: 0 }, projection:'list', limit: 20001 })
  if (pool.length > 20000) fail('LIMIT_EXCEEDED', '请使用明确 ID')
  const ranked = pool.map(r => { const aliases = strings(r.aliases); const name = String(r.name || '').toLocaleLowerCase(); const exactIdentity = d.identity && [r.email, r.phone, r.wechat].includes(d.identity); return { r, rank: exactIdentity ? 0 : name === q ? 1 : aliases.some(s => s.toLocaleLowerCase() === q) ? 2 : (name.includes(q) || aliases.some(s => s.toLocaleLowerCase().includes(q))) ? 3 : 9 } }).filter(x => x.rank < 9).sort((a, b) => a.rank - b.rank || a.r.id.localeCompare(b.r.id))
  const best = ranked.filter(x => x.rank === ranked[0]?.rank)
  const resolved = best.length === 1 && (best[0].rank < 3 || ranked.length === 1)
  return { status: resolved ? 'resolved' : 'ambiguous', ...(resolved ? { id: best[0].r.id } : {}), candidates: ranked.slice(0, 10).map(x => ({ ...projectRecord(h, table, x.r), match: ['identity', 'name', 'alias', 'fuzzy'][x.rank] })), truncated: ranked.length > 10, reason: resolved ? undefined : ranked.length ? '请选择具体身份，名称相同不会合并' : '未找到，请确认或在整组预览内新建' }
}
export function taskRows(h: PersonalHost, d: Record<string, unknown>): Row[] {
  if (!h.can('todos')) fail('FORBIDDEN', 'todos')
  let ids:Set<string>|undefined
  for(const [key,table,field] of [['contactId','customers','customerId'],['topicId','projects','projectId']])if(d[key]){
    const id=String(d[key]),direct=h.select('todos',{where:{[field]:id,deleted:0},projection:'list',limit:20001})
    if(direct.length>20000)fail('LIMIT_EXCEEDED','待办关联范围超限')
    const next=new Set([...direct.map(t=>t.id),...links(h,table,id,20000).map(l=>other(l,table,id)).filter(r=>r.table==='todos').map(r=>r.id)])
    ids=ids?new Set([...ids].filter(value=>next.has(value))):next
  }
  const rows = h.select('todos', { where: { deleted: 0, ...(d.status === 'all' ? {} : { status: String(d.status || 'todo') }) }, ...(ids?{ids:[...ids]}:{}), projection:'list', limit: 20001, sort: 'dueAt,localId' })
  if (rows.length > 20000) fail('LIMIT_EXCEEDED', '请缩小待办范围')
  const now = Number(d.referenceAt || h.now), zone = String(d.timeZone || 'Asia/Shanghai')
  if (!['Asia/Shanghai', 'UTC'].includes(zone)) fail('UNSUPPORTED_TIME_ZONE', '日界查询当前支持 Asia/Shanghai 与 UTC；其它时区请明确绝对范围')
  const day = Math.floor((now + (zone === 'Asia/Shanghai' ? 28800000 : 0)) / 86400000)
  return rows.filter(t => d.due === 'undated' ? !t.dueAt : d.due === 'today' ? !!t.dueAt && Math.floor((Number(t.dueAt) + (zone === 'Asia/Shanghai' ? 28800000 : 0)) / 86400000) === day : d.due === 'overdue' ? !!t.dueAt && Math.floor((Number(t.dueAt) + (zone === 'Asia/Shanghai' ? 28800000 : 0)) / 86400000) < day : true)
}
export function financeSelection(h: PersonalHost,d:Record<string,unknown>):Select {
  if(!h.can('transactions'))fail('FORBIDDEN','transactions')
  const where:Record<string,string|number>={deleted:0}
  for(const k of ['ledgerId','type','status'])if(d[k])where[k]=String(d[k])
  let ids:Set<string>|undefined
  const targets=[...(d.contactId?[{table:'customers',id:String(d.contactId)}]:[]),...(d.topicId?[{table:'projects',id:String(d.topicId)}]:[])]
  for(const target of targets){live(h,target.table,target.id);const next=new Set(links(h,target.table,target.id,20000).map(l=>other(l,target.table,target.id)).filter(r=>r.table==='transactions').map(r=>r.id));ids=ids?new Set([...ids].filter(id=>next.has(id))):next}
  return {where,...(ids?{ids:[...ids]}:{}),q:text(d.q,120),from:d.from==null?undefined:parseTime(d.from,String(d.timeZone || 'Asia/Shanghai')),to:d.to==null?undefined:rangeEnd(d.to,String(d.timeZone || 'Asia/Shanghai')),timeField:'occurredAt',sort:'-occurredAt,localId',projection:'list'}
}
export function financeRows(h:PersonalHost,d:Record<string,unknown>):Row[]{
  const rows=h.select('transactions',{...financeSelection(h,d),limit:20001})
  if(rows.length>20000)fail('LIMIT_EXCEEDED','请缩小财务范围')
  return rows
}

export { financeTotals, stable, links as personalLinks, other as otherEndpoint, pick as pickFields }

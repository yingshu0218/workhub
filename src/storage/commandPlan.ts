import type { StorageAdapter, StorageTx } from './types'
import { fail, stable, type Command, type Row, type Write } from '@/commands/core'
import { inScope } from '@/commands/scope'
import { nanoid } from 'nanoid'

export interface Receipt {
  operationId: string
  requestId: string
  generation: string
  sequence?: number
  changes: { table: string; id: string; row: Row | null }[]
  result?: unknown
}
export interface CommandTransport {
  stageAttachment?(row: Row, blob: Blob): Promise<string>
  preview?(command: Command): Promise<Command>
  generation(): Promise<string>
  commit(command: Command): Promise<Receipt>
  lookup(requestId: string, generation: string, intent?: unknown): Promise<{ committed: boolean; receipt?: Receipt; pending?: Command }>
}
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
export function stagePlan(source: Pick<StorageAdapter, 'get' | 'list' | 'query'>) {
  const reads = new Map<string, { table: string; id: string; rev: number | null }>()
  const cache = new Map<string, Row | undefined>()
  const writes = new Map<string, Write>()
  const uploads = new Map<string, Blob>()
  const scans = new Map<string, [string, number][]>()
  const scopedScans: Command['scans'] = []
  const key = (table: string, id: string) => table + '/' + id
  async function get(table: string, id: string): Promise<Row | undefined> {
    const k = key(table, id)
    if (!cache.has(k)) {
      const row = await source.get<Row>(table, id)
      reads.set(k, { table, id, rev: row ? Number(row.rev || 0) : null })
      cache.set(k, copy(row))
    }
    return copy(cache.get(k))
  }
  const tx: StorageTx = {
    get: async (table, id) => await get(table, id) as never,
    async query(table, scope) {
      const rows = source.query ? await source.query<Row>(table, scope) : (await source.list<Row>(table)).filter(r => inScope(r, scope))
      if (rows.length > 1000) fail('LIMIT_EXCEEDED', '关联范围超过单次提交上限')
      scopedScans.push({ table, scope, versions: rows.map(r => [r.id, Number(r.rev || 0)] as [string, number]).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) })
      for (const r of rows) if (!cache.has(key(table,r.id))) { reads.set(key(table,r.id),{table,id:r.id,rev:Number(r.rev || 0)});cache.set(key(table,r.id),copy(r)) }
      const ids = new Set([...rows.map(r => r.id), ...[...writes.values()].filter(w => w.table === table && w.value && inScope(w.value, scope)).map(w => w.id)])
      return [...ids].map(id => copy(cache.get(key(table,id)))).filter((r): r is Row => !!r && inScope(r, scope)) as never
    },
    async list(table) {
      const rows = await source.list<Row>(table)
      if (rows.length > 20000) fail('LIMIT_EXCEEDED', '集合超过本版命令扫描上限')
      scans.set(table, rows.map(r => [r.id, Number(r.rev || 0)] as [string, number]).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      for (const r of rows) if (!cache.has(key(table, r.id))) {
        reads.set(key(table, r.id), { table, id: r.id, rev: Number(r.rev || 0) }); cache.set(key(table, r.id), copy(r))
      }
      const ids = new Set([...rows.map(r => r.id), ...[...writes.values()].filter(w => w.table === table).map(w => w.id)])
      return [...ids].map(id => copy(cache.get(key(table, id)))).filter(Boolean) as never
    },
    async put(table, record) {
      await get(table, record.id)
      const blob = (record as unknown as Row).blob
      if (typeof Blob !== 'undefined' && blob instanceof Blob) uploads.set(record.id, blob)
      // undefined 必须随 JSON 明确传成 null；服务端完整替换避免可选字段刷新后反弹。
      const row = JSON.parse(JSON.stringify(record, (_k, v: unknown) => v === undefined ? null : v)) as Row
      delete row.blob
      cache.set(key(table, row.id), row)
      writes.set(key(table, row.id), { table, id: row.id, kind: 'put', value: row })
    },
    async update(table, id, patch) {
      const prev = await get(table, id)
      if (!prev) fail('NOT_FOUND', table + '/' + id)
      await tx.put(table, { ...prev, ...patch, id })
    },
    async delete(table, id) {
      const prev = await get(table, id)
      if (!prev) fail('NOT_FOUND', table + '/' + id)
      writes.set(key(table, id), { table, id, kind: 'delete' }); cache.set(key(table, id), undefined)
    },
    async enqueue() {},
  }
  return {
    tx,
    uploads,
    writes: () => [...writes.values()],
    command(generation: string, requestId: string, intent?: unknown, result?: unknown): Command {
      const cleanup = [...writes.values()].some(w => w.kind === 'delete' && w.table === 'activities')
      return { protocol: 1, generation, requestId, ...(cleanup ? { kind: 'purge' } : {}), ...(intent === undefined ? {} : { intent }), reads: [...reads.values()], scans: [...[...scans].map(([table, versions]) => ({ table, versions })), ...scopedScans], writes: [...writes.values()], result }
    },
  }
}
// IP 直连的 HTTP 页面没有 randomUUID；沿用已有 nanoid 的 getRandomValues 安全随机源。
export function requestId(): string { return 'req_' + nanoid(32) }
/** UI 相同实体与版本的网络重试沿用请求号；不同 payload 由服务端指纹拒绝。 */
export function planRequestId(writes: Write[]): string {
  const first = writes[0]
  if (!first) return requestId()
  // 请求号不包含正文或姓名，避免操作索引泄漏内容；业务 ID 本身已随机化。
  return ('ui_' + first.id.replace(/[^A-Za-z0-9:_-]/g, '_') + '_' + (first.value?.rev ?? 'purge')).slice(0, 128)
}
export function payloadIntent(writes: Write[]): unknown {
  return writes.map(w => ({ ...w, value: w.value ? Object.fromEntries(Object.entries(w.value).filter(([k]) => !['updatedAt', 'createdAt', 'deletedAt', 'restoredAt', 'rev', 'stagedFileId'].includes(k))) : undefined }))
}
export { stable }

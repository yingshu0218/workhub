/** 宿主无关的命令契约；JSVM / Node / 浏览器共用，禁止在这里引入 I/O。 */
export type Row = { id: string; rev?: number; deleted?: number; [key: string]: unknown }
export type Write = { table: string; id: string; kind: 'put' | 'delete'; value?: Row }
export type ReadVersion = { table: string; id: string; rev: number | null }
export interface Command {
  protocol: 1
  generation: string
  requestId: string
  intent?: unknown
  reads: ReadVersion[]
  scans: { table: string; versions: [string, number][] }[]
  writes: Write[]
  result?: unknown
  events?: { type: string; payload: unknown; occurredAt: number }[]
}
export const BUSINESS_TABLES = ['workspaces', 'customers', 'interactions', 'ledgers', 'transactions',
  'todos', 'todoLists', 'notes', 'noteFolders', 'quickNotes', 'projects', 'projectMilestones',
  'habits', 'habitLogs', 'trophies', 'attachments', 'moduleConfigs', 'customerGroups', 'links']
export function stable(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable((value as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(value)
}
export function fail(code: string, detail: string): never { throw new Error(code + ': ' + detail) }
export function minorUnits(value: unknown): number {
  const text = String(value)
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return fail('MONEY_PRECISION', '金额须为最多两位小数，不能静默舍入：' + text)
  const negative = text[0] === '-'
  const parts = (negative ? text.slice(1) : text).split('.')
  const cents = Number(parts[0]) * 100 + Number(((parts[1] || '') + '00').slice(0, 2))
  if (!Number.isSafeInteger(cents)) return fail('MONEY_RANGE', '金额超出安全整数范围')
  return negative ? -cents : cents
}
export function checkCommand(c: Command): void {
  if (!c || c.protocol !== 1) fail('UPGRADE_REQUIRED', '请升级到命令协议 1')
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(c.requestId || '')) fail('INVALID_REQUEST_ID', '需要稳定请求标识')
  if (!c.generation) fail('GENERATION_REQUIRED', '先获取数据世代')
  if (!Array.isArray(c.reads) || !Array.isArray(c.scans) || !Array.isArray(c.writes) || c.writes.length > 500 || c.reads.length > 20000 || c.scans.length > 24) fail('LIMIT_EXCEEDED', '命令规模超限')
  const seen: Record<string, boolean> = {}
  for (const w of c.writes) {
    if (!BUSINESS_TABLES.includes(w.table) || !w.id || w.id.length > 240 || !['put', 'delete'].includes(w.kind)) fail('INVALID_WRITE', '集合、标识或动作非法')
    const key = w.table + '/' + w.id
    if (seen[key]) fail('INVALID_WRITE', '重复目标：' + key)
    seen[key] = true
    if (!c.reads.some(r => r.table === w.table && r.id === w.id)) fail('VERSION_REQUIRED', key)
    if (w.kind === 'put' && (!w.value || w.value.id !== w.id)) fail('INVALID_WRITE', key)
  }
  for (const r of c.reads) if (!BUSINESS_TABLES.includes(r.table)) fail('INVALID_READ', r.table)
  for (const s of c.scans) if (!BUSINESS_TABLES.includes(s.table) || !Array.isArray(s.versions) || s.versions.length > 20000) fail('INVALID_SCAN', s.table)
}
/** 在事务内调用；get 返回包含本计划前序变更的权威记录，拒绝悬挂引用。 */
export function validateRecord(table: string, next: Row, prev: Row | undefined, get: (table: string, id: string) => Row | undefined): void {
  if (prev?.deleted && !next.deleted && !next.restoredAt) fail('DELETED', '请从回收站显式恢复：' + next.id)
  if (next.deleted) return
  const requireRef = (target: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    if (typeof value !== 'string') fail('INVALID_REFERENCE', target)
    const ref = get(target, value as string)
    if (!ref || ref.deleted) fail('REFERENCE_NOT_FOUND', target + '/' + String(value))
  }
  const refs: Record<string, Record<string, string>> = {
    transactions: { ledgerId: 'ledgers' }, interactions: { customerId: 'customers', projectId: 'projects' },
    todos: { customerId: 'customers', projectId: 'projects' }, projects: { customerId: 'customers' },
    projectMilestones: { projectId: 'projects' }, habitLogs: { habitId: 'habits' },
  }
  for (const field of Object.keys(refs[table] || {})) requireRef(refs[table][field], next[field])
  if (table === 'links') {
    for (const side of ['from', 'to']) {
      const target = String(next[side + 'Type'] || '')
      if (!BUSINESS_TABLES.includes(target)) fail('INVALID_REFERENCE', target)
      if (!next[side + 'Id']) fail('INVALID_REFERENCE', side)
      requireRef(target, next[side + 'Id'])
    }
  }
  if (table === 'transactions') {
    if (!next.ledgerId || !['income', 'expense'].includes(String(next.type)) || !String(next.summary || '').trim()) fail('INVALID_TRANSACTION', next.id)
    const cents = minorUnits(next.amount)
    if (cents <= 0) fail('INVALID_TRANSACTION', '金额须为正数')
    if (next.amountMinor !== undefined && next.amountMinor !== cents) fail('MONEY_MISMATCH', next.id)
    const ledger = get('ledgers', String(next.ledgerId))!
    const currency = String(prev?.currency || next.currency || ledger.currency)
    if (!['CNY', 'USD', 'EUR'].includes(currency) || currency !== ledger.currency || (prev?.currency && next.currency && prev.currency !== next.currency)) fail('CURRENCY_CONFLICT', '请显式迁移币种或选择同币种账本')
    next.amountMinor = cents; next.currency = currency
  }
  if (table === 'ledgers') {
    if (!['CNY', 'USD', 'EUR'].includes(String(next.currency))) fail('INVALID_CURRENCY', next.id)
    next.openingBalanceMinor = minorUnits(next.openingBalance || 0)
  }
  if (table === 'todos' && !String(next.title || '').trim()) fail('INVALID_TODO', next.id)
  if (table === 'customers' && !String(next.name || '').trim()) fail('INVALID_CUSTOMER', next.id)
  if (table === 'interactions' && ((!next.customerId && !next.projectId) || !String(next.content || '').trim())) fail('INVALID_INTERACTION', next.id)
}
export function financeTotals(rows: readonly Row[]): Record<string, { incomeMinor: number; expenseMinor: number; count: number }> {
  const out: Record<string, { incomeMinor: number; expenseMinor: number; count: number }> = {}
  const seen: Record<string, boolean> = {}
  for (const r of rows) {
    if (r.deleted || seen[r.id]) continue
    seen[r.id] = true
    const currency = String(r.currency || '')
    if (!['CNY', 'USD', 'EUR'].includes(currency)) fail('CURRENCY_REQUIRED', r.id)
    const amount = r.amountMinor ?? minorUnits(r.amount)
    if (!Number.isSafeInteger(amount)) fail('MONEY_PRECISION', r.id)
    const group = out[currency] ||= { incomeMinor: 0, expenseMinor: 0, count: 0 }
    if (r.type === 'income') group.incomeMinor += Number(amount)
    else if (r.type === 'expense') group.expenseMinor += Number(amount)
    group.count++
  }
  return out
}

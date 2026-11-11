import { fail, type Row } from './core'

/** 只接受可索引的等值范围；不让工具参数变成 SQL/filter 执行接口。 */
export interface Scope { where?: Record<string, string | number>; anyOf?: Record<string, string | number>[] }
export const SCOPE_FIELDS: Record<string, readonly string[]> = {
  links: ['fromType', 'fromId', 'toType', 'toId', 'kind', 'deleted'],
  activities: ['sourceTable', 'sourceId', 'sourceOperationId', 'deleted', 'category'],
  customers: ['localId', 'name', 'deleted'], projects: ['customerId', 'name', 'deleted'],
  todos: ['customerId', 'projectId', 'status', 'deleted'], notes: ['projectId', 'deleted'],
  projectMilestones: ['projectId', 'deleted'],
  transactions: ['ledgerId', 'type', 'status', 'deleted'], interactions: ['customerId', 'projectId', 'deleted'],
  operation_effects: ['operationId', 'tableName', 'recordId', 'action'],
  operations: ['owner', 'clientId', 'requestId', 'status', 'kind'],
}
export function checkScope(table: string, scope: Scope): void {
  const groups = [scope.where || {}, ...(scope.anyOf || [])]
  if (!SCOPE_FIELDS[table] || groups.length > 12 || !groups.some(g => Object.keys(g).length)) fail('INVALID_SCOPE', table)
  for (const g of groups) for (const k of Object.keys(g)) {
    if (!SCOPE_FIELDS[table].includes(k) || !['number', 'string'].includes(typeof g[k]) || String(g[k]).length > 240) fail('INVALID_SCOPE', table + '/' + k)
  }
}
export function inScope(row: Row, scope: Scope): boolean {
  const match = (g: Record<string, string | number>) => Object.keys(g).every(k => row[k] === g[k] || (row[k] == null && g[k] === ''))
  return match(scope.where || {}) && (!scope.anyOf?.length || scope.anyOf.some(match))
}
/** JSVM 与 HTTP 宿主共用参数化条件，字段名始终来自上方白名单。 */
export function scopeFilter(table: string, scope: Scope): { filter: string; params: Record<string, string | number> } {
  checkScope(table, scope)
  const params: Record<string, string | number> = {}
  let i = 0
  const group = (g: Record<string, string | number>) => Object.keys(g).map(k => { const p = 's' + i++; params[p] = g[k]; return k + ' = {:' + p + '}' }).join(' && ') || 'id != ""'
  const base = '(' + group(scope.where || {}) + ')'
  return { filter: base + (scope.anyOf?.length ? ' && (' + scope.anyOf.map(g => '(' + group(g) + ')').join(' || ') + ')' : ''), params }
}

import { inScope, type Scope } from '@/commands/scope'
import type { StorageAdapter, StorageTx } from './types'
import type { SyncMeta } from '@/db/types'

export async function queryRows<T extends { id: string }>(source: Pick<StorageTx, 'query' | 'list'> | StorageAdapter, table: string, scope: Scope): Promise<(T & SyncMeta)[]> {
  if (source.query) return source.query<T>(table, scope)
  return (await source.list<T>(table)).filter(r => inScope(r as unknown as import('@/commands/core').Row, scope))
}
export function endpointScope(type: string, id: string): Scope {
  return { anyOf: [{ fromType: type, fromId: id }, { toType: type, toId: id }] }
}

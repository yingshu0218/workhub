import { useSyncStore } from '@/sync/store'
import { selectCacheDatabase } from '@/db/db'
import { endpointBase, invalidateConnection } from '@/platform/endpoint'

export interface ClientSession {
  server: string
  owner: string
  generation: string
  schema: number
  key: string
}
let current: ClientSession | undefined
export function clientSession() {
  return current
}
export function activateClientSession(owner: string, generation: string, schema: number) {
  if (!owner || !generation || !Number.isSafeInteger(schema))
    throw new Error('INVALID_SESSION: 服务端身份或版本缺失')
  const server = endpointBase(),
    key = encodeURIComponent(JSON.stringify([server, owner, generation, schema]))
  if (current?.key !== key) {
    useSyncStore.setState({
      status: 'offline',
      pendingCount: 0,
      lastSyncAt: null,
      serverUrl: server,
      target: 'remote',
      reachability: 'unknown',
      lastCheckedAt: 0,
      lastError: null,
    })
    invalidateConnection()
    selectCacheDatabase('nexus-cache:' + key)
  }
  current = { server, owner, generation, schema, key }
  return current
}
export function suspendClientSession() {
  current = undefined
  invalidateConnection()
}
export function scopedClientKey(key: string) {
  return current ? key + ':' + current.key : key
}
export function requireClientSession(expected: ClientSession) {
  if (current?.key !== expected.key || endpointBase() !== expected.server)
    throw new Error('SESSION_CHANGED: 旧会话不能写入当前缓存')
}

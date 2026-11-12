import { useSyncStore } from '@/sync/store'
import { selectCacheDatabase } from '@/db/db'
import { connectionEpoch, endpointBase, invalidateConnection } from '@/platform/endpoint'

export interface ClientSession {
  server: string
  owner: string
  generation: string
  schema: number
  key: string
}
let current: ClientSession | undefined
const sessionEpoch = new WeakMap<ClientSession, number>()
export function clientSession() {
  return current
}
export function activateClientSession(owner: string, generation: string, schema: number) {
  if (!owner || !generation || !Number.isSafeInteger(schema))
    throw new Error('INVALID_SESSION: 服务端身份或版本缺失')
  const server = endpointBase(),
    key = encodeURIComponent(JSON.stringify([server, owner, generation, schema]))
  // A→B→A 会回到同一缓存键；只有从未中断的会话才能复用原对象。
  if (current?.key === key && sessionEpoch.get(current) === connectionEpoch()) return current
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
  current = { server, owner, generation, schema, key }
  sessionEpoch.set(current, connectionEpoch())
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
  if (current !== expected || sessionEpoch.get(expected) !== connectionEpoch() || endpointBase() !== expected.server)
    throw new Error('SESSION_CHANGED: 旧会话不能写入当前缓存')
}

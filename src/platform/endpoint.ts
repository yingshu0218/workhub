import { isTauri } from './env'

const KEY = 'workhub.server'
let epoch = 0
const controllers = new Set<AbortController>()
const listeners = new Set<() => void>()
export function normalizeEndpoint(raw: string, allowHttp = false): string {
  const u = new URL(raw.trim())
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/')
    throw new Error('请填写站点根地址，不包含账号、路径或参数')
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:'))
    throw new Error('原生客户端需要 HTTPS 站点地址')
  return u.origin
}
export function endpointBase(): string {
  if (!isTauri()) return typeof location === 'undefined' ? '' : location.origin
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}
export function endpointUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('非法服务路径')
  const base = endpointBase()
  if (isTauri() && !base) throw new Error('ENDPOINT_REQUIRED: 请先设置 VPS HTTPS 地址')
  return isTauri() ? base + path : path
}
export function connectionEpoch() {
  return epoch
}
export function invalidateConnection() {
  epoch++
  controllers.forEach((c) => c.abort())
  controllers.clear()
  listeners.forEach((fn) => fn())
}
export function setEndpoint(raw: string) {
  const value = normalizeEndpoint(raw, import.meta.env.DEV)
  if (value === endpointBase()) return
  localStorage.setItem(KEY, value)
  invalidateConnection()
}
export function onConnectionChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
/** 切换身份后旧请求即使晚返回，也不能污染新空间。 */
export async function endpointFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const started = epoch,
    controller = new AbortController()
  controllers.add(controller)
  const abort = () => controller.abort()
  if (init.signal?.aborted) controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 15_000)
  const dispose = () => {
    clearTimeout(timer)
    controllers.delete(controller)
    init.signal?.removeEventListener('abort', abort)
  }
  try {
    const response = await fetch(endpointUrl(path), { ...init, signal: controller.signal })
    if (started !== epoch) throw new Error('SESSION_CHANGED: 会话已改变，旧响应已丢弃')
    // headers先到不代表正文已到；身份检查和取消覆盖解析完成后的边界。
    for (const method of ['json', 'text', 'blob', 'arrayBuffer', 'formData'] as const) {
      if (typeof response[method] !== 'function') continue
      const original = response[method].bind(response)
      Object.defineProperty(response, method, {
        value: async () => {
          try {
            const value = await original()
            if (started !== epoch) throw new Error('SESSION_CHANGED: 正文属于旧会话')
            return value
          } finally {
            dispose()
          }
        },
      })
    }
    return response
  } catch (error) {
    dispose()
    throw error
  }
}

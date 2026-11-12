import { isTauri } from './env'

const KEY = 'workhub.server'
const HTTP_CONSENT_KEY = 'workhub.debugHttpOrigin'
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
export function debugHttpAvailable(): boolean {
  return isTauri() &&
    typeof __WORKHUB_ANDROID_DEBUG_HTTP__ !== 'undefined' &&
    __WORKHUB_ANDROID_DEBUG_HTTP__
}
export function endpointBase(): string {
  if (!isTauri()) return typeof location === 'undefined' ? '' : location.origin
  try {
    const stored = localStorage.getItem(KEY)
    if (!stored) return ''
    // 旧版持久化地址不能绕过本次构建的网络策略；debug HTTP 许可只绑定当前手填地址。
    const value = normalizeEndpoint(stored, debugHttpAvailable())
    if (value.startsWith('http:') && localStorage.getItem(HTTP_CONSENT_KEY) !== value) return ''
    return value
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
export function setEndpoint(raw: string, allowDebugHttp = false) {
  const value = normalizeEndpoint(raw, allowDebugHttp && debugHttpAvailable())
  if (value === endpointBase()) return
  localStorage.setItem(KEY, value)
  if (value.startsWith('http:')) localStorage.setItem(HTTP_CONSENT_KEY, value)
  else localStorage.removeItem(HTTP_CONSENT_KEY)
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
    // 307/308 不能把认证头或表单正文转送到用户未选择的 origin。
    const response = await fetch(endpointUrl(path), { ...init, redirect: 'error', signal: controller.signal })
    if (started !== epoch) throw new Error('SESSION_CHANGED: 会话已改变，旧响应已丢弃')
    if (response.redirected) throw new Error('UNEXPECTED_REDIRECT: 服务器请求不可重定向')
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

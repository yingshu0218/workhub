// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  localStorage.clear()
  delete window.__TAURI_INTERNALS__
})
it('原生所有服务请求使用配置的HTTPS站点，未配置或非法地址明确拒绝', async () => {
  window.__TAURI_INTERNALS__ = {}
  const p = await import('../endpoint')
  expect(() => p.endpointUrl('/setup/status')).toThrow('ENDPOINT_REQUIRED')
  for (const value of [
    'http://example.test',
    'https://a.test/path',
    'https://a.test/?token=x',
    'https://u:p@a.test',
  ])
    expect(() => p.normalizeEndpoint(value)).toThrow()
  p.setEndpoint('https://one.example.test/')
  expect(p.endpointUrl('/api/workhub/sync')).toBe('https://one.example.test/api/workhub/sync')
  expect(() => p.endpointUrl('//other.example.test')).toThrow()
})
it('HTTP 只在 Android debug 显式按地址许可，release 不接受残留地址', async () => {
  window.__TAURI_INTERNALS__ = {}
  const p = await import('../endpoint')
  localStorage.setItem('workhub.server', 'http://legacy.example.test')
  expect(p.endpointBase()).toBe('')
  vi.stubGlobal('__WORKHUB_ANDROID_DEBUG_HTTP__', true)
  expect(p.endpointBase()).toBe('') // 旧值没有逐地址同意，不得自动升级为许可。
  expect(() => p.setEndpoint('http://legacy.example.test')).toThrow('HTTPS')
  p.setEndpoint('http://legacy.example.test', true)
  expect(p.endpointBase()).toBe('http://legacy.example.test')
  p.setEndpoint('https://secure.example.test')
  expect(localStorage.getItem('workhub.debugHttpOrigin')).toBeNull()
  p.setEndpoint('http://second.example.test', true)
  vi.stubGlobal('__WORKHUB_ANDROID_DEBUG_HTTP__', false)
  expect(p.endpointBase()).toBe('')
  expect(() => p.endpointUrl('/setup/status')).toThrow('ENDPOINT_REQUIRED')
  expect(() => p.setEndpoint('http://second.example.test', true)).toThrow('HTTPS')
})
it('含认证信息的请求禁止重定向，即使调用方要求 follow', async () => {
  window.__TAURI_INTERNALS__ = {}
  const p = await import('../endpoint')
  p.setEndpoint('https://one.example.test')
  const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => ({ redirected: true, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchFn)
  await expect(p.endpointFetch('/setup/user', {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify({ password: 'A private password' }),
  })).rejects.toThrow('UNEXPECTED_REDIRECT')
  expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
})
it('收到headers后切换endpoint，晚到正文仍被拒绝且在途请求被取消', async () => {
  window.__TAURI_INTERNALS__ = {}
  const p = await import('../endpoint')
  p.setEndpoint('https://one.example.test')
  let body: (v: unknown) => void = () => {},
    signal: AbortSignal | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      signal = init.signal
      return {
        json: () =>
          new Promise((r) => {
            body = r
          }),
      }
    }),
  )
  const response = await p.endpointFetch('/api/workhub/personal/query'),
    reading = response.json()
  p.setEndpoint('https://two.example.test')
  expect(signal?.aborted).toBe(true)
  body({ private: 'old server' })
  await expect(reading).rejects.toThrow('SESSION_CHANGED')
})
it('账号、站点、恢复世代的缓存与token各自隔离；旧草稿和旧库保留', async () => {
  window.__TAURI_INTERNALS__ = {}
  const p = await import('../endpoint'),
    a = await import('@/shared/authToken'),
    s = await import('@/storage/clientSession'),
    database = await import('@/db/db')
  p.setEndpoint('https://one.example.test')
  a.saveAuthSession('one-secret', 'one', 'owner-one')
  const first = s.activateClientSession('owner-one', 'g1', 6)
  await database.db.customers.put({ id: 'one-contact', name: 'private one' } as never)
  localStorage.setItem(s.scopedClientKey('workhub.draft.test'), 'not submitted')
  const prior = database.db
  const second = s.activateClientSession('owner-two', 'g1', 6)
  expect(first.key).not.toBe(second.key)
  expect(await database.db.customers.get('one-contact')).toBeUndefined()
  expect((await prior.customers.get('one-contact'))?.name).toBe('private one')
  expect(() => s.requireClientSession(first)).toThrow('SESSION_CHANGED')
  s.activateClientSession('owner-one', 'g2', 6)
  expect(await database.db.customers.get('one-contact')).toBeUndefined()
  expect(localStorage.getItem('workhub.draft.test:' + first.key)).toBe('not submitted')
  p.setEndpoint('https://two.example.test')
  expect(a.getAuthToken()).toBe('')
  a.saveAuthSession('two-secret', 'two', 'owner-two')
  p.setEndpoint('https://one.example.test')
  expect(a.getAuthToken()).toBe('one-secret')
})

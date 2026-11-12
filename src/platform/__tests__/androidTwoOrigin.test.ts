// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'

const servers: Server[] = []
async function origin(reply: (authorization: string, end: (body: string) => void) => void) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.flushHeaders()
    reply(request.headers.authorization || '', (body) => response.end(body))
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP address')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  localStorage.clear()
  delete window.__TAURI_INTERNALS__
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('two real local origins isolate the same owner and generation, including late body and unsent input', async () => {
  window.__TAURI_INTERNALS__ = {}
  vi.stubEnv('DEV', true)
  vi.stubGlobal('__WORKHUB_ANDROID_DEBUG_HTTP__', true)
  let finishA: ((body: string) => void) | undefined
  const aHeaders: string[] = []
  const bHeaders: string[] = []
  const a = await origin((authorization, end) => {
    aHeaders.push(authorization)
    finishA = end
  })
  const b = await origin((authorization, end) => {
    bHeaders.push(authorization)
    end(JSON.stringify({ site: 'B' }))
  })
  const endpoint = await import('../endpoint')
  const auth = await import('@/shared/authToken')
  const session = await import('@/storage/clientSession')
  const database = await import('@/db/db')
  const pending = await import('@/storage/serverFirst')
  expect(() => endpoint.normalizeEndpoint(a)).toThrow()
  expect(endpoint.normalizeEndpoint(a, true)).toBe(a)

  endpoint.setEndpoint(a, true)
  auth.saveAuthSession('token-a', 'owner', 'same-owner')
  const old = session.activateClientSession('same-owner', 'same-generation', 6)
  await database.db.customers.put({ id: 'a-only', name: 'A private row' } as never)
  localStorage.setItem(session.scopedClientKey('workhub.draft.test'), 'A unsent draft')
  localStorage.setItem(session.scopedClientKey('workhub.pending.a-request'), JSON.stringify({
    requestId: 'a-request',
    generation: 'same-generation',
    writes: [{ table: 'customers', id: 'a-only', kind: 'put', value: { id: 'a-only' } }],
  }))
  const response = await endpoint.endpointFetch('/api/workhub/personal/query', {
    headers: { Authorization: auth.getAuthToken() },
  })
  const oldBody = response.json().then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )
  endpoint.setEndpoint(b, true)
  session.activateClientSession('same-owner', 'same-generation', 6)
  expect(auth.getAuthToken()).toBe('')
  expect(await database.db.customers.get('a-only')).toBeUndefined()
  expect(localStorage.getItem(session.scopedClientKey('workhub.draft.test'))).toBeNull()
  expect(pending.pendingCommandFor('customers', 'a-only')).toBeUndefined()
  auth.saveAuthSession('token-b', 'owner', 'same-owner')
  expect(await (await endpoint.endpointFetch('/api/workhub/personal/query', {
    headers: { Authorization: auth.getAuthToken() },
  })).json()).toEqual({ site: 'B' })
  finishA?.(JSON.stringify({ site: 'A', secret: 'late response' }))
  expect((await oldBody).ok).toBe(false)
  expect(aHeaders).toEqual(['token-a'])
  expect(bHeaders).toEqual(['token-b'])

  endpoint.setEndpoint(a, true)
  session.activateClientSession('same-owner', 'same-generation', 6)
  expect(auth.getAuthToken()).toBe('token-a')
  expect((await database.db.customers.get('a-only'))?.name).toBe('A private row')
  expect(localStorage.getItem(session.scopedClientKey('workhub.draft.test'))).toBe('A unsent draft')
  expect(pending.pendingCommandFor('customers', 'a-only')?.requestId).toBe('a-request')
  expect(() => session.requireClientSession(old)).toThrow('SESSION_CHANGED')
})

it.each([307, 308])('a real %s cross-origin redirect cannot forward A credentials or a password body to B', async (status) => {
  window.__TAURI_INTERNALS__ = {}
  vi.stubEnv('DEV', true)
  vi.stubGlobal('__WORKHUB_ANDROID_DEBUG_HTTP__', true)
  const bRequests: { authorization: string; body: string }[] = []
  const bServer = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    bRequests.push({ authorization: request.headers.authorization || '', body })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ site: 'B', private: 'synthetic B content' }))
  })
  servers.push(bServer)
  bServer.listen(0, '127.0.0.1')
  await once(bServer, 'listening')
  const bAddress = bServer.address()
  if (!bAddress || typeof bAddress === 'string') throw new Error('Expected TCP address')
  const b = `http://127.0.0.1:${bAddress.port}`
  const aServer = createServer((_request, response) => {
    response.writeHead(status, { Location: b + '/api/workhub/personal/query' })
    response.end()
  })
  servers.push(aServer)
  aServer.listen(0, '127.0.0.1')
  await once(aServer, 'listening')
  const address = aServer.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP address')
  const a = `http://127.0.0.1:${address.port}`
  const endpoint = await import('../endpoint')
  endpoint.setEndpoint(a, true)
  const outcome = await endpoint.endpointFetch('/api/workhub/personal/query', {
    method: 'POST',
    headers: { Authorization: 'token-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'synthetic-a-password' }),
  }).then(() => ({ ok: true }), (error) => ({ ok: false, error }))
  expect(bRequests).toEqual([])
  expect(outcome.ok).toBe(false)
})

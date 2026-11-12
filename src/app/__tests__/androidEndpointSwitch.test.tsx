// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import 'fake-indexeddb/auto'

vi.mock('@/platform/env', () => ({ isServerFirstWeb: () => true, isTauri: () => true }))
import { AuthGate } from '../AuthGate'
import { setEndpoint } from '@/platform/endpoint'
import { getAuthToken } from '@/shared/authToken'
import { suspendClientSession } from '@/storage/clientSession'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
function moveTo(url: string) {
  fireEvent.click(screen.getByRole('button', { name: '修改服务器地址' }))
  fireEvent.change(screen.getByLabelText('VPS HTTPS 地址'), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: '连接并登录' }))
}
afterEach(() => {
  cleanup()
  suspendClientSession()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('认证失败页能改址并重新验证，旧私人界面不放行', async () => {
  setEndpoint('https://a.example.test')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://a.')) throw new Error('offline')
    if (url.endsWith('/setup/status')) return response({ needsSetup: false })
    if (url.endsWith('/relay/auth-status')) return response({ enabled: true, initialized: true })
    throw new Error('unexpected ' + url)
  }))
  render(<AuthGate><p>PRIVATE VIEW</p></AuthGate>)
  await screen.findByText('认证服务暂时不可用，请重试')
  expect(screen.queryByText('PRIVATE VIEW')).toBeNull()
  moveTo('https://b.example.test')
  await screen.findByText('请使用管理员账号登录')
  expect(screen.queryByText('PRIVATE VIEW')).toBeNull()
})

it('setup 正文晚到且 A→B→A 时，不把 A 旧密码用于后续自动登录', async () => {
  const body = deferred<unknown>(), started = deferred<void>()
  const calls: { url: string; body?: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body || '') })
    if (url.endsWith('/setup/status'))
      return response({ needsSetup: url.startsWith('https://a.') })
    if (url.endsWith('/relay/auth-status')) return response({ enabled: true, initialized: true })
    if (url.endsWith('/setup/user')) {
      started.resolve()
      return { ok: true, status: 200, json: () => body.promise } as Response
    }
    if (url.endsWith('/auth-with-password')) throw new Error('old setup password leaked')
    throw new Error('unexpected ' + url)
  }))
  render(<AuthGate><p>PRIVATE VIEW</p></AuthGate>)
  fireEvent.change(await screen.findByLabelText('VPS HTTPS 地址'), { target: { value: 'https://a.example.test' } })
  fireEvent.click(screen.getByRole('button', { name: '连接并登录' }))
  await screen.findByText('初始化工作台')
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('密码（至少 8 位）'), { target: { value: 'old-secret-123' } })
  fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'old-secret-123' } })
  fireEvent.click(screen.getByRole('button', { name: '创建并进入' }))
  await started.promise
  moveTo('https://b.example.test')
  await screen.findByText('请使用管理员账号登录')
  moveTo('https://a.example.test')
  await screen.findByText('初始化工作台')
  body.resolve({ ok: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls.filter((c) => c.url.endsWith('/auth-with-password'))).toHaveLength(0)
  expect(screen.queryByText('PRIVATE VIEW')).toBeNull()
  expect(screen.getByLabelText('密码（至少 8 位）')).toHaveProperty('value', '')
})

it('登录正文切站后旧 token 不能写到新站点', async () => {
  setEndpoint('https://a.example.test')
  const body = deferred<unknown>(), started = deferred<void>()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/setup/status')) return response({ needsSetup: false })
    if (url.endsWith('/relay/auth-status')) return response({ enabled: true, initialized: true })
    if (url.endsWith('/auth-with-password')) {
      started.resolve()
      return { ok: true, status: 200, json: () => body.promise } as Response
    }
    throw new Error('unexpected ' + url)
  }))
  render(<AuthGate><p>PRIVATE VIEW</p></AuthGate>)
  await screen.findByText('请使用管理员账号登录')
  expect(screen.getByText('当前服务器：https://a.example.test')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('用户名或邮箱'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'old-secret-123' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  await started.promise
  moveTo('https://b.example.test')
  await screen.findByText('请使用管理员账号登录')
  body.resolve({ token: 'A-token', record: { id: 'A-owner' } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(getAuthToken()).toBe('')
  expect(localStorage.getItem('workhub.auth.token:' + encodeURIComponent('https://b.example.test'))).toBeNull()
  expect(screen.queryByText('PRIVATE VIEW')).toBeNull()
})

it('改密后等待初始化标记时切站，不继续用旧凭据打开新会话', async () => {
  setEndpoint('https://a.example.test')
  const held = deferred<Response>(), started = deferred<void>()
  const calls: { url: string; body?: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body || '') })
    if (url.endsWith('/setup/status')) return response({ needsSetup: false })
    if (url.endsWith('/relay/auth-status'))
      return response({ enabled: true, initialized: !url.startsWith('https://a.') })
    if (url.endsWith('/auth-with-password'))
      return response({ token: 'A-token', record: { id: 'A-owner' } })
    if (url.endsWith('/records/A-owner')) return response({})
    if (url.endsWith('/relay/admin-initialized')) { started.resolve(); return held.promise }
    if (url.endsWith('/client-state')) throw new Error('old change opened new session')
    throw new Error('unexpected ' + url)
  }))
  render(<AuthGate><p>PRIVATE VIEW</p></AuthGate>)
  await screen.findByText('请使用管理员账号登录')
  fireEvent.change(screen.getByLabelText('用户名或邮箱'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'old-secret-123' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  await screen.findByText('设置你的密码')
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-secret-123' } })
  fireEvent.change(screen.getByLabelText('新密码（至少 8 位）'), { target: { value: 'new-secret-123' } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-secret-123' } })
  fireEvent.click(screen.getByRole('button', { name: '设置并进入' }))
  await started.promise
  moveTo('https://b.example.test')
  await screen.findByText('请使用管理员账号登录')
  held.resolve(response({ ok: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls.filter((c) => c.url.startsWith('https://b.') && c.url.endsWith('/client-state'))).toHaveLength(0)
  expect(calls.filter((c) => c.url.startsWith('https://b.') && c.body?.includes('old-secret-123'))).toHaveLength(0)
  expect(screen.getByLabelText('密码')).toHaveProperty('value', '')
})

it('schema 版本不匹配时不打开业务缓存，仍能修改服务器', async () => {
  setEndpoint('https://a.example.test')
  localStorage.setItem('workhub.auth.token:' + encodeURIComponent('https://a.example.test'), 'A-token')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/setup/status')) return response({ needsSetup: false })
    if (url.endsWith('/relay/auth-status')) return response({ enabled: true, initialized: true })
    if (url.endsWith('/auth-refresh')) return response({ token: 'fresh-A-token' })
    if (url.endsWith('/client-state')) return response({ owner: 'A', generation: 'g', schema: 5, syncProtocol: 1 })
    throw new Error('unexpected ' + url)
  }))
  render(<AuthGate><p>PRIVATE VIEW</p></AuthGate>)
  await screen.findByText('认证服务暂时不可用，请重试')
  expect(screen.queryByText('PRIVATE VIEW')).toBeNull()
  expect(screen.getByRole('button', { name: '修改服务器地址' })).toBeTruthy()
})

it.each([
  [{ owner: 123, generation: 'g', schema: 6, syncProtocol: 1 }, '数字 owner'],
  [{ owner: 'A', generation: '   ', schema: 6, syncProtocol: 1 }, '空白 generation'],
])('客户端状态 %s（%s）不能放行私人界面', async (state, _label) => {
  setEndpoint('https://a.example.test')
  localStorage.setItem('workhub.auth.token:' + encodeURIComponent('https://a.example.test'), 'A-token')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/setup/status')) return response({ needsSetup: false })
    if (url.endsWith('/relay/auth-status')) return response({ enabled: true, initialized: true })
    if (url.endsWith('/auth-refresh')) return response({ token: 'fresh-A-token' })
    if (url.endsWith('/client-state')) return response(state)
    throw new Error('unexpected ' + url)
  }))
  render(<AuthGate><p>PRIVATE VIEW</p></AuthGate>)
  await screen.findByText('认证服务暂时不可用，请重试')
  expect(screen.queryByText('PRIVATE VIEW')).toBeNull()
})

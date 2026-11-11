// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import 'fake-indexeddb/auto'
vi.mock('@/platform/env', () => ({ isServerFirstWeb: () => true, isTauri: () => true }))
import { AuthGate } from '../AuthGate'
import { clientSession, suspendClientSession } from '@/storage/clientSession'
import { saveAuthSession } from '@/shared/authToken'
import { setEndpoint } from '@/platform/endpoint'
afterEach(() => {
  cleanup()
  suspendClientSession()
  localStorage.clear()
  vi.unstubAllGlobals()
})
it('原生首启先配置站点，所有认证/状态请求都到VPS，成功后才打开业务缓存', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/setup/status')) return Response.json({ needsSetup: false })
      if (url.endsWith('/relay/auth-status'))
        return Response.json({ enabled: true, initialized: true })
      if (url.endsWith('/auth-with-password'))
        return Response.json({ token: 'authenticated', record: { id: 'native-owner' } })
      if (url.endsWith('/client-state'))
        return Response.json({
          owner: 'native-owner',
          generation: 'native-generation',
          schema: 6,
          syncProtocol: 1,
        })
      throw new Error('unexpected ' + url)
    }),
  )
  render(
    <AuthGate>
      <p>VERIFIED PRIVATE VIEW</p>
    </AuthGate>,
  )
  const server = await screen.findByLabelText('VPS HTTPS 地址')
  fireEvent.change(server, { target: { value: 'https://vps.example.test' } })
  fireEvent.click(screen.getByRole('button', { name: '连接并登录' }))
  await screen.findByText('用户名或邮箱')
  fireEvent.change(screen.getByLabelText('用户名或邮箱'), { target: { value: 'owner' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test password' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  expect(await screen.findByText('VERIFIED PRIVATE VIEW')).toBeTruthy()
  expect(clientSession()?.owner).toBe('native-owner')
  expect(
    (fetch as ReturnType<typeof vi.fn>).mock.calls.every((args) =>
      String(args[0]).startsWith('https://vps.example.test/'),
    ),
  ).toBe(true)
})
it('原生冷启动离线或认证503不能打开私人旧缓存', async () => {
  setEndpoint('https://vps.example.test')
  saveAuthSession('cached', 'owner', 'native-owner')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline')
    }),
  )
  render(
    <AuthGate>
      <p>OLD PRIVATE CACHE</p>
    </AuthGate>,
  )
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('OLD PRIVATE CACHE')).toBeNull()
})

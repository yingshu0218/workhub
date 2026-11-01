/**
 * 首启自助注册的行为锁（2026-11-01）
 *
 * 锁五条判据（都是「错了会静默出事」的那类）：
 *  1. 空库 → 能建出账号；username 只作展示，登录走 `<用户名>@workhub.local` 邮箱映射；
 *  2. 非空库 → 409「已完成初始化」，且**不发**创建请求（空库判据是唯一的开关）；
 *  3. 弱密码 → 400 且一次 PB 请求都不发（在校验层拦住，不靠服务端兜）；
 *  4. PB 的 400 原话必须透传（重复用户名若被吞成「创建失败」，用户不知道改什么）；
 *  5. 补 username 展示字段失败时，建号必须继续，且请求体不能再带 username（老库带上去会 400）；
 *     同时锁住「不再改 identityFields」—— 0.40 上加 username 必被拒。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSetupService, parseSetupInput } from '../setupRoutes.mjs'

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function stubPb(overrides = {}) {
  const {
    totalItems = 0,
    hasUsernameField = true,
    addUsernameFieldStatus = 200,
    createStatus = 200,
    createBody = { id: 'u1' },
  } = overrides
  const calls = []
  // 建成账号后库就不再是空的 —— 状态必须跟着变，否则「自关闭」这条判据测不出来
  let created = 0
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    calls.push({ url: u, method, body: init.body ? JSON.parse(String(init.body)) : undefined })

    if (u.endsWith('/api/collections/_superusers/auth-with-password')) {
      return jsonResponse(200, { token: 'su-token' })
    }
    if (u.includes('/api/collections/users/records?perPage=1')) {
      return jsonResponse(200, { totalItems: totalItems + created, items: [] })
    }
    if (u.endsWith('/api/collections/users/records') && method === 'POST') {
      if (createStatus < 300) created += 1
      return jsonResponse(createStatus, createBody)
    }
    if (u.endsWith('/api/collections/users') && method === 'PATCH') {
      // 现在唯一会发的 PATCH 是「补 username 展示字段」，不再碰 passwordAuth
      return jsonResponse(addUsernameFieldStatus, { message: 'Failed to update collection.' })
    }
    if (u.endsWith('/api/collections/users')) {
      return jsonResponse(200, {
        fields: hasUsernameField ? [{ name: 'email' }, { name: 'username' }] : [{ name: 'email' }],
        passwordAuth: { enabled: true, identityFields: ['email'] },
      })
    }
    return jsonResponse(404, {})
  }
  return { fetchImpl, calls, service: createSetupService({
    pbBase: 'http://127.0.0.1:8090',
    superuser: 'root@example.com',
    superuserPassword: 'su-password',
    fetchImpl,
  }) }
}

describe('setupRoutes.parseSetupInput', () => {
  it('用户名 3–32 位、密码 ≥8 位', () => {
    expect(parseSetupInput({ identity: 'ab', password: 'password1' }).error).toMatch(/3–32/)
    expect(parseSetupInput({ identity: 'a'.repeat(33), password: 'password1' }).error).toMatch(/3–32/)
    expect(parseSetupInput({ identity: 'alice', password: '1234567' }).error).toMatch(/至少 8 位/)
  })

  it('带 @ 的串不进 username（PB 的 username pattern 不接受 @，否则建号即 400）', () => {
    expect(parseSetupInput({ identity: 'alice@example.com', password: 'password1' }).error).toMatch(/只能用/)
  })

  it('没给邮箱时合成占位邮箱（PB auth 集合 email 必填）', () => {
    expect(parseSetupInput({ identity: 'alice', password: 'password1' })).toEqual({
      identity: 'alice',
      password: 'password1',
      email: 'alice@workhub.local',
    })
  })
})

describe('setupRoutes.createUser', () => {
  it('空库：用超管凭据建号，username 与 identity 一致', async () => {
    const { service, calls } = stubPb()
    const result = await service.createUser({ identity: 'alice', password: 'password1' })

    expect(result).toEqual({ status: 200, body: { ok: true } })
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/collections/users/records'))
    expect(created?.body).toMatchObject({
      username: 'alice',
      email: 'alice@workhub.local',
      password: 'password1',
      passwordConfirm: 'password1',
    })
    // 登录标识始终只有 email：任何请求都不许再写 passwordAuth（0.40 加 username 必被拒）
    expect(calls.some((c) => c.body?.passwordAuth)).toBe(false)
  })

  it('老库没有 username 字段且补字段失败：仍能建号，请求体不带 username', async () => {
    // 补字段是 best-effort：失败时若还把 username 发上去，PB 会以「未知字段」拒绝建号 —— 首启锁死。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { service, calls } = stubPb({ hasUsernameField: false, addUsernameFieldStatus: 400 })
    const result = await service.createUser({ identity: 'alice', password: 'password1' })
    warn.mockRestore()

    expect(result).toEqual({ status: 200, body: { ok: true } })
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/collections/users/records'))
    expect(created?.body).toMatchObject({ email: 'alice@workhub.local' })
    expect(created?.body).not.toHaveProperty('username')
  })

  it('老库没有 username 字段：补成功后再写入（展示字段）', async () => {
    const { service, calls } = stubPb({ hasUsernameField: false })
    const result = await service.createUser({ identity: 'alice', password: 'password1' })

    expect(result).toEqual({ status: 200, body: { ok: true } })
    const patched = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/api/collections/users'))
    expect(patched?.body?.fields?.some((f) => f.name === 'username')).toBe(true)
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/collections/users/records'))
    expect(created?.body).toMatchObject({ username: 'alice', email: 'alice@workhub.local' })
  })

  it('非空库：409，且不发创建请求', async () => {
    const { service, calls } = stubPb({ totalItems: 2 })
    const result = await service.createUser({ identity: 'alice', password: 'password1' })

    expect(result).toEqual({ status: 409, body: { error: '已完成初始化' } })
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/collections/users/records'))).toBe(false)
  })

  it('弱密码：400，且一次 PB 请求都不发', async () => {
    const { service, calls } = stubPb()
    const result = await service.createUser({ identity: 'alice', password: '1234567' })

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/至少 8 位/)
    expect(calls).toHaveLength(0)
  })

  it('重复用户名：透传 PB 的原始 message，不吞成「创建失败」', async () => {
    const { service } = stubPb({
      createStatus: 400,
      createBody: {
        message: 'Failed to create record.',
        data: { username: { message: 'The username is invalid or already in use.' } },
      },
    })
    const result = await service.createUser({ identity: 'alice', password: 'password1' })

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('Failed to create record.')
    expect(result.body.error).toContain('already in use')
  })

  it('建号成功后回调一次（serve.mjs 用它写「密码已自定义」标记）', async () => {
    const onUserCreated = vi.fn()
    const { fetchImpl, calls } = stubPb()
    const service = createSetupService({
      pbBase: 'http://127.0.0.1:8090',
      superuser: 'root@example.com',
      superuserPassword: 'su-password',
      fetchImpl,
      onUserCreated,
    })
    await service.createUser({ identity: 'alice', password: 'password1' })
    await service.createUser({ identity: 'bob', password: 'password1' })

    // 第二次是 409（库已非空），不能再写标记 —— 只有建成账号那次算数
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/records'))).toHaveLength(1)
    expect(onUserCreated).toHaveBeenCalledTimes(1)
  })

  it('没配超管凭据：503 + 明确原因（不是静默不可用）', async () => {
    const service = createSetupService({ pbBase: 'http://127.0.0.1:8090', fetchImpl: async () => jsonResponse(200, {}) })
    const result = await service.createUser({ identity: 'alice', password: 'password1' })

    expect(result.status).toBe(503)
    expect(result.body.error).toMatch(/PB_SUPERUSER/)
  })
})

describe('setupRoutes.handleRequest', () => {
  it('GET /setup/status → needsSetup 由「users 是否为空」决定', async () => {
    const { service } = stubPb({ totalItems: 0 })
    const res = {
      statusCode: 0,
      payload: null,
      writeHead(code) {
        this.statusCode = code
        return this
      },
      end(text) {
        this.payload = JSON.parse(text)
      },
    }
    const handled = service.handleRequest({ url: '/setup/status', method: 'GET' }, res)

    expect(handled).toBe(true)
    // 处理是异步的（要查 PB），等一轮微任务
    await vi.waitFor(() => expect(res.payload).toEqual({ needsSetup: true }))
    expect(res.statusCode).toBe(200)
  })

  it('非 /setup 路径不接管（交回 relay / 静态站）', () => {
    const { service } = stubPb()
    expect(service.handleRequest({ url: '/relay/auth-status', method: 'GET' }, {})).toBe(false)
  })
})

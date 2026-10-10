/**
 * 同步状态徽章的判定回归。
 *
 * ## 要防的两个假绿
 *
 * **其一**：顶栏徽章原先只读引擎的 `status`，而引擎只在两种情况翻 offline：
 * 「浏览器断网」或「某一轮同步抛异常」。可**没有待推送数据时根本不会发请求** ——
 * 于是同步中心早就连不上了，徽章还一直显示「已同步」。
 *
 * **其二**：连通性探测若只认 HTTP 2xx，则「同步中心地址填成站点根」也会被判为已连接 ——
 * 线上实测未知路径 `/api/xxx` 会被 SPA 回退成 `200 + text/html`（见 `isHealthPayload`）。
 *
 * 本次把判定拆成两层，本文件把两层的关键判据都钉住：
 *   - `connectivity.ts`：同步中心在哪（未配置 / 本机回环 / 远端）+ 连得上吗
 *   - `badge.ts`：这些事实怎么显示（优先级顺序）
 *
 * 与 `collectionName.parity.test.ts`、`skill.parity.test.ts` 是同一手法：
 * 把「界面看不出、只有肉眼或抓包才发现」的静默失效转成 CI 红灯。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifySyncTarget,
  healthUrl,
  isHealthPayload,
  isLoopbackHost,
  isNetworkFailure,
  parseServerUrl,
  probeSyncCenter,
} from '../connectivity'
import { deriveSyncBadge, describeLastSync } from '../badge'
import type { SyncBadgeInput } from '../badge'

/** PocketBase `/api/health` 的真实响应体（照抄线上实抓，勿改成 `{}`） */
const REAL_HEALTH_BODY = '{"message":"API is healthy.","code":200,"data":{}}'
/** SPA 回退页（未知路径时线上返回的就是它） */
const SPA_FALLBACK_BODY = '<!doctype html><html lang="zh-CN"><head><title>寻鸽工作台</title></head></html>'

function badgeInput(over: Partial<SyncBadgeInput> = {}): SyncBadgeInput {
  return {
    status: 'synced',
    pendingCount: 0,
    target: 'remote',
    reachability: 'online',
    lastSyncAt: null,
    lastError: null,
    serverUrl: 'https://sync.example.com',
    now: 1_000_000_000,
    ...over,
  }
}

describe('classifySyncTarget —— 同步中心在哪', () => {
  it('空 / 纯空白 → none（未配置同步中心）', () => {
    expect(classifySyncTarget('')).toBe('none')
    expect(classifySyncTarget('   ')).toBe('none')
  })

  it('回环地址的各种写法都算「本机」', () => {
    for (const url of [
      'http://localhost:8090',
      'http://127.0.0.1:8090',
      'http://127.8.8.8', // 127.0.0.0/8 全是回环
      'http://[::1]:8090',
      'http://0.0.0.0:8090',
      'https://localhost',
    ]) {
      expect(classifySyncTarget(url), url).toBe('loopback')
    }
  })

  it('不带协议的裸地址也能识别为本机（设置页允许这么填）', () => {
    expect(classifySyncTarget('localhost:8090')).toBe('loopback')
    expect(classifySyncTarget('127.0.0.1:8090')).toBe('loopback')
  })

  it('远端地址 → remote', () => {
    for (const url of [
      'https://team.fpigeon.fun',
      'http://8.153.19.221:9001',
      'https://sync.example.com/pb',
    ]) {
      expect(classifySyncTarget(url), url).toBe('remote')
    }
  })

  it('填了但解析不了 → 保守判为 remote（照常探测，而不是假装本机后放弃探测）', () => {
    expect(classifySyncTarget('%%%')).toBe('remote')
  })

  it('只填地址、还没填账号密码也算已配置（用地址而不是 isSyncConfigured 的布尔）', () => {
    // 这是刻意的：否则「填了地址没填密码」会被显示成「仅本机」，让用户以为压根没配过
    expect(classifySyncTarget('https://sync.example.com')).not.toBe('none')
  })
})

describe('isLoopbackHost', () => {
  it('识别回环主机名', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.0.0.99', '::1', '[::1]', '0.0.0.0']) {
      expect(isLoopbackHost(h), h).toBe(true)
    }
  })

  it('非回环主机名不误判', () => {
    for (const h of ['', '  ', 'example.com', '128.0.0.1', '10.0.0.1', '192.168.1.5']) {
      expect(isLoopbackHost(h), h).toBe(false)
    }
  })
})

describe('parseServerUrl / healthUrl', () => {
  it('末尾斜杠被吃掉，路径前缀保留', () => {
    expect(healthUrl('https://sync.example.com')).toBe('https://sync.example.com/api/health')
    expect(healthUrl('https://sync.example.com/')).toBe('https://sync.example.com/api/health')
    expect(healthUrl('http://localhost:8090/pb/')).toBe('http://localhost:8090/pb/api/health')
  })

  it('空地址没有健康端点', () => {
    expect(healthUrl('')).toBeNull()
    expect(parseServerUrl('')).toBeNull()
  })
})

describe('页面协议推导 —— HTTPS 页面不再探测明文 HTTP（混合内容防护）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('【核心回归】https 页面下，不带协议的地址补 `https://`（原实现一律补 `http://`，会触发混合内容）', () => {
    vi.stubGlobal('location', { protocol: 'https:' })
    expect(healthUrl('team.fpigeon.fun')).toBe('https://team.fpigeon.fun/api/health')
    expect(classifySyncTarget('team.fpigeon.fun')).toBe('remote')
  })

  it('http 页面下仍补 `http://`（本机开发场景保持原行为）', () => {
    vi.stubGlobal('location', { protocol: 'http:' })
    expect(healthUrl('127.0.0.1:8090')).toBe('http://127.0.0.1:8090/api/health')
  })

  it('无 location 的 Node 环境退回 `http://`，不破坏既有调用方', () => {
    expect(healthUrl('127.0.0.1:8090')).toBe('http://127.0.0.1:8090/api/health')
  })

  it('用户显式写了协议的地址，不受页面协议影响（尊重显式意图）', () => {
    vi.stubGlobal('location', { protocol: 'https:' })
    expect(healthUrl('http://localhost:8090')).toBe('http://localhost:8090/api/health')
  })

  it('【核心回归】https 页面探测明文 HTTP 远端 → 直接给可操作错误，且**一个请求都不发**', async () => {
    vi.stubGlobal('location', { protocol: 'https:' })
    let called = false
    const r = await probeSyncCenter('http://8.153.19.221:9001', {
      fetchImpl: (() => {
        called = true
        throw new Error('不该被调用')
      }) as unknown as typeof fetch,
    })
    expect(called).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('https://')
  })

  it('回环地址在 https 页面下仍照常探测（浏览器把 localhost 视为可信来源，不按混合内容拦）', async () => {
    vi.stubGlobal('location', { protocol: 'https:' })
    const calls: string[] = []
    const fetchImpl = ((url: string) => {
      calls.push(String(url))
      return Promise.resolve(
        new Response(REAL_HEALTH_BODY, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch
    const r = await probeSyncCenter('http://127.0.0.1:8090', { fetchImpl })
    expect(calls).toEqual(['http://127.0.0.1:8090/api/health'])
    expect(r.ok).toBe(true)
  })
})

describe('isHealthPayload —— 必须验明是 PocketBase 而不是「随便什么 200」', () => {
  it('接受真实健康响应（含线上实抓的原文）', () => {
    expect(isHealthPayload(REAL_HEALTH_BODY)).toBe(true)
  })

  it('拒绝 SPA 回退页（线上未知路径返回的就是它）', () => {
    expect(isHealthPayload(SPA_FALLBACK_BODY)).toBe(false)
  })

  it('拒绝非 JSON、缺字段或 code 不为 200 的响应', () => {
    expect(isHealthPayload('')).toBe(false)
    expect(isHealthPayload('OK')).toBe(false)
    expect(isHealthPayload('{}')).toBe(false)
    expect(isHealthPayload('{"code":200}')).toBe(false)
    expect(isHealthPayload('{"message":"hi","code":404}')).toBe(false)
  })
})

describe('probeSyncCenter —— 独立于「有没有东西要同步」的连通性探测', () => {
  it('打到 /api/health，200 且响应体是健康响应 → 可达', async () => {
    const calls: string[] = []
    const fetchImpl = ((url: string) => {
      calls.push(String(url))
      return Promise.resolve(
        new Response(REAL_HEALTH_BODY, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch

    const r = await probeSyncCenter('https://sync.example.com', { fetchImpl })
    expect(calls).toEqual(['https://sync.example.com/api/health'])
    expect(r.ok).toBe(true)
    expect(r.error).toBe('')
  })

  it('【核心回归】200 但返回的是 SPA 回退页 → 必须判为不可达（地址填错了）', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(SPA_FALLBACK_BODY, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      )) as unknown as typeof fetch

    const r = await probeSyncCenter('https://sync.example.com', { fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('健康响应')
  })

  it('非 2xx 视为不可达，并把状态码写进原因', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('', { status: 502 }))) as unknown as typeof fetch
    const r = await probeSyncCenter('https://sync.example.com', { fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('502')
  })

  it('网络层抛错 → 不可达，且被判为「网络失败」', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
    const r = await probeSyncCenter('https://sync.example.com', { fetchImpl })
    expect(r.ok).toBe(false)
    expect(isNetworkFailure(new TypeError(r.error))).toBe(true)
  })

  it('超时（fetch 悬挂）→ 不可达，原因是超时而不是永久挂起', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_res, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })) as unknown as typeof fetch

    const r = await probeSyncCenter('https://sync.example.com', { fetchImpl, timeoutMs: 5 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('超时')
  })

  it('地址无效 → 直接不可达，不发请求', async () => {
    const r = await probeSyncCenter('', {
      fetchImpl: (() => {
        throw new Error('不该被调用')
      }) as unknown as typeof fetch,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('地址无效')
  })
})

describe('isNetworkFailure —— 区分「连不上」与「连上了但被拒绝」', () => {
  it('fetch 网络错误 / 超时算网络失败', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(isNetworkFailure(abort)).toBe(true)
  })

  it('凭据错误**不算**网络失败（否则会把用户引去查网络，而问题在密码）', () => {
    expect(isNetworkFailure(new Error('登录失败：账号或密码错误'))).toBe(false)
    expect(isNetworkFailure(new Error('同步中心返回 HTTP 401'))).toBe(false)
  })
})

describe('deriveSyncBadge —— 展示优先级', () => {
  it('【核心回归】没有任何待推送数据、但同步中心已失联 → 必须显示「无法连接」，不能再是「已同步」', () => {
    const v = deriveSyncBadge(badgeInput({ pendingCount: 0, reachability: 'offline' }))
    expect(v.label).toBe('无法连接')
    expect(v.label).not.toBe('已同步')
    expect(v.tone).toBe('red')
    expect(v.title).toContain('连接状态：无法连接')
    expect(v.title).toContain('https://sync.example.com')
  })

  it('正在同步压过一切（哪怕此刻探测结果是断的）', () => {
    const v = deriveSyncBadge(badgeInput({ status: 'syncing', reachability: 'offline' }))
    expect(v.label).toBe('同步中')
    expect(v.tone).toBe('blue')
  })

  it('未配置同步中心 = 正常状态，显示「仅本机」而不是报故障', () => {
    const v = deriveSyncBadge(badgeInput({ target: 'none', serverUrl: '', reachability: 'unknown' }))
    expect(v.label).toBe('仅本机')
    expect(v.tone).toBe('gray')
    expect(v.title).toContain('未配置')
  })

  it('未配置时即便可达性未知也不显示「检测连接…」', () => {
    const v = deriveSyncBadge(badgeInput({ target: 'none', serverUrl: '', reachability: 'offline' }))
    expect(v.label).toBe('仅本机')
  })

  it('首次探测未出结果 → 「检测连接…」，不急着说连不上', () => {
    expect(deriveSyncBadge(badgeInput({ reachability: 'unknown' })).label).toBe('检测连接…')
    expect(deriveSyncBadge(badgeInput({ reachability: 'checking' })).label).toBe('检测连接…')
  })

  it('本机同步中心连不上与本机已连接，措辞都与远端不同', () => {
    expect(deriveSyncBadge(badgeInput({ target: 'loopback', reachability: 'offline' })).label).toBe(
      '本机 · 未连接',
    )
    expect(deriveSyncBadge(badgeInput({ target: 'loopback', reachability: 'online' })).label).toBe('本机')
  })

  it('远端正常态是「已连接」，有积压则优先报积压', () => {
    expect(deriveSyncBadge(badgeInput()).label).toBe('已连接')
    expect(deriveSyncBadge(badgeInput()).tone).toBe('green')
    const pending = deriveSyncBadge(badgeInput({ pendingCount: 3 }))
    expect(pending.label).toBe('待推送 3')
    expect(pending.tone).toBe('amber')
  })

  it('悬浮提示摊开徽章塞不下的事实', () => {
    const v = deriveSyncBadge(badgeInput({ pendingCount: 2, lastError: '探测超时（5000 ms）' }))
    expect(v.title).toContain('同步中心：https://sync.example.com（远程）')
    expect(v.title).toContain('待推送：2 条')
    expect(v.title).toContain('最近错误：探测超时（5000 ms）')
  })
})

describe('describeLastSync', () => {
  const now = 1_000_000_000_000
  it('未同步过', () => expect(describeLastSync(null, now)).toBe('尚未同步'))
  it('刚刚', () => expect(describeLastSync(now - 30_000, now)).toBe('刚刚'))
  it('分钟', () => expect(describeLastSync(now - 5 * 60_000, now)).toBe('5 分钟前'))
  it('小时', () => expect(describeLastSync(now - 3 * 3_600_000, now)).toBe('3 小时前'))
  it('天', () => expect(describeLastSync(now - 2 * 86_400_000, now)).toBe('2 天前'))
})

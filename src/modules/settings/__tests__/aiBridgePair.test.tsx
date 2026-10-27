// @vitest-environment jsdom
/**
 * AI Agent 桥 · 配对码流程的行为锁（2026-10-28）
 *
 * ## 为什么必须有这条锁
 *
 * 线上真实故障：页面在「启用」时**自己随机生成** token，而 relay 只认它启动时那份
 * （环境变量 / 数据卷）→ 两边永远对不上，桥卡在「连接中…」，Agent 侧只看到
 * 「工具清单不可用：寻鸽工作台未连接 relay」，两边都以为是对方配置错。
 *
 * 修法是把 token 的来源收敛成**唯一一条**：relay 经配对码下发。本文件锁住三个特征
 * （查特征、不查手段 —— 改实现可以，改语义不行）：
 *   1. 点「配对」必须打到 `<httpBase>/pair`，且 code 归一为大写（服务端按大写比对）；
 *   2. 成功时必须写入**服务端返回的** token，而不是本地任何生成物；
 *   3. 失败时不得写入 token，且要把服务端原话显示出来（否则用户分不清是码错还是桥没起）。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiBridgeSection } from '../AiBridgeSection'
import { agentBridge } from '@/agent/bridge'
import { DEFAULT_SETTINGS, type Settings } from '@/db/types'

function makeSettings(ai: Partial<Settings['ai']> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, ...ai } }
}

describe('AI Agent 桥 · 配对码', () => {
  const save = vi.fn()

  beforeEach(() => {
    save.mockReset()
    // 不真的连 WS：本文件只关心「拿 token 的链路」，连接由 bridge 自己的测试覆盖
    vi.spyOn(agentBridge, 'connect').mockImplementation(() => {})
    vi.spyOn(agentBridge, 'disconnect').mockImplementation(() => {})
  })

  afterEach(() => {
    // 本仓 vitest 未开 globals，@testing-library 的自动清理不生效 → 必须手动 cleanup，
    // 否则上一条用例的 DOM 会残留到下一条（表现为「找到多个 button」这种假失败）。
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('配对成功：打到 /pair、code 大写归一、写入服务端下发的 token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'srv-token-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AiBridgeSection settings={makeSettings({ bridgeEnabled: true })} save={save} />)

    await userEvent.type(screen.getByPlaceholderText(/6 位/), 'ab12cd')
    await userEvent.click(screen.getByRole('button', { name: '配对' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/relay\/pair$/)
    // 端点必须是 http(s)：ws:// 打不了普通 HTTP 请求，写错会静默失败
    expect(String(url)).toMatch(/^https?:\/\//)
    expect(JSON.parse(String(init?.body))).toEqual({ code: 'AB12CD' })

    await waitFor(() => expect(save).toHaveBeenCalled())
    const patch = save.mock.calls.at(-1)?.[0] as Settings
    expect(patch.ai.bridgeToken).toBe('srv-token-1')
    expect(patch.ai.bridgeEnabled).toBe(true)
  })

  it('自定义 relay 地址：wss 映射成 https，不把 ws 直接当 HTTP 用', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ token: 't2' }) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <AiBridgeSection
        settings={makeSettings({ bridgeEnabled: true, bridgeUrl: 'wss://team.fpigeon.fun/relay' })}
        save={save}
      />,
    )

    await userEvent.type(screen.getByPlaceholderText(/6 位/), 'ZZ9999')
    await userEvent.click(screen.getByRole('button', { name: '配对' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://team.fpigeon.fun/relay/pair')
  })

  it('配对失败：显示服务端原话，且绝不写入 token（不能拿假 token 冒充已配对）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: '配对码无效或已过期（5 分钟有效、仅可兑换一次）' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AiBridgeSection settings={makeSettings({ bridgeEnabled: true })} save={save} />)

    await userEvent.type(screen.getByPlaceholderText(/6 位/), 'BADBAD')
    await userEvent.click(screen.getByRole('button', { name: '配对' }))

    await waitFor(() => expect(screen.getByText(/配对码无效或已过期/)).toBeTruthy())
    expect(save).not.toHaveBeenCalled()
  })

  it('空配对码：不发请求，只提示', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<AiBridgeSection settings={makeSettings({ bridgeEnabled: true })} save={save} />)

    await userEvent.click(screen.getByRole('button', { name: '配对' }))

    await waitFor(() => expect(screen.getByText('请先填入配对码')).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('后台签发配对码：带 Bearer 打 /pair/new，并把码显示出来', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 'K7M2QP', ttlSeconds: 300 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <AiBridgeSection settings={makeSettings({ bridgeEnabled: true, bridgeToken: 'tok-1' })} save={save} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '生成配对码' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/relay\/pair\/new$/)
    // 签码必须持 token：漏了 Authorization 会被服务端 401，功能等于不可用
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
    await waitFor(() => expect(document.body.textContent).toContain('K7M2QP'))
  })

  it('尚未配对时点生成：不发请求，明确提示（不能静默失败）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<AiBridgeSection settings={makeSettings({ bridgeEnabled: true })} save={save} />)
    await userEvent.click(screen.getByRole('button', { name: '生成配对码' }))

    await waitFor(() => expect(screen.getByText('尚未配对，无法签发配对码')).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

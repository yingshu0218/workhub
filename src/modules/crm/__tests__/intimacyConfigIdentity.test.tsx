// @vitest-environment jsdom
/**
 * 健康分配置 Hook 的**引用稳定性**回归锁（2026-10-12）
 *
 * 为什么值得单独立一条锁：`useIntimacyConfig()` 曾被实现成「只要 moduleConfigs 里存过配置记录，
 * 每次渲染都 `mergeIntimacyPayload` 出一个全新对象」。这个缺陷不报错、不让任何既有断言变红，
 * 但会把消费方（尤其是客户关系画布）的 effect 依赖打成**每次渲染都在变**：
 * useForceGraph 每帧 tick 的 setState → 重渲染 → 新 cfg 引用 → 仿真被整体重建 →
 * 布局永远收敛不了、`sim.on('end')` 不触发（onGraphReady 不回调）、以我为心的视图锚定随之失效。
 * 用户看到的是「画布一直抖、定位不对」，而 `tsc` / `lint` / 其它用例全绿 —— 无告警静默缺陷。
 *
 * 锁的**不变式**：Dexie 迟到通知落地之后，**纯重渲染不得改变返回对象引用**。
 * （写入确实会换引用，这是对的、也要锁住 —— 见第三组。）
 * 反向对照：把 config.ts 里的 `useMemo` 去掉，第二组断言立即变红。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { renderHook, waitFor, act } from '@testing-library/react'
import { db } from '@/db/db'
import { DEFAULT_INTIMACY_CONFIG, INTIMACY_CONFIG_ID, type ModuleConfig } from '@/db/types'
import { useIntimacyConfig } from '../intimacy'

function cfgRecord(over: Partial<ModuleConfig['payload']> = {}, updatedAt = 1): ModuleConfig {
  const d = DEFAULT_INTIMACY_CONFIG
  return {
    id: INTIMACY_CONFIG_ID,
    payload: { ...d, blacklist: { ...d.blacklist }, ...over },
    updatedAt,
    deleted: 0,
    rev: 1,
  }
}

/**
 * 等 Dexie 写入后的**迟到通知**全部落地。
 * 不这么做，断言可能在「首帧同步结果」与「写入通知触发的第二次查询结果」之间取样，
 * 测出来的波动来自时序而非被测实现 —— 先对齐到静置态再谈引用稳定性。
 */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r))
    })
  }
}

beforeEach(async () => {
  await db.moduleConfigs.clear()
})

describe('useIntimacyConfig 引用稳定性', () => {
  it('无配置记录时返回稳定的默认配置引用', async () => {
    const { result, rerender } = renderHook(() => useIntimacyConfig())
    await waitFor(() => expect(result.current).toBe(DEFAULT_INTIMACY_CONFIG))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('存在配置记录时，纯重渲染必须复用同一对象引用（画布仿真的依赖不变式）', async () => {
    await db.moduleConfigs.put(cfgRecord())
    const { result, rerender } = renderHook(() => useIntimacyConfig())
    await waitFor(() => expect(result.current.levels).toHaveLength(7))
    await settle()
    const first = result.current
    // 真实场景：仿真每帧 setState 都会触发一次重渲染，引用必须原地不动
    rerender()
    rerender()
    rerender()
    expect(result.current).toBe(first)
  })

  it('配置真正变化时仍产出新引用（不能把更新一并吞掉）', async () => {
    await db.moduleConfigs.put(
      cfgRecord({ blacklist: { ...DEFAULT_INTIMACY_CONFIG.blacklist, hideInGraph: true } }),
    )
    const { result } = renderHook(() => useIntimacyConfig())
    await waitFor(() => expect(result.current.blacklist.hideInGraph).toBe(true))
    await settle()
    const first = result.current

    await db.moduleConfigs.put(
      cfgRecord({ blacklist: { ...DEFAULT_INTIMACY_CONFIG.blacklist, hideInGraph: false } }, 2),
    )
    await waitFor(() => expect(result.current.blacklist.hideInGraph).toBe(false))
    expect(result.current).not.toBe(first)
  })
})

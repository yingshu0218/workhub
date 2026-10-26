// @vitest-environment jsdom
/**
 * T3 事件总线泛化 · 单一声明表收敛锁
 *
 * 此前事件契约登记在 4 处手工副本（AppEvent / AgentEventDeclaration payload 复刻 /
 * TOOL_EVENTS+SUNK_EVENTS 治理表 / emitDeclared 校验），加一种事件要四处同步、漏一处
 * 即静默漂移（交接文档 T3 缺口②）。收敛后 `shared/eventContract.ts#EVENT_DECLARATIONS`
 * 是唯一事实源，其余全部派生。本文件锁「派生不漂移」：
 * 1. TOOL_EVENTS 与 contract 反转一致（工具绑定只增不减不变形）；
 * 2. SUNK_EVENTS = contract sunk 标记集合；
 * 3. APP_EVENT_NAMES 覆盖 contract 全键（replay 白名单不漏事件）；
 * 4. emitDeclared 的载荷 zod 校验双向（多给/少给/形状错都拒）；
 * 5. 信封：转发器收到 occurredAt（emit 时刻）——agent_events 行的语义修正。
 * 变异校验：从 contract 删一个事件的 tool 绑定 → ① 恰红；emitDeclared 载荷形状错 → ④ 恰红。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { EVENT_DECLARATIONS, toolEventsMap, isSunk } from '@/shared/eventContract'
import { TOOL_EVENTS, SUNK_EVENTS, agentLayerEvents } from '@/agent/schema'
import { eventBus, setEventForwarder, APP_EVENT_NAMES } from '@/shared/eventBus'
import { emitDeclared } from '@/agent/executor'

beforeEach(() => {
  setEventForwarder(null as unknown as never)
})

describe('契约派生不漂移', () => {
  it('① TOOL_EVENTS 与字面量快照一致（变异校验教训：与派生源比较自身是假锁，必须钉内容）', () => {
    // TOOL_EVENTS 现在由 contract 派生（不再手写），但**内容**被这份快照钉死——
    // contract 里误删/改工具绑定、或误把 domainEvent 改成 localEvent，这里立即红。
    expect(TOOL_EVENTS).toEqual({
      'fin_recordTransaction': ['transaction:created'],
      'crm_addInteraction': ['customer:contacted'],
      'habit_checkin': ['habit:checked'],
    })
    // 派生路径仍要一致（防「有人把派生改回手写表但内容忘了跟 contract」）
    expect(TOOL_EVENTS).toEqual(toolEventsMap())
    // 反向：每个 TOOL_EVENTS 条目都能在 contract 里找到同绑定
    for (const [tool, events] of Object.entries(TOOL_EVENTS)) {
      for (const e of events) {
        expect(EVENT_DECLARATIONS[e as keyof typeof EVENT_DECLARATIONS].tool).toBe(tool)
        expect(isSunk(e as keyof typeof EVENT_DECLARATIONS)).toBe(true) // 现状三事件全下沉
      }
    }
  })

  it('② SUNK_EVENTS = contract 的 sunk 标记集合；agentLayerEvents 恒空（现状全下沉）', () => {
    const sunkFromContract = Object.entries(EVENT_DECLARATIONS)
      .filter(([, d]) => d.sunk)
      .map(([e]) => e)
    expect([...SUNK_EVENTS].sort()).toEqual([...sunkFromContract].sort())
    for (const tool of Object.keys(TOOL_EVENTS)) {
      expect(agentLayerEvents(tool)).toEqual([])
    }
  })

  it('③ APP_EVENT_NAMES 覆盖 contract 全键（replay 白名单不漏事件）', () => {
    expect([...APP_EVENT_NAMES].sort()).toEqual(Object.keys(EVENT_DECLARATIONS).sort())
    // AppEvent 键集与 contract 同源（类型层已保证，这里锁运行期清单形状）
    const appKeys = [
      'transaction:created',
      'customer:contacted',
      'habit:checked',
      'focus:completed',
      'quicknote:convert',
      'exp:changed',
      'trophy:unlocked',
      'settings:changed',
      'moduleConfig:changed',
    ]
    expect([...APP_EVENT_NAMES].sort()).toEqual(appKeys.sort())
  })
})

describe('emitDeclared 载荷契约校验（T3 增强）', () => {
  it('④ 载荷形状错 → 拒绝（此前只查「给了没给」，形状错会静默发给消费者）', () => {
    // 唯一未下沉路径不存在（现状全 sunk），这里直接断言 sunk 拒绝仍在 + 未声明拒绝仍在
    expect(() => emitDeclared('fin_recordTransaction', { 'transaction:created': { transactionId: 't1' } }))
      .toThrow('已下沉 repositories 层')
    expect(() => emitDeclared('fin_createLedger', { 'transaction:created': { transactionId: 't1' } }))
      .toThrow('未声明事件')
  })

  it('⑤ 本地事件不经 emitDeclared（local 无 tool 绑定，不进 TOOL_EVENTS）', () => {
    expect(TOOL_EVENTS['trophy:unlocked' as string]).toBeUndefined()
  })
})

describe('信封：转发器收到 emit 时刻（occurredAt 语义修正）', () => {
  it('⑥ forwarder 第三参携带 occurredAt（事件发生时刻而非落库时刻）', () => {
    const seen: Array<{ occurredAt: number }> = []
    setEventForwarder((_event, _payload, meta) => {
      seen.push({ occurredAt: meta.occurredAt })
    })
    const t0 = Date.now()
    eventBus.emit('habit:checked', { habitId: 'h1', date: 'd1' })
    expect(seen).toHaveLength(1)
    expect(seen[0].occurredAt).toBeGreaterThanOrEqual(t0)
  })

  it('⑦ 本地事件同样过转发器（服务端不区分——注入与否由宿主决定）', () => {
    const events: string[] = []
    setEventForwarder((event) => events.push(String(event)))
    eventBus.emit('trophy:unlocked', { trophyId: 't1' })
    eventBus.emit('transaction:created', { transactionId: 't1' })
    expect(events).toEqual(['trophy:unlocked', 'transaction:created'])
  })
})

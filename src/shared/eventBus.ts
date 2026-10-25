/** 轻量类型化事件总线 —— 跨模块联动（开发计划 2.3 联动机制）的解耦核心 */
import type { Settings } from '@/db/types'

export type AppEvent = {
  'focus:completed': { minutes: number }
  'habit:checked': { habitId: string; date: string }
  'transaction:created': { transactionId: string; customerId?: string }
  'customer:contacted': { customerId: string }
  'quicknote:convert': { quickNoteId: string; to: 'todo' | 'note' }
  'exp:changed': { delta: number; reason: string }
  'trophy:unlocked': { trophyId: string }
  'settings:changed': { settings: Settings }
  /** 模块配置变更（Issue #34 亲密度配置走 moduleConfigs 同步表，消费端实时应用） */
  'moduleConfig:changed': { key: string }
}

type Handler<K extends keyof AppEvent> = (payload: AppEvent[K]) => void

/**
 * 事件名的运行期白名单（与 AppEvent 键集**双向编译期锁死**，见下方两个类型断言）。
 *
 * 为什么需要它：AppEvent 是闭集字面量，但 replay 通道（drainAgentEvents）拿到的是
 * 服务端行里的**任意字符串**——`as keyof AppEvent` 盲转型把类型安全整个旁路。
 * 闭集 registry 下未知名今天是无害 no-op，但事件名一旦泛化（事件总线泛化议题，
 * 见 docs/关联层剩余任务-交接-20261026.md T3），未知名就会穿透分发。replay 侧
 * **必须**先有这份白名单校验，泛化才有安全的落点（2026-10-26 T3 前置项）。
 */
export const APP_EVENT_NAMES = [
  'focus:completed',
  'habit:checked',
  'transaction:created',
  'customer:contacted',
  'quicknote:convert',
  'exp:changed',
  'settings:changed',
  'trophy:unlocked',
  'moduleConfig:changed',
] as const satisfies readonly (keyof AppEvent)[]

/**
 * 防漂移（编译期双向）：
 * ① 数组项必须是合法事件名 —— 由上方 `satisfies readonly (keyof AppEvent)[]` 保证；
 * ② AppEvent 的每个键都必须出现在数组里 —— `_assertExhaustive` 保证：漏一个键时
 *    条件类型落到 `never` 分支、`true` 赋值报错。**不能用 `null as never` 占位**——
 *    `never` 可赋给任何类型，断言会静默失效（2026-10-26 实测踩到）。
 */
type _Missing = Exclude<keyof AppEvent, (typeof APP_EVENT_NAMES)[number]>
const _assertExhaustive: _Missing extends never ? true : never = true
void _assertExhaustive

const registry = new Map<keyof AppEvent, Set<(payload: never) => void>>()

/**
 * 事件转发器（P4 agent_events，方案 §5.4-A）：emit 时额外调用（在本地分发之后）。
 * 仅服务端执行器注入（见 agent/serverReads.ts initServerExecutor）——服务端 eventBus
 * 无消费者，领域事件经此落 PB `agent_events`，客户端 pull 后 replay 到本地 eventBus。
 * 浏览器端不注入（转发器为 null，行为与既有完全一致）。
 */
let forwarder: ((event: keyof AppEvent, payload: unknown) => void) | null = null

export function setEventForwarder(fn: (event: keyof AppEvent, payload: unknown) => void): void {
  forwarder = fn
}

export const eventBus = {
  on<K extends keyof AppEvent>(event: K, handler: Handler<K>): () => void {
    if (!registry.has(event)) registry.set(event, new Set())
    const set = registry.get(event)!
    set.add(handler as (payload: never) => void)
    return () => set.delete(handler as (payload: never) => void)
  },

  emit<K extends keyof AppEvent>(event: K, payload: AppEvent[K]) {
    registry.get(event)?.forEach((h) => {
      try {
        ;(h as (p: AppEvent[K]) => void)(payload)
      } catch (err) {
        console.error(`[eventBus] handler error on ${String(event)}`, err)
      }
    })
    // 转发器在本地分发**之后**调用（顺序纪律：事件永在事务之后，转发不改变本地语义）
    if (forwarder) {
      try {
        forwarder(event, payload)
      } catch (err) {
        console.error(`[eventBus] forwarder error on ${String(event)}`, err)
      }
    }
  },
}

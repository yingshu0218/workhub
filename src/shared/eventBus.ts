/**
 * 轻量类型化事件总线 —— 跨模块联动（开发计划 2.3 联动机制）的解耦核心。
 *
 * **事件契约的单一事实源在 `./eventContract.ts`（T3 泛化收敛）**：本文件的 AppEvent
 * 与 APP_EVENT_NAMES 都从声明表派生，不再手写映射——加一种事件只改 eventContract
 * 一处（类型、replay 白名单、agent 契约治理表随之生效）。本文件只保留总线机制本身
 * （订阅表 / emit 顺序纪律 / 转发器）。
 */
import { EVENT_DECLARATIONS, EVENT_NAMES, type EventName, type EventPayload } from './eventContract'

/** 事件名 → payload 的映射（由声明表逐键派生；改 contract 即改这里） */
export type AppEvent = {
  [K in keyof typeof EVENT_DECLARATIONS]: EventPayload<K>
}

type Handler<K extends keyof AppEvent> = (payload: AppEvent[K]) => void

/**
 * 事件名的运行期白名单（replay 通道用，T3 前置项）。
 *
 * 为什么需要它：replay 通道（drainAgentEvents）拿到的是服务端行里的**任意字符串**——
 * `as keyof AppEvent` 盲转型把类型安全整个旁路。未知名现在会在 replay 侧被拒绝
 * （警告跳过），泛化事件名才有安全落点。由声明表派生，不存在「加事件忘登记」。
 */
export const APP_EVENT_NAMES = EVENT_NAMES

const registry = new Map<keyof AppEvent, Set<(payload: never) => void>>()

/** 转发元数据（信封 as-built，见 eventContract 头注释）：occurredAt = **emit 时刻** */
export interface EventForwardMeta {
  occurredAt: number
}

/**
 * 事件转发器（P4 agent_events，方案 §5.4-A）：emit 时额外调用（在本地分发之后）。
 * 仅服务端执行器注入（见 agent/serverReads.ts initServerExecutor）——服务端 eventBus
 * 无消费者，领域事件经此落 PB `agent_events`，客户端 pull 后 replay 到本地 eventBus。
 * 浏览器端不注入（转发器为 null，行为与既有完全一致）。
 */
let forwarder: ((event: keyof AppEvent, payload: unknown, meta: EventForwardMeta) => void) | null =
  null

export function setEventForwarder(
  fn: (event: keyof AppEvent, payload: unknown, meta: EventForwardMeta) => void,
): void {
  forwarder = fn
}

let interceptor: ((event: keyof AppEvent, payload: unknown) => boolean) | null = null
export function setEventInterceptor(fn: typeof interceptor): void { interceptor = fn }

export const eventBus = {
  on<K extends keyof AppEvent>(event: K, handler: Handler<K>): () => void {
    if (!registry.has(event)) registry.set(event, new Set())
    const set = registry.get(event)!
    set.add(handler as (payload: never) => void)
    return () => set.delete(handler as (payload: never) => void)
  },

  emit<K extends keyof AppEvent>(event: K, payload: AppEvent[K]) {
    if (interceptor?.(event, payload)) return
    registry.get(event)?.forEach((h) => {
      try {
        ;(h as (p: AppEvent[K]) => void)(payload)
      } catch (err) {
        console.error(`[eventBus] handler error on ${String(event)}`, err)
      }
    })
    // 转发器在本地分发**之后**调用（顺序纪律：事件永在事务之后，转发不改变本地语义）；
    // occurredAt 取 emit 时刻而非落库时刻——事件发生与落库之间隔着 PB 写入队列。
    if (forwarder) {
      try {
        forwarder(event, payload, { occurredAt: Date.now() })
      } catch (err) {
        console.error(`[eventBus] forwarder error on ${String(event)}`, err)
      }
    }
  },
}

/** 供测试/工具断言的事件名类型收窄（与 EventName 同一来源） */
export type { EventName }

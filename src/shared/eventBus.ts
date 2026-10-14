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

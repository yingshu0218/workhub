/** 轻量类型化事件总线 —— 跨模块联动（开发计划 2.3 联动机制）的解耦核心 */
export type AppEvent = {
  'focus:completed': { minutes: number }
  'habit:checked': { habitId: string; date: string }
  'transaction:created': { transactionId: string; customerId?: string }
  'customer:contacted': { customerId: string }
  'quicknote:convert': { quickNoteId: string; to: 'todo' | 'note' }
  'exp:changed': { delta: number; reason: string }
  'trophy:unlocked': { trophyId: string }
}

type Handler<K extends keyof AppEvent> = (payload: AppEvent[K]) => void

const registry = new Map<keyof AppEvent, Set<(payload: never) => void>>()

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
  },
}

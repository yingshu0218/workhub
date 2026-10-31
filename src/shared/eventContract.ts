/**
 * 领域事件契约（T3 事件总线泛化 · 单一声明表）
 *
 * **收敛了什么**：此前事件契约登记在 **4 处手工副本** —— ① `AppEvent` 类型映射
 * （eventBus.ts）② `AgentEventDeclaration` payload 复刻（agent/schema.ts）
 * ③ `TOOL_EVENTS`/`SUNK_EVENTS` 治理表 ④ `executor.emitDeclared` 双向校验。
 * 加一种事件要改四处、漏一处就是静默漂移（交接文档 T3 缺口②）。现在：**本表是
 * 唯一事实源**，其余全部由此派生（类型层派生 AppEvent / AgentEventDeclaration，
 * 运行时派生 TOOL_EVENTS / SUNK_EVENTS / APP_EVENT_NAMES）。
 *
 * **层级纪律**：本文件放 shared（eventBus 与 agent/schema 都要用它），只依赖 zod
 * 与 `@/db/types` 的**纯类型** —— 不引 storage/db/agent（与 remoteNormalize/linkId
 * 同款零运行时依赖纪律，任何层可安全引入）。
 *
 * **信封 as-built 裁决（2026-10-26）**：交接文档要求的信封字段落地为——
 * - actor = `agent_events.tool` 列（**已有**，语义即发出方：服务端执行器恒 'server-executor'）；
 * - occurredAt = **emit 时刻**（本次起由 emit 边界生成传入，替代原先「PB 落库时刻」——
 *   事件发生与落库之间隔着队列，落库时刻是错的语义）；
 * - kind = 事件名自含（`域:动作`），不另设列；
 * - **txId 刻意不引入**：StorageAdapter 原语没有事务 id 概念，引入是存储层大改；
 *   而「一次操作至多发一个领域事件」的单值化先例（§2.1）下不存在跨行关联需求。
 *   将来若出现一次操作多事件，再连同 StorageAdapter 一起设计。
 * - 模式订阅（`customer:*` 通配）：**不做**——现有消费方全部精确订阅，无需求不加 API。
 */
import { z } from 'zod'
import type { Settings } from '@/db/types'

/** 本地事件（无工具绑定）：只在产生它的 JS context 内消费，不进 agent_events 契约 */
const localEvent = <T extends z.ZodTypeAny>(schema: T) => ({ schema, tool: undefined, sunk: false })

/** 领域事件（有写工具绑定）：agent 契约的一部分；sunk = 发出方已下沉 repositories 层 */
const domainEvent = <T extends z.ZodTypeAny>(schema: T, tool: string, sunk = true) => ({
  schema,
  tool,
  sunk,
})

export const EVENT_DECLARATIONS = {
  // ───── 领域事件（agent 契约，经服务端执行器落 PB agent_events） ─────
  'transaction:created': domainEvent(
    z.object({
      transactionId: z.string(),
      /** UI 侧 emit 恒带 undefined 键（对齐测试锁「逐字段一致」），故 optional 而非可选键省略 */
      customerId: z.string().optional(),
    }),
    'fin_recordTransaction',
  ),
  'customer:contacted': domainEvent(
    z.object({ customerId: z.string() }),
    'crm_addInteraction',
  ),
  'habit:checked': domainEvent(
    z.object({ habitId: z.string(), date: z.string() }),
    'habit_checkin',
  ),
  // ───── 本地事件（UI 状态联动；不进 agent 契约） ─────
  'focus:completed': localEvent(z.object({ minutes: z.number() })),
  'quicknote:convert': localEvent(
    z.object({ quickNoteId: z.string(), to: z.enum(['todo', 'note']) }),
  ),
  'exp:changed': localEvent(z.object({ delta: z.number(), reason: z.string() })),
  'trophy:unlocked': localEvent(z.object({ trophyId: z.string() })),
  'settings:changed': localEvent(z.object({ settings: z.custom<Settings>(() => true) })),
  /** 模块配置变更（Issue #34 亲密度配置走 moduleConfigs 同步表，消费端实时应用） */
  'moduleConfig:changed': localEvent(z.object({ key: z.string() })),
} as const

export type EventName = keyof typeof EVENT_DECLARATIONS

/** 领域事件名子集（有 tool 绑定的事件——agent 契约只覆盖这一层） */
export type DomainEventName = {
  [K in EventName]: (typeof EVENT_DECLARATIONS)[K]['tool'] extends string ? K : never
}[EventName]

/** 事件 payload 类型（AppEvent 的派生源——eventBus.ts 不再手写映射） */
export type EventPayload<K extends EventName = EventName> = z.infer<
  (typeof EVENT_DECLARATIONS)[K]['schema']
>

/** 事件名运行期清单（replay 白名单的派生源——防「加事件忘登记 replay」） */
export const EVENT_NAMES = Object.keys(EVENT_DECLARATIONS) as EventName[]

/** 事件是否已下沉 repositories 层（agentOps 不得重复 emit） */
export function isSunk(event: EventName): boolean {
  return EVENT_DECLARATIONS[event].sunk
}

/** 写工具 → 声明的事件（TOOL_EVENTS 的派生源；仅领域事件） */
export function toolEventsMap(): Record<string, DomainEventName[]> {
  const map: Record<string, DomainEventName[]> = {}
  for (const [event, d] of Object.entries(EVENT_DECLARATIONS)) {
    if (!d.tool) continue
    ;(map[d.tool] ??= []).push(event as DomainEventName)
  }
  return map
}

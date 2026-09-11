/**
 * 待办领域常量与工具 —— 全站状态口径的唯一来源
 *
 * 背景（Issue #74 口径统一讨论）：
 * - status 收窄为两态：'todo' | 'done'。原 'doing' 是死枚举（全仓零写入、
 *   零专属展示），「专注中」是 focus store 的运行时 UI 状态，不落库。
 * - 未完成判断统一用 isTodoOpen()，禁止各处手写 status !== 'done'。
 * - 状态文案统一用 todoStatusLabel()，禁止各模块自己写三元表达式。
 *
 * Issue #128 扩展：新增第三态 'voided'（已作废）——「作废」= 事项终止，
 * 与「删除」（软删、记录消失、不可恢复）严格区分：作废只置状态位、记录保留、
 * 可恢复，且**不算完成也不算未完成**（不计入完成率分母/健康分/逾期提醒）。
 * 定义三态判定并全部收口到本模块，任何模块不得内联 `status === 'done'` 之类的判据。
 */
import dayjs from 'dayjs'
import { db } from '@/db/db'
import { syncEngine } from '@/sync/engine'
import type { Todo } from '@/db/types'
import { normalizeTodoPriority } from './priority'

export type TodoStatus = Todo['status']

/** 未完成（待处理）判定：所有「未完成」口径的唯一入口 */
export function isTodoOpen(t: Pick<Todo, 'status'>): boolean {
  return t.status === 'todo'
}

/** 已完成判定：完成率/「今日已完成」统计的唯一口径 */
export function isTodoDone(t: Pick<Todo, 'status'>): boolean {
  return t.status === 'done'
}

/**
 * 已作废判定（Issue #128）：事项被显式终止。
 * 作废条目**不属于**未完成，也**不属于**已完成——既不催办、也不计入完成率。
 */
export function isTodoVoided(t: Pick<Todo, 'status'>): boolean {
  return t.status === 'voided'
}

/** 已结束判定：完成或作废（两者都是「不再是待办」的终态） */
export function isTodoFinished(t: Pick<Todo, 'status'>): boolean {
  return t.status !== 'todo'
}

/** 状态文案：todo → 待处理 / done → 已完成 / voided → 已作废 */
export function todoStatusLabel(t: Pick<Todo, 'status'>): string {
  return t.status === 'done' ? '已完成' : t.status === 'voided' ? '已作废' : '待处理'
}

/**
 * 深链定位的视图选择：`/todo?focus=<id>` 跳进来时，**按目标自身状态**决定左栏视图。
 *
 * 为什么必须按状态切视图（Issue #128 三态口径的连带缺口）：
 * 「全部待办 / 收集箱 / 今天 / 最近七天」只装**未完成**条目，已完成/已作废是独立终态视图。
 * 而穿透入口（客户时间线鱼骨 / CRM 活动流）最常指向**终态**待办——
 * 若一律切到「全部待办」，目标会被挡在视图外，表现为「点进去跳了、但目标行不见」。
 *
 * @returns 'done' | 'voided' | 'all'（未找到目标时回 'all'，由调用方兜底滚动失败）
 */
export function resolveFocusViewKind(
  todos: readonly Pick<Todo, 'id' | 'status'>[],
  focusId: string | undefined,
): 'all' | 'done' | 'voided' {
  if (!focusId) return 'all'
  const target = todos.find((t) => t.id === focusId)
  if (!target) return 'all'
  return isTodoDone(target) ? 'done' : isTodoVoided(target) ? 'voided' : 'all'
}

/**
 * 待办详情深链：`/todo?focus=<todoId>`（Issue #162 收口）
 *
 * TodoPage 消费 focus 参数后：切到目标所在视图 → 滚动高亮 → **打开该条详情抽屉**。
 * 此前该深链在搜索 / CRM 时间线骨刺 / 工作台速记处置三处各写一遍
 * `encodeURIComponent`，本次收口到一处；财务凭证详情「查看待办详情」也改走本函数，
 * 与 `financeFocusPath` 同口径，避免「入口承诺详情、实际只落到列表」。
 */
export function todoFocusPath(todoId: string): string {
  return `/todo?focus=${encodeURIComponent(todoId)}`
}

/**
 * 「今天」口径（待办软件通行做法）：今日截止 ∪ 逾期未完成。
 * 待办中心筛选/计数、工作台今日日程卡、待办达成分母统一引用本函数。
 * 作废条目（Issue #128）不进本口径：事项已终止，不再催办、不计逾期。
 */
export function isDueToday(t: Pick<Todo, 'status' | 'dueAt'>, todayStr: string): boolean {
  if (!isTodoOpen(t) || !t.dueAt) return false
  return dayjs(t.dueAt).format('YYYY-MM-DD') <= todayStr
}

/**
 * 「逾期」判定（Issue #134 四轮：今日到期与逾期分开展示；五轮改为**按天**口径）。
 *
 * 逾期 = 未完成 **且** 截止日期是**今天之前的一个自然日**（`YYYY-MM-DD < todayStr`）。
 *
 * 为什么按天而不是按时刻：按时刻判定时，今天上午 09:00 的待办一到下午就跳进「逾期」组，
 * 用户口径里的「逾期」是**过了期限还没交**（跨天欠账），不是「当天的钟点过了」——
 * 当天的钟点过了仍在「今日到期」里按计划推进即可，跨天未完成才叫逾期。
 * 按天判定同时让「逾期天数」有唯一、稳定的语义（今天 - 截止日），
 * 不再随时分秒跳动，也不再让当天的分组在两列之间来回横跳。
 */
export function isTodoOverdue(
  t: Pick<Todo, 'status' | 'dueAt'>,
  todayStr: string = dayjs().format('YYYY-MM-DD'),
): boolean {
  if (!isTodoOpen(t) || !t.dueAt) return false
  return dayjs(t.dueAt).format('YYYY-MM-DD') < todayStr
}

/**
 * 「今日到期」判定：未完成 + 截止落在今天这一自然日（含今日已过点的条目）。
 *
 * 与 isDueToday（今日到期 ∪ 逾期）的关系：`isDueToday = isTodoDueToday || isTodoOverdue`。
 * 按天口径下两组天然互斥（今天 vs 今天之前），不会同时命中；
 * 今日已过点的条目仍留在「今日到期」组（按计划推进），只有跨天未完成才进「逾期」。
 */
export function isTodoDueToday(
  t: Pick<Todo, 'status' | 'dueAt'>,
  todayStr: string,
): boolean {
  if (!isTodoOpen(t) || !t.dueAt) return false
  return dayjs(t.dueAt).format('YYYY-MM-DD') === todayStr
}

/**
 * 逾期天数（自然日，>= 1）：今天 - 截止日，按日期差计算（不含时分，避免跨小时抖动）。
 * 仅供「已逾期 N 天」这类催办文案使用；逾期判定本身用 isTodoOverdue。
 */
export function overdueDays(
  t: Pick<Todo, 'status' | 'dueAt'>,
  todayStr: string = dayjs().format('YYYY-MM-DD'),
): number {
  if (!isTodoOverdue(t, todayStr) || !t.dueAt) return 0
  return dayjs(todayStr).diff(dayjs(t.dueAt).format('YYYY-MM-DD'), 'day')
}

/**
 * 存量数据兜底（一次性，幂等）：凡 status='done' 但缺 completedAt 的待办，
 * 以 updatedAt 补盖完成时间。没有这条兜底，「今日已完成」统计、CRM 时间轴、
 * 工作台完成数（均要求 completedAt）会静默漏计这些记录。
 * 兼容历史散写路径（灵感/CRM 等曾直接写 status='done' 不写 completedAt）。
 */
export async function backfillTodoCompletedAt(): Promise<number> {
  const todos = await db.todos.toArray()
  const need = todos.filter((t) => !t.deleted && t.status === 'done' && !t.completedAt)
  if (need.length === 0) return 0
  const now = Date.now()
  await db.transaction('rw', [db.todos, db.syncQueue], async () => {
    for (const t of need) {
      await db.todos.put({
        ...t,
        completedAt: t.updatedAt || now,
        updatedAt: now,
        rev: t.rev + 1,
      })
      await db.syncQueue.add({
        table: 'todos',
        recordId: t.id,
        op: 'upsert',
        createdAt: now,
      })
    }
  })
  syncEngine.requestSync()
  return need.length
}

/**
 * 存量数据迁移（**显式动作，非启动自动**）：把旧档位 `P1/P2/P3` 归一化为四档 `high/mid/low`。
 *
 * 为什么不做启动自动迁移（Issue #148 后续 · 上轮审计建议 4）：
 * `high|mid|low|none` 是 Dexie 的**合法键名**（与 v11 数组化那次「旧键是脏数据」不同），
 * 老数据 `P1/P2/P3` 读侧已被 `normalizeTodoPriority` 兜住，功能上无需改写；
 * 而自动把每条老记录 `rev+1` 会推进 `updatedAt`，进而破坏跨设备同步的 LWW 判据
 * （在本机没编辑过的记录会在其他设备上"胜出"覆盖）。故改为**用户显式触发**的一次性迁移：
 *
 * - 扫描未软删待办，凡档位不是四档合法值 => `normalizeTodoPriority` 归一化后落库 + 入同步队列；
 * - 幂等：已是新档位的记录不动、不入队（重复点击第二次返回 0）；
 * - 返回迁移条数，供 UI/Agent 如实反馈。
 */
export async function migrateLegacyTodoPriority(): Promise<number> {
  const todos = await db.todos.toArray()
  const need = todos.filter((t) => !t.deleted && t.priority !== normalizeTodoPriority(t.priority))
  if (need.length === 0) return 0
  const now = Date.now()
  await db.transaction('rw', [db.todos, db.syncQueue], async () => {
    for (const t of need) {
      await db.todos.put({
        ...t,
        priority: normalizeTodoPriority(t.priority),
        updatedAt: now,
        rev: t.rev + 1,
      })
      await db.syncQueue.add({
        table: 'todos',
        recordId: t.id,
        op: 'upsert',
        createdAt: now,
      })
    }
  })
  syncEngine.requestSync()
  return need.length
}

/**
 * 存量数据兜底（一次性，幂等）：status='voided' 但缺 voidedAt 的待办补盖作废时间。
 * 与 backfillTodoCompletedAt 同款纪律（成对写入的字段不允许单边存在）。
 */
export async function backfillTodoVoidedAt(): Promise<number> {
  const todos = await db.todos.toArray()
  const need = todos.filter((t) => !t.deleted && t.status === 'voided' && !t.voidedAt)
  if (need.length === 0) return 0
  const now = Date.now()
  await db.transaction('rw', [db.todos, db.syncQueue], async () => {
    for (const t of need) {
      await db.todos.put({
        ...t,
        voidedAt: t.updatedAt || now,
        updatedAt: now,
        rev: t.rev + 1,
      })
      await db.syncQueue.add({
        table: 'todos',
        recordId: t.id,
        op: 'upsert',
        createdAt: now,
      })
    }
  })
  syncEngine.requestSync()
  return need.length
}

import type { Customer, Project, Todo, Transaction } from '@/db/types'

/**
 * 交易关联（客户 / 待办 / 项目）多值化的统一口径（Issue #140 方案 A）
 *
 * 为什么单独成模块：数组化之后「读取」这件事散落在 10+ 处（列表芯片、详情抽屉、
 * 级联解绑、CRM 建边/亲密度、灵感引擎、agentOps 投影…），每处各写一遍
 * `?? []` 兜底必然会写漏（漏一处就是静默丢关联）。这里收口三件事：
 *
 * 1. `txnXxxIds(txn)` —— 纯读取投影：兼容老数据/服务端未升级时的旧单值字段
 *    （`customerId` 等），保证调用方永远拿到数组。
 * 2. `normalizeTxnLinks(rec)` —— 远端记录归一化：LWW 合并与读链路共用，
 *    把旧单值字段就地折叠进数组并去掉旧键（双写不双读）。
 * 3. `pruneTxnLinkIds` / `dedupeIds` —— 写入前的数据纪律：去重 + 过滤已删实体 id
 *    （弱引用纪律：实体不存在仅解绑，不报错）。
 */

/** 旧单值字段 → 数组别名（远端服务端集合未升级时仍可能推来旧键） */
const LEGACY_KEYS = ['customerId', 'todoId', 'projectId'] as const

/** 单值 / 数组 / JSON 字符串 → 去重后的非空字符串数组 */
export function toIdArray(v: unknown): string[] {
  if (typeof v === 'string') {
    const s = v.trim()
    // 服务端 json 字段可能返回 JSON 字符串（同 mergeRemote.toArrayField 的口径）
    if (s.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(s)
        if (Array.isArray(parsed)) return toIdArray(parsed)
      } catch {
        /* 非 JSON：按普通字符串处理 */
      }
    }
    return s ? [s] : []
  }
  if (Array.isArray(v)) {
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x.trim()))]
  }
  return []
}

/** 归一化任意交易形态记录的三个关联数组（保留 undefined，便于「空即无键」序列化） */
function pick(rec: Record<string, unknown>, arrKey: string, legacyKey: string): string[] | undefined {
  const ids = [...toIdArray(rec[arrKey]), ...toIdArray(rec[legacyKey])]
  const deduped = [...new Set(ids)]
  return deduped.length > 0 ? deduped : undefined
}

export interface TxnLinkRecord {
  customerIds?: string[]
  todoIds?: string[]
  projectIds?: string[]
}

/**
 * 远端记录 / 老数据归一化（双写不双读的收尾）：
 * 数组字段与旧单值字段都读，合并去重后只写数组，并**删除旧键**。
 * 直接原地修改传入对象（合并层随后整体 put）。
 */
export function normalizeTxnLinks<T extends Record<string, unknown>>(rec: T): T & TxnLinkRecord {
  const target = rec as Record<string, unknown>
  const customerIds = pick(target, 'customerIds', 'customerId')
  const todoIds = pick(target, 'todoIds', 'todoId')
  const projectIds = pick(target, 'projectIds', 'projectId')
  if (customerIds) target.customerIds = customerIds
  else delete target.customerIds
  if (todoIds) target.todoIds = todoIds
  else delete target.todoIds
  if (projectIds) target.projectIds = projectIds
  else delete target.projectIds
  for (const k of LEGACY_KEYS) delete target[k]
  return target as T & TxnLinkRecord
}

/** 关联客户 id（数组口径；兼容旧单值记录） */
export function txnCustomerIds(txn: Pick<Transaction, 'customerIds'> | Record<string, unknown>): string[] {
  return pick(txn as Record<string, unknown>, 'customerIds', 'customerId') ?? []
}

/** 关联待办 id（数组口径；兼容旧单值记录） */
export function txnTodoIds(txn: Pick<Transaction, 'todoIds'> | Record<string, unknown>): string[] {
  return pick(txn as Record<string, unknown>, 'todoIds', 'todoId') ?? []
}

/** 关联项目 id（数组口径；兼容旧单值记录） */
export function txnProjectIds(txn: Pick<Transaction, 'projectIds'> | Record<string, unknown>): string[] {
  return pick(txn as Record<string, unknown>, 'projectIds', 'projectId') ?? []
}

/** 数组 → 保留字段的写入形态：空数组不落键（与 seed/repository 的空即无键口径一致） */
export function toLinkField(ids: string[]): string[] | undefined {
  const deduped = [...new Set(ids.filter((x) => !!x))]
  return deduped.length > 0 ? deduped : undefined
}

/**
 * 写入前数据纪律：去重 + 过滤已删（或不存在）实体 id。
 * 弱引用语义 —— 解绑不报错，直接丢弃失效 id，避免把悬挂引用写进库。
 */
export function pruneTxnLinkIds(
  ids: string[],
  alive: Set<string>,
): string[] {
  return [...new Set(ids)].filter((id) => alive.has(id))
}

/** 已删实体 id 集合（供表单保存前过滤） */
export function aliveIdSet<T extends { id: string }>(rows: T[]): Set<string> {
  return new Set(rows.map((r) => r.id))
}

/** 便捷类型别名：关联实体候选集 */
export interface TxnLinkEntities {
  customers: Customer[]
  todos: Todo[]
  projects: Project[]
}

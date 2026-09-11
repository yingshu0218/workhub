/**
 * 领域命令层（domain commands）—— 跨模块动作的唯一实现体。
 *
 * 为什么需要它（P1 补强）：
 * 方案 §2.1 的硬规则是「一个业务动作只应有一处实现」——否则 UI 与 AI 两条路径各写一份，
 * 漂移不可避免（第 2 步的事件下沉已经把**事件**收口到 repositories 层，但**动作编排**仍是两份）。
 *
 * 典型病灶：`fin_recordTransaction` 在 executor 里手工拼 `occurredAt` 落库口径（startOf('day')），
 * 与 `TransactionFormDrawer.save()` 的同一段拼接是两份实现；一旦一侧改了「记账时间粒度」
 * 或「缺省账本策略」，AI 记的账与手工记的账就会出现字段级差异，而 §7.1 的验收恰恰
 * 要求两者 `transaction:created` 载荷与落库结果**逐字段一致**。
 *
 * 边界（与 repositories 的分工）：
 * - repositories：纯存储 + 复合原子函数（盖章 / 入队 / 事务后 emit），不认识「业务动作」；
 * - domain：**动作级编排**（缺省值策略、口径归一、跨表组合），落在 repositories 之上；
 * - agentOps executor 与 UI 调用方**共同依赖本层**，不再各写一份。
 *
 * 本层不产事件：事件一律由 repositories 复合函数在事务 commit 后发出（§2.1 边界③）。
 */
import dayjs from 'dayjs'
import { db } from '@/db/db'
import { toLinkField } from '@/modules/finance/links'
import { ledgerRepo, newId, saveTransactionWithAttachments } from '@/repositories'
import type { PutInput } from '@/repositories/repository'
import type { Transaction } from '@/db/types'

/**
 * 记账时间口径：**仅日期录入**，统一落当天 00:00（与 UI 原生 date 控件同源语义）。
 * UI（TransactionFormDrawer）与 agentOps 共用本函数，杜绝「一侧 startOf('day')、另一侧原样落库」。
 */
export function normalizeOccurredAt(date?: string): number {
  const d = date ? dayjs(date) : dayjs()
  return d.startOf('day').valueOf()
}

/**
 * 缺省账本策略（方案 §9.3 D3）：`isDefault → 唯一账本 → 反问`。
 * UI 与 AI 共用同一策略，避免「AI 说没账本要先建、UI 却默默选了第一个」这类不一致。
 */
export type DefaultLedgerResult =
  | { ok: true; ledgerId: string }
  | { ok: false; reason: string }

export async function resolveDefaultLedgerId(): Promise<DefaultLedgerResult> {
  const ledgers = (await db.ledgers.toArray()).filter((l) => !l.deleted)
  if (ledgers.length === 0) return { ok: false, reason: '请先创建账本' }
  const def = ledgers.find((l) => l.isDefault)
  if (def) return { ok: true, ledgerId: def.id }
  if (ledgers.length === 1) return { ok: true, ledgerId: ledgers[0].id }
  return {
    ok: false,
    reason: `存在多个账本且未设置默认账本（共 ${ledgers.length} 个），请指定 ledgerId 或在设置里指定默认账本`,
  }
}

/** 记账入参（UI 与 agentOps 的共同形态；附件由调用方另行传入，不进本结构） */
export interface RecordTransactionInput {
  summary: string
  amount: number
  type: 'income' | 'expense'
  /** 缺省走 resolveDefaultLedgerId（isDefault → 唯一 → 反问） */
  ledgerId?: string
  /** YYYY-MM-DD；缺省今天；一律经 normalizeOccurredAt 落当天 00:00 */
  occurredAt?: string
  /** UI 允许空渠道落库（§9.4 口径注），故可缺省 */
  channel?: string
  status?: '已结算' | '待对账'
  tags?: string[]
  note?: string
  /** 关联客户 / 待办 / 项目（Issue #140 多值）：数组口径，空数组不落键 */
  customerIds?: string[]
  todoIds?: string[]
  projectIds?: string[]
}

/** 记账产物 */
export type RecordTransactionResult =
  | { ok: true; transactionId: string; created: boolean; ledgerId: string; occurredAt: number }
  | { ok: false; error: string }

/**
 * 记一笔（无附件）—— UI「快速记一笔」与 agentOps `fin_recordTransaction` 的共同实现。
 *
 * 事件：`transaction:created` 由 `saveTransactionWithAttachments` 在事务 commit 后、
 * 仅新建时发出（§2.1 边界①/③），本层不 emit。
 */
export async function recordTransaction(
  input: RecordTransactionInput,
): Promise<RecordTransactionResult> {
  let ledgerId = input.ledgerId
  if (ledgerId) {
    // 显式指定账本必须真实存在（不静默落一条挂不上的账）
    const ledger = await db.ledgers.get(ledgerId)
    if (!ledger || ledger.deleted) return { ok: false, error: `账本不存在：${ledgerId}` }
  } else {
    const resolved = await resolveDefaultLedgerId()
    if (!resolved.ok) return { ok: false, error: resolved.reason }
    ledgerId = resolved.ledgerId
  }

  const occurredAt = normalizeOccurredAt(input.occurredAt)
  const id = newId('txn')
  const record: PutInput<Transaction> = {
    id,
    ledgerId,
    type: input.type,
    amount: input.amount,
    summary: input.summary,
    channel: input.channel ?? '',
    occurredAt,
    tags: input.tags ?? [],
    note: input.note,
    customerIds: toLinkField(input.customerIds ?? []),
    todoIds: toLinkField(input.todoIds ?? []),
    projectIds: toLinkField(input.projectIds ?? []),
    status: input.status ?? '待对账',
  }
  const { created } = await saveTransactionWithAttachments(record, [])
  return { ok: true, transactionId: id, created, ledgerId, occurredAt }
}

/** 新建账本（含「设为默认时清其它默认」的全局唯一纪律） */
export interface CreateLedgerInput {
  name: string
  currency: 'CNY' | 'USD' | 'EUR'
  openingBalance: number
  closingCycle: '月结' | '季结' | '年结' | '不封账'
  isDefault?: boolean
}

export async function createLedger(input: CreateLedgerInput): Promise<string> {
  const { clearOtherDefaultLedgers } = await import('@/repositories')
  if (input.isDefault) await clearOtherDefaultLedgers()
  const id = newId('ldg')
  const active = (await db.ledgers.toArray()).filter((l) => !l.deleted)
  await ledgerRepo.put({
    id,
    name: input.name,
    currency: input.currency,
    openingBalance: input.openingBalance,
    closingCycle: input.closingCycle,
    sortOrder: active.length,
    createdAt: Date.now(),
    ...(input.isDefault ? { isDefault: true } : {}),
  })
  return id
}

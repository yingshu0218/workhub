import type { Link } from '@/db/types'

/**
 * 交易关联（客户 / 待办 / 项目）读写的统一口径（Issue #140 多值化 → 关联层 Phase 2 links 化）
 *
 * v15 起关联不再随流水落数组字段，而是 kind='related' 的 link（from=流水）：
 * 写入侧由 repositories.syncRelatedLinks 与流水行同事务 diff 同步；读取侧统一经
 * 本模块的 **link 索引**（Map<txnId, TxnLinks>）—— 消费方散落 10+ 处，每处各写
 * 一遍查询必写漏（漏一处就是静默丢关联），收口成一份。
 *
 * 历史升级链完整保留：v11 单值→数组（db.ts v11 upgrade）→ v15 数组→link
 * （legacyLinkMigration）；服务端旧列保留供老客户端降级，pull 侧剥旧键 + 派生。
 */

/** 一笔流水的三组关联 id（由 related link 按 toType 分桶） */
export interface TxnLinks {
  customerIds: string[]
  todoIds: string[]
  projectIds: string[]
}

export function emptyTxnLinks(): TxnLinks {
  return { customerIds: [], todoIds: [], projectIds: [] }
}

const TXN_TARGET_FIELD: Record<string, keyof TxnLinks> = {
  customers: 'customerIds',
  todos: 'todoIds',
  projects: 'projectIds',
}

/** related link 行 → Map<txnId, TxnLinks>（纯函数：分组与分桶的单一实现） */
export function groupTxnLinks(rows: Link[]): Map<string, TxnLinks> {
  const m = new Map<string, TxnLinks>()
  for (const l of rows) {
    if (l.kind !== 'related' || l.fromType !== 'transactions' || l.deleted) continue
    const field = TXN_TARGET_FIELD[l.toType]
    if (!field) continue
    let entry = m.get(l.fromId)
    if (!entry) {
      entry = emptyTxnLinks()
      m.set(l.fromId, entry)
    }
    entry[field].push(l.toId)
  }
  return m
}

// ⚠️ 本文件保持**零 db 依赖**（agent 层经 reads/executor 消费，boundary 锁禁止其
// 间接引入 db 单例）。需要查库的 loader 在消费方就地 `db.links.where('kind')
// .equals('related')` 后喂给 groupTxnLinks（React 组件用 finance/hooks#useTxnLinkIndex）。

/** 从索引取某笔流水的关联（缺省空集） */
export function txnLinksOf(index: ReadonlyMap<string, TxnLinks>, txnId: string): TxnLinks {
  return index.get(txnId) ?? emptyTxnLinks()
}

/**
 * 写入前数据纪律：去重 + 过滤已删（或不存在）实体 id。
 * 弱引用语义 —— 解绑不报错，直接丢弃失效 id，避免把悬挂引用写进库。
 * （消费方：TransactionFormDrawer 保存前过滤选择集；syncRelatedLinks 仍会二次校验）
 */
export function pruneTxnLinkIds(ids: string[], alive: Set<string>): string[] {
  return [...new Set(ids)].filter((id) => alive.has(id))
}

/** 已删实体 id 集合（供表单保存前过滤） */
export function aliveIdSet<T extends { id: string }>(rows: T[]): Set<string> {
  return new Set(rows.map((r) => r.id))
}

/**
 * 财务凭证详情深链：`/finance?focus=<txnId>`（Issue #147）
 *
 * FinancePage 消费 focus 参数后直接打开对应流水的凭证详情抽屉。此前该深链
 * 在客户时间线骨刺、⌘K 搜索、客户详情资金表三处各写一遍 `encodeURIComponent`，
 * 本次收口到一处，并补齐「项目流水 / 待对账 / 时间轴关联记账」等仍不可点的列表行。
 */
export function financeFocusPath(txnId: string): string {
  return `/finance?focus=${encodeURIComponent(txnId)}`
}

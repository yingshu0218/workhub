import { storage } from '@/storage'
import type { TableName } from '@/storage/types'

/**
 * `sortOrder` 排序语义单点收口（审计 P2 · C-8 + C-9 · 2026-10-21）
 *
 * ## 为什么要有这个文件
 *
 * `sortOrder` 这套「列表/分组/账本拖拽排序」在三个模块各写了一遍 `reorder*`
 * （`todoLists` / `ledgers` / `customerGroups`），**结构逐行相同、只差表名**；
 * 更要命的是「新建时的尾值口径」三处不一：
 *
 * - `todo/hooks.ts` 用 `max(sortOrder) + 1`（正确）
 * - `crm/hooks.ts` / `finance/hooks.ts` 用 `alive.length`（**会重号**）
 *
 * 重号是可复现的真缺陷：3 条列表（sortOrder 0,1,2）→ 删中间那条 → alive 剩 2 条
 * → 新建得 `sortOrder = 2`，**与已存在的第 3 条重号** → 排序不稳定（同值下顺序取决于
 * 底层返回顺序），表现为「拖完顺序会自己跳回去」。
 *
 * 把两者都收口到本文件：口径一处定义、拖拽实现一处实现，杜绝再漂移。
 */

/** 带 sortOrder 的列表行最小形状（todoLists / ledgers / customerGroups 共用） */
type SortOrderRow = {
  id: string
  sortOrder: number
  rev: number
  deleted?: 0 | 1
}

/**
 * 新建记录时的 `sortOrder` 尾值：**作用域内最大 sortOrder + 1**（不是「存活条数」）。
 *
 * ⚠️ 必须用 max 而非 length：length 在**删除后**会退回到已用过的值 → 重号（见文件头说明）。
 * 空表（或作用域内无存活记录）时返回 0。
 *
 * @param table 目标表
 * @param inScope 作用域谓词：用于「同一父实体内的排序」（如某项目的里程碑）。
 *                缺省 = 全表（清单/账本/客户分组都是全局排序，不传）。
 *                ⚠️ 必须传谓词而不能退化成「全表 max」—— 否则里程碑会拿到别的项目的尾值。
 */
export async function nextSortOrder(
  table: TableName,
  inScope?: (row: SortOrderRow & Record<string, unknown>) => boolean,
): Promise<number> {
  const all = await storage.list<SortOrderRow & Record<string, unknown>>(table)
  const scoped = inScope ? all.filter(inScope) : all
  return scoped.filter((r) => !r.deleted).reduce((max, r) => Math.max(max, r.sortOrder ?? -1), -1) + 1
}

/**
 * 拖拽排序：按传入的 id 顺序重写 `sortOrder`（同事务改记录 + 入同步队列）。
 *
 * ⚠️ 改记录与入队**必须同事务** —— 否则本地顺序变了但推不上服务端，换设备就回到旧顺序
 * （本项目最容易踩的同步坑）。
 * ⚠️ 只动**位置真正变化**的行（`sortOrder === i` 时跳过）：避免拖拽后整表 rev+1，
 * 那会让所有行都进同步队列、并推高各端 LWW 判据。
 *
 * @param orderedIds 目标顺序的完整 id 序列（来自 UI 的拖拽结果）
 */
export async function reorderBySortOrder(
  table: TableName,
  orderedIds: readonly string[],
): Promise<void> {
  const now = Date.now()
  await storage.transaction([table, 'syncQueue'], async (tx) => {
    const all = await tx.list<SortOrderRow>(table)
    for (let i = 0; i < orderedIds.length; i++) {
      const row = all.find((x) => x.id === orderedIds[i])
      // 不存在的 id（已被别处删掉）与已软删的行都跳过：不为幽灵记录写队列
      if (!row || row.deleted || row.sortOrder === i) continue
      await tx.put(table, { ...row, sortOrder: i, updatedAt: now, rev: row.rev + 1 })
      await tx.enqueue(table, row.id, 'upsert', now)
    }
  })
  storage.requestSync()
}
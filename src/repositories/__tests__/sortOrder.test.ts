/**
 * `sortOrder` 口径回归锁（审计 P2 · C-9 · 2026-10-21）
 *
 * ## 锁的是什么
 *
 * 新建记录的 `sortOrder` 尾值，三个模块此前**口径不一**：
 * - `todo/hooks.ts` 用 `max(sortOrder) + 1`（正确）
 * - `crm/hooks.ts` / `finance/hooks.ts` 用 `alive.length`（**删除后会重号**）
 *
 * 重号是真缺陷：3 条（sortOrder 0,1,2）→ 删中间 → alive 剩 2 → 新建得 2，
 * **与已存在的第 3 条重号** → 同值下顺序取决于底层返回顺序，表现为「拖完顺序自己跳回去」。
 *
 * 现在三处都收口到 `repositories/sortOrder.ts#nextSortOrder`（max+1）。
 * 本文件同时锁**行为**（删中间后再新建不重号）与**源码**（模块层不得再自行算尾值）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { createTodoList, deleteTodoListCascade, reorderTodoLists } from '@/modules/todo/hooks'
import { createCustomerGroup, deleteCustomerGroup } from '@/modules/crm/hooks'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('C-9 行为锁：删除后再新建不得与存活记录重号', () => {
  it('待办清单：3 条 → 删中间 → 新建，sortOrder 不与存活项重复', async () => {
    const a = await createTodoList('A')
    const b = await createTodoList('B')
    const c = await createTodoList('C')
    expect([a.sortOrder, b.sortOrder, c.sortOrder]).toEqual([0, 1, 2])

    await deleteTodoListCascade(b.id) // 剩 A(0) / C(2)
    const d = await createTodoList('D')

    const alive = (await db.todoLists.toArray()).filter((l) => !l.deleted)
    const orders = alive.map((l) => l.sortOrder)
    // 核心断言：不重号（旧实现会给 D 分配 2，与 C 撞车）
    expect(new Set(orders).size).toBe(orders.length)
    expect(d.sortOrder).toBe(3) // max(0,2)+1
  })

  it('客户分组：同样不重号（旧实现用 length 会撞车）', async () => {
    const a = await createCustomerGroup({ name: 'A', includeTags: [], excludeTags: [] })
    const b = await createCustomerGroup({ name: 'B', includeTags: [], excludeTags: [] })
    const c = await createCustomerGroup({ name: 'C', includeTags: [], excludeTags: [] })
    expect([a.sortOrder, b.sortOrder, c.sortOrder]).toEqual([0, 1, 2])

    await deleteCustomerGroup(b.id)
    const d = await createCustomerGroup({ name: 'D', includeTags: [], excludeTags: [] })

    const alive = (await db.customerGroups.toArray()).filter((g) => !g.deleted)
    const orders = alive.map((g) => g.sortOrder)
    expect(new Set(orders).size).toBe(orders.length)
    expect(d.sortOrder).toBe(3)
  })
})

describe('C-8 收口锁：拖拽排序走同一实现', () => {
  it('拖拽后 sortOrder 等于目标索引，且入同步队列', async () => {
    const a = await createTodoList('A')
    const b = await createTodoList('B')
    await reorderTodoLists([b.id, a.id])
    expect((await db.todoLists.get(b.id))!.sortOrder).toBe(0)
    expect((await db.todoLists.get(a.id))!.sortOrder).toBe(1)
    expect((await db.syncQueue.count()).valueOf()).toBeGreaterThan(0)
  })

  it('位置未变动的行不重复盖章入队（避免整表 rev+1 推高 LWW）', async () => {
    const a = await createTodoList('A')
    const b = await createTodoList('B')
    await db.syncQueue.clear()
    const revB = (await db.todoLists.get(b.id))!.rev
    await reorderTodoLists([a.id, b.id]) // 顺序本来就是这样
    expect((await db.syncQueue.count())).toBe(0) // 无变化 → 不入队
    expect((await db.todoLists.get(b.id))!.rev).toBe(revB)
  })
})

describe('C-8 源码锁：模块层不得自行计算 sortOrder 尾值 / 自行实现 reorder', () => {
  /**
   * 判据：模块层出现 `alive.length` / `filter(...).length` 作为 sortOrder 尾值，
   * 或自行 `tx.put(table, { ...row, sortOrder: i ... })` 实现拖拽 —— 都视为漂移。
   * 允许的写法是调用 `nextSortOrder(...)` / `reorderBySortOrder(...)`。
   */
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const p = path.join(dir, e)
      if (statSync(p).isDirectory()) return e === '__tests__' ? [] : walk(p)
      return /\.tsx?$/.test(p) ? [p] : []
    })
  }

  it('模块层不再用「存活条数」当 sortOrder 尾值', () => {
    const offenders: string[] = []
    for (const file of walk(path.resolve(process.cwd(), 'src/modules'))) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/sortOrder:\s*[^\n]*\.length/g)) {
        offenders.push(`${path.relative(process.cwd(), file)} → ${m[0].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('模块层不再自行实现 sortOrder 重写（应调用 reorderBySortOrder）', () => {
    const offenders: string[] = []
    for (const file of walk(path.resolve(process.cwd(), 'src/modules'))) {
      const src = readFileSync(file, 'utf8')
      // 自行改 sortOrder 的形态：put 里出现 `sortOrder: i`（拖拽循环特征）
      if (/sortOrder:\s*i\s*,/.test(src)) {
        offenders.push(path.relative(process.cwd(), file))
      }
    }
    expect(offenders).toEqual([])
  })
})
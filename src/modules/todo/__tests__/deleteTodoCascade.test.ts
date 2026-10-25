/**
 * 待办删除级联回归（Issue #148 后续 · #140 审计留档项收口）
 *
 * 背景：`transactions.todoIds` 是弱引用数组，此前删除待办**不解绑**，
 * 悬挂 id 全靠读取端 `links.ts` 的 `pruneTxnLinkIds` / 存活实体过滤兜底 ——
 * 界面不炸，但任何「按 todoIds 直查」的路径（导出、统计、Agent 读投影）会命中幽灵引用。
 *
 * 本测试锁三条：
 *   ① UI 与 Agent 两条删除入口**共用同一实现**（模块级 `deleteTodoCascade`）；
 *   ② 解绑只动被删的那一条关联，其余关联保留、空数组不落键；
 *   ③ 解绑条数如实回传（Agent 需向用户转述 `sideEffects.unlinked`）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { deleteTodoCascade } from '../hooks'
import { dispatchAgentTool } from '@/agent/executor'

const txnBase = {
  ledgerId: 'l1',
  type: 'expense' as const,
  amount: 100,
  summary: '晚饭',
  channel: '微信',
  occurredAt: 1,
  tags: [],
  status: '已结算' as const,
  createdAt: 1,
  updatedAt: 1,
  deleted: 0 as const,
  rev: 1,
}

const todoBase = {
  desc: '',
  priority: 'mid' as const,
  status: 'todo' as const,
  createdAt: 1,
  updatedAt: 1,
  deleted: 0 as const,
  rev: 1,
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('deleteTodoCascade（UI 与 Agent 同源）', () => {
  it('软删待办的同时墓碑化指向它的 related link，返回解绑条数', async () => {
    await db.todos.put({ id: 'td:1', title: '出方案', ...todoBase } as never)
    await db.transactions.put({ id: 'tx:1', ...txnBase } as never)
    const { buildLinkId } = await import('@/repositories/linkId')
    const linkId = buildLinkId(
      { type: 'transactions', id: 'tx:1' },
      { type: 'todos', id: 'td:1' },
      'related',
    )
    await db.links.put({
      id: linkId,
      fromType: 'transactions',
      fromId: 'tx:1',
      toType: 'todos',
      toId: 'td:1',
      kind: 'related',
      createdAt: 1,
      updatedAt: 0,
      rev: 0,
      deleted: 0,
    } as never)

    expect(await deleteTodoCascade('td:1')).toBe(1)
    expect((await db.todos.get('td:1'))!.deleted).toBe(1)
    // v15 起解绑 = related link 墓碑化（恢复时随待办复活），流水行本身不动
    expect((await db.links.get(linkId))!.deleted).toBe(1)
  })

  it('多关联一笔款：只墓碑化被删待办的那条 link，其余关联保留', async () => {
    await db.todos.put({ id: 'td:1', title: 'A', ...todoBase } as never)
    await db.transactions.put({ id: 'tx:1', ...txnBase } as never)
    const { buildLinkId } = await import('@/repositories/linkId')
    const keepId = buildLinkId(
      { type: 'transactions', id: 'tx:1' },
      { type: 'todos', id: 'td:keep' },
      'related',
    )
    const dropId = buildLinkId(
      { type: 'transactions', id: 'tx:1' },
      { type: 'todos', id: 'td:1' },
      'related',
    )
    for (const l of [keepId, dropId]) {
      await db.links.put({
        id: l,
        fromType: 'transactions',
        fromId: 'tx:1',
        toType: 'todos',
        toId: l === keepId ? 'td:keep' : 'td:1',
        kind: 'related',
        createdAt: 1,
        updatedAt: 0,
        rev: 0,
        deleted: 0,
      } as never)
    }
    await deleteTodoCascade('td:1')
    expect((await db.links.get(dropId))!.deleted).toBe(1)
    expect((await db.links.get(keepId))!.deleted).toBe(0)
  })

  it('未关联流水的待办：解绑 0 条、待办正常软删', async () => {
    await db.todos.put({ id: 'td:2', title: 'B', ...todoBase } as never)
    expect(await deleteTodoCascade('td:2')).toBe(0)
    expect((await db.todos.get('td:2'))!.deleted).toBe(1)
  })

  it('幂等：对已删待办重复调用不再改动、不再解绑', async () => {
    await db.todos.put({ id: 'td:3', title: 'C', ...todoBase } as never)
    await db.transactions.put({ id: 'tx:3', ...txnBase } as never)
    const { buildLinkId } = await import('@/repositories/linkId')
    const linkId = buildLinkId(
      { type: 'transactions', id: 'tx:3' },
      { type: 'todos', id: 'td:3' },
      'related',
    )
    await db.links.put({
      id: linkId,
      fromType: 'transactions',
      fromId: 'tx:3',
      toType: 'todos',
      toId: 'td:3',
      kind: 'related',
      createdAt: 1,
      updatedAt: 0,
      rev: 0,
      deleted: 0,
    } as never)
    expect(await deleteTodoCascade('td:3')).toBe(1)
    const txnRev = (await db.transactions.get('tx:3'))!.rev
    expect(await deleteTodoCascade('td:3')).toBe(0)
    expect((await db.transactions.get('tx:3'))!.rev).toBe(txnRev)
  })

  it('Agent todo_deleteTodo 走同一实现：sideEffects.unlinked 如实回传', async () => {
    await db.todos.put({ id: 'td:4', title: 'D', ...todoBase } as never)
    await db.transactions.put({ id: 'tx:4', ...txnBase } as never)
    const { buildLinkId } = await import('@/repositories/linkId')
    const linkId = buildLinkId(
      { type: 'transactions', id: 'tx:4' },
      { type: 'todos', id: 'td:4' },
      'related',
    )
    await db.links.put({
      id: linkId,
      fromType: 'transactions',
      fromId: 'tx:4',
      toType: 'todos',
      toId: 'td:4',
      kind: 'related',
      createdAt: 1,
      updatedAt: 0,
      rev: 0,
      deleted: 0,
    } as never)
    const r = await dispatchAgentTool('todo_deleteTodo', { todoId: 'td:4' })
    expect(r.ok).toBe(true)
    expect((r.data as { sideEffects: { unlinked: number } }).sideEffects.unlinked).toBe(1)
    expect((await db.todos.get('td:4'))!.deleted).toBe(1)
    expect((await db.links.get(linkId))!.deleted).toBe(1)
  })
})

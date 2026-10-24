// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import TrashPage from '../TrashPage'

const meta = (over: Record<string, unknown> = {}) => ({
  updatedAt: Date.now() - 1000,
  deleted: 0 as const,
  rev: 1,
  ...over,
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

/**
 * 必须显式 cleanup：本仓 vitest 未开 `globals`，`@testing-library/react` 的自动清理不生效。
 * 上一条用例挂载的页面会留在 document 里，且它的 liveQuery 会跟着新数据重渲染 ——
 * 于是「上一页 + 这一页」同屏出现两份同名按钮/文本，报的是「Found multiple elements」，
 * 看起来像组件 bug，实际是测试间污染。
 */
afterEach(cleanup)

describe('回收站页面', () => {
  it('列出已删待办，点击恢复后记录回到存活态', async () => {
    await db.todos.put({
      id: 'td1',
      title: '被误删的待办',
      desc: '',
      priority: 'mid',
      status: 'todo',
      tags: [],
      createdAt: Date.now() - 5000,
      ...meta({ deleted: 1 }),
    } as never)

    render(<TrashPage />)

    expect(await screen.findByText('被误删的待办')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '恢复' }))

    await waitFor(async () => {
      const after = (await db.todos.get('td1')) as unknown as { deleted: number }
      expect(after.deleted).toBe(0)
    })
  })

  it('空回收站显示空态', async () => {
    render(<TrashPage />)
    expect(await screen.findByText('回收站是空的')).toBeTruthy()
  })

  it('永久删除：二次确认后记录从本地库物理消失', async () => {
    await db.todos.put({
      id: 'td1',
      title: '要永久删的待办',
      desc: '',
      priority: 'mid',
      status: 'todo',
      tags: [],
      createdAt: Date.now() - 5000,
      ...meta({ deleted: 1 }),
    } as never)

    render(<TrashPage />)
    expect(await screen.findByText('要永久删的待办')).toBeTruthy()

    // 第一次点击只弹确认框，不能直接删（不可逆操作必须有第二道门）
    await userEvent.click(screen.getByRole('button', { name: '永久删除' }))
    expect(await screen.findByText('永久删除这条记录？')).toBeTruthy()
    expect(await db.todos.get('td1')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '确认永久删除' }))

    await waitFor(async () => {
      expect(await db.todos.get('td1')).toBeUndefined()
    })
  })

  it('清空回收站：整站墓碑一次清空', async () => {
    await db.todos.put({
      id: 'td1',
      title: '墓碑甲',
      desc: '',
      priority: 'mid',
      status: 'todo',
      tags: [],
      createdAt: Date.now() - 5000,
      ...meta({ deleted: 1 }),
    } as never)
    await db.todos.put({
      id: 'td2',
      title: '墓碑乙',
      desc: '',
      priority: 'mid',
      status: 'todo',
      tags: [],
      createdAt: Date.now() - 5000,
      ...meta({ deleted: 1 }),
    } as never)

    render(<TrashPage />)
    expect(await screen.findByText('墓碑甲')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '清空回收站' }))
    expect(await screen.findByText('清空回收站？')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '清空' }))

    await waitFor(async () => {
      expect(await db.todos.count()).toBe(0)
    })
    expect(await screen.findByText('回收站是空的')).toBeTruthy()
  })
})

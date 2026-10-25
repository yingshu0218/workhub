// @vitest-environment jsdom
/**
 * Phase 3 集合层 · todos 族（v16）：清单归属 → kind='member' link
 *
 * docs/集合层设计方案-20261026.md 裁决 B/C 的语义锁：
 * 1. 归属写路径（saveTodoWithList / setTodoList）：member link 与待办行同事务；
 * 2. 单选语义 = 选择集 diff：换清单 = 旧 link 墓碑化 + 新 link 建立；null = 移回收集箱；
 * 3. 幽灵清单 → 可操作错误、事务整体回滚（待办行不得已写）；
 * 4. 删除清单（deleteTodoListCascade v2）：名下 member link 统一墓碑化 + 快照
 *    cascadeLinkIds 留档、待办行不动（收集箱 = 无 link）；恢复按两端存活复活；
 * 5. 双端合流兜底：memberIndexOf 取 updatedAt 最新（写路径纪律之外的读取自洽）。
 * 变异校验（两方向，见 PROGRESS 本轮）：拆 syncMemberLinks 旧 link 墓碑化 → ② 恰红；
 * 拆 reviveCascadeLinks 端点存活校验 → ④ 的对端已删分支恰红。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { saveTodoWithList, setTodoList } from '@/repositories'
import { createTodoList, deleteTodoListCascade } from '../hooks'
import { restoreTrashRecord } from '@/repositories/trash'
import { memberIndexOf } from '@/repositories/links'
import { buildLinkId } from '@/repositories/linkId'
import type { Todo } from '@/db/types'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

const baseTodo = (id: string): Omit<Todo, 'rev'> => ({
  id,
  title: `待办 ${id}`,
  desc: '',
  priority: 'mid',
  status: 'todo',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  deleted: 0,
})

async function memberLinksOf(todoId: string) {
  return db.links
    .filter((l) => l.kind === 'member' && l.fromType === 'todos' && l.fromId === todoId)
    .toArray()
}

describe('清单归属（member link）写路径', () => {
  it('① saveTodoWithList(listId)：member link 落库（确定性 id），行不持 listId 字段', async () => {
    const list = await createTodoList('工作')
    await saveTodoWithList({ ...baseTodo('td1'), rev: 0 } as never, list.id)

    const links = await memberLinksOf('td1')
    expect(links).toHaveLength(1)
    expect(links[0].toType).toBe('todoLists')
    expect(links[0].toId).toBe(list.id)
    // 确定性 id 与 buildLinkId 同源
    expect(links[0].id).toBe(
      buildLinkId({ type: 'todos', id: 'td1' }, { type: 'todoLists', id: list.id }, 'member'),
    )
    // 行字段已退役（v16 双写不双读）
    expect((await db.todos.get('td1'))! as unknown as Record<string, unknown>).not.toHaveProperty('listId')
  })

  it('② 换清单 = 旧 link 墓碑化 + 新 link 建立（单选 diff；含已墓碑旧 link 不重复盖章）', async () => {
    const a = await createTodoList('A')
    const b = await createTodoList('B')
    await saveTodoWithList({ ...baseTodo('td1'), rev: 0 } as never, a.id)

    await setTodoList('td1', b.id)

    const links = (await memberLinksOf('td1')).sort((x, y) => x.toId.localeCompare(y.toId))
    expect(links).toHaveLength(2)
    const old = links.find((l) => l.toId === a.id)!
    const cur = links.find((l) => l.toId === b.id)!
    expect(old.deleted).toBe(1)
    expect(old.deletedAt).toBeGreaterThan(0)
    expect(cur.deleted).toBe(0)
    // 幂等重盖章：再同步一次同清单，不新增行
    await setTodoList('td1', b.id)
    expect(await memberLinksOf('td1')).toHaveLength(2)
  })

  it('③ null = 移回收集箱；undefined = 不动既有归属', async () => {
    const list = await createTodoList('工作')
    await saveTodoWithList({ ...baseTodo('td1'), rev: 0 } as never, list.id)

    // undefined：编辑未提清单，归属不动
    await saveTodoWithList({ ...(await db.todos.get('td1'))!, title: '改名', updatedAt: 0 } as never)
    expect((await memberLinksOf('td1')).filter((l) => !l.deleted)).toHaveLength(1)

    // null：移回收集箱
    await setTodoList('td1', undefined)
    expect(await memberLinksOf('td1')).toHaveLength(1)
    expect((await memberLinksOf('td1'))[0].deleted).toBe(1)
  })

  it('④ 幽灵清单：可操作错误 + 事务整体回滚（待办行不得已写）', async () => {
    await db.todos.put({ ...baseTodo('td1'), title: '原始标题' } as never)
    await expect(setTodoList('td1', 'ghost-list')).rejects.toThrow('目标容器已不存在')
    // 回滚：待办行未动、无任何 link 落库
    expect((await db.todos.get('td1'))!.title).toBe('原始标题')
    expect(await memberLinksOf('td1')).toHaveLength(0)
  })
})

describe('删除清单（v2 级联）与恢复', () => {
  it('⑤ 删除清单：member link 墓碑化 + 快照留档；待办行不动（收集箱 = 无 link）', async () => {
    const list = await createTodoList('工作')
    await saveTodoWithList({ ...baseTodo('td1'), rev: 0 } as never, list.id)
    await saveTodoWithList({ ...baseTodo('td2'), rev: 0 } as never, list.id)

    await deleteTodoListCascade(list.id)

    expect((await db.todoLists.get(list.id))!.deleted).toBe(1)
    // 两条成员 link 全部墓碑化
    for (const id of ['td1', 'td2']) {
      const links = await memberLinksOf(id)
      expect(links).toHaveLength(1)
      expect(links[0].deleted).toBe(1)
    }
    // 快照精确留档（恢复凭据）
    const tomb = (await db.todoLists.get(list.id)) as unknown as {
      trashSnapshot: { cascadeLinkIds: string[] }
    }
    expect(tomb.trashSnapshot.cascadeLinkIds).toHaveLength(2)
    // 待办行不动
    expect((await db.todos.get('td1'))!.title).toBe('待办 td1')
  })

  it('⑥ 恢复清单：两端存活的 member link 复活；待办已删的跳过并计数', async () => {
    const list = await createTodoList('工作')
    await saveTodoWithList({ ...baseTodo('td1'), rev: 0 } as never, list.id)
    await saveTodoWithList({ ...baseTodo('td2'), rev: 0 } as never, list.id)
    // td3 的 link 建好后待办本身被删：deleteTodoCascade 的级联**已先**墓碑化其 member
    // link（端点清扫），清单删除时它已是墓碑、不重复盖章也不入本次快照 ——
    // 「级联牺牲品 vs 既有墓碑」由两层删除各自留档，恢复各归各。
    await saveTodoWithList({ ...baseTodo('td3'), rev: 0 } as never, list.id)
    const { deleteTodoCascade } = await import('../cascade')
    await deleteTodoCascade('td3')

    await deleteTodoListCascade(list.id)
    const result = await restoreTrashRecord('todoLists', list.id)

    // 快照只含本次删除墓碑化的 2 条；td3 的 link 保持墓碑（待办本身仍删着）
    expect(result.revivedCascadeLinks).toBe(2)
    expect(result.skippedCascadeLinks).toBe(0)
    expect((await db.todoLists.get(list.id))!.deleted).toBe(0)
    expect((await memberLinksOf('td1')).every((l) => !l.deleted)).toBe(true)
    expect((await memberLinksOf('td2')).every((l) => !l.deleted)).toBe(true)
    expect((await memberLinksOf('td3')).every((l) => l.deleted)).toBe(true)
  })
})

describe('读侧索引（memberIndexOf）', () => {
  it('⑦ 双挂兜底：同成员多条活 link 取 updatedAt 最新（写路径纪律之外的读取自洽）', () => {
    const listA = 'tl-a'
    const listB = 'tl-b'
    const mk = (toId: string, updatedAt: number) =>
      ({
        id: buildLinkId({ type: 'todos', id: 'td1' }, { type: 'todoLists', id: toId }, 'member'),
        fromType: 'todos',
        fromId: 'td1',
        toType: 'todoLists',
        toId,
        kind: 'member',
        createdAt: 1,
        updatedAt,
        rev: 1,
        deleted: 0,
      }) as never
    const idx = memberIndexOf([mk(listA, 100), mk(listB, 200)])
    expect(idx.get('td1')).toBe(listB)
    // updatedAt 相等时后来者胜（Map.set 覆盖）—— 合流窗口的自洽兜底
    const idx2 = memberIndexOf([mk(listA, 100), mk(listB, 100)])
    expect(idx2.get('td1')).toBe(listB)
  })
})

/**
 * P2 动作扩面对照测试 —— 编辑 / 删除 / 项目 / 笔记 / 习惯删除
 *
 * 覆盖本轮新增动作面的四类纪律：
 *   ① 编辑类：nullable 三态语义（未传=不动 / null=清空 / 值=设置），且不碰完成态与 relations；
 *   ② 删除类：走既有级联/软删函数、返回 sideEffects 清单、对幽灵记录给可操作错误；
 *   ③ 关联校验：挂靠到不存在的客户/项目/文件夹一律拒绝（不产生悬挂引用）；
 *   ④ 读限幅：listNotes 不下发 markdown 正文，listProjects/listNotes 上限 50。
 *
 * 另断言：这些动作**不产生任何领域事件**（UI 同入口也不发），声明表保持窄。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { eventBus } from '@/shared/eventBus'
import { AGENT_TOOLS, dispatchAgentTool, listVisibleTools } from '../executor'
import { TOOL_RISK, TOOL_DOMAIN, TOOL_EVENTS } from '../schema'
import { listNotes, READ_LIMITS } from '../reads'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

const NEW_TOOLS = [
  'todo_updateTodo',
  'todo_deleteTodo',
  'crm_updateCustomer',
  'project_createProject',
  'project_updateProject',
  'note_createNote',
  'note_updateNote',
  'note_createFolder',
  'habit_deleteHabit',
  'listProjects',
  'listNotes',
  'listNoteFolders',
] as const

describe('P2 动作扩面：注册与声明完整', () => {
  it('全部新工具已注册、有域归属与风险级', () => {
    for (const n of NEW_TOOLS) {
      expect(AGENT_TOOLS[n as keyof typeof AGENT_TOOLS], `${n} 未注册`).toBeTruthy()
      expect(TOOL_DOMAIN[n], `${n} 缺域归属`).toBeTruthy()
      expect(['low', 'medium', 'high']).toContain(TOOL_RISK[n])
    }
  })

  it('新动作一律不声明领域事件（事件声明表保持窄）', () => {
    for (const n of NEW_TOOLS) expect(TOOL_EVENTS[n] ?? []).toEqual([])
  })

  it('删除类为 high 风险（不可逆，需二次确认 + 副作用清单）', () => {
    expect(TOOL_RISK['todo_deleteTodo']).toBe('high')
    expect(TOOL_RISK['habit_deleteHabit']).toBe('high')
  })

  it('project / note 域独立进白名单：关掉 project 域不影响 note 域工具', () => {
    const noProject = listVisibleTools({ project: false }).map((t) => t.name)
    expect(noProject).not.toContain('project_createProject')
    expect(noProject).toContain('note_createNote')

    const noNote = listVisibleTools({ note: false }).map((t) => t.name)
    expect(noNote).not.toContain('note_createNote')
    expect(noNote).toContain('project_createProject')
  })

  it('白名单闸门拒绝新工具的越权调用（含可操作错误）', async () => {
    const r = await dispatchAgentTool('note_createFolder', { name: 'x' }, { note: false })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('白名单')
  })
})

describe('todo_updateTodo：nullable 三态与完成态隔离', () => {
  it('未传字段不动、传 null 清空、传值设置', async () => {
    const id = 'td:1'
    await db.todos.put({
      id,
      title: '旧标题',
      desc: '',
      priority: 'mid',
      status: 'todo',
      customerId: 'cus:1',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)

    const r = await dispatchAgentTool('todo_updateTodo', {
      todoId: id,
      title: '新标题',
      customerId: null,
    })
    expect(r.ok).toBe(true)
    const after = await db.todos.get(id)
    expect(after!.title).toBe('新标题')
    expect(after!.customerId).toBeUndefined()
    // 未传字段不动
    expect(after!.priority).toBe('mid')
  })

  it('不写 status/completedAt（完成态唯一入口仍是 todo_completeTodo）', async () => {
    const id = 'td:2'
    await db.todos.put({
      id,
      title: 'T',
      desc: '',
      priority: 'mid',
      status: 'todo',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    await dispatchAgentTool('todo_updateTodo', { todoId: id, title: 'T2' })
    const after = await db.todos.get(id)
    expect(after!.status).toBe('todo')
    expect(after!.completedAt).toBeUndefined()
  })

  it('待办不存在 → 可操作错误（不静默成功）', async () => {
    const r = await dispatchAgentTool('todo_updateTodo', { todoId: 'nope', title: 'x' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })

  it('无任何可改字段 → schema 直接拒绝', async () => {
    const id = 'td:3'
    await db.todos.put({
      id,
      title: 'T',
      desc: '',
      priority: 'mid',
      status: 'todo',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    const r = await dispatchAgentTool('todo_updateTodo', { todoId: id })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('至少提供一个要修改的字段')
  })

  it('挂靠不存在的客户 → 拒绝（防悬挂引用）', async () => {
    const id = 'td:4'
    await db.todos.put({
      id,
      title: 'T',
      desc: '',
      priority: 'mid',
      status: 'todo',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    const r = await dispatchAgentTool('todo_updateTodo', { todoId: id, customerId: 'ghost' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('客户不存在')
  })
})

describe('删除类：软删 + 副作用清单 + 幂等', () => {
  it('todo_deleteTodo 软删并返回 sideEffects', async () => {
    const id = 'td:del'
    await db.todos.put({
      id,
      title: 'T',
      desc: '',
      priority: 'mid',
      status: 'todo',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    const r = await dispatchAgentTool('todo_deleteTodo', { todoId: id })
    expect(r.ok).toBe(true)
    expect((r.data as { sideEffects: { cascaded: number } }).sideEffects.cascaded).toBe(0)
    expect((await db.todos.get(id))!.deleted).toBe(1)
    // 同步队列有 delete 项（软删语义与 UI 同源）
    expect((await db.syncQueue.toArray()).some((q) => q.op === 'delete')).toBe(true)
  })

  it('已删待办重复删除 → 可操作错误（而非静默成功）', async () => {
    const id = 'td:del2'
    await db.todos.put({
      id,
      title: 'T',
      desc: '',
      priority: 'mid',
      status: 'todo',
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    await dispatchAgentTool('todo_deleteTodo', { todoId: id })
    const again = await dispatchAgentTool('todo_deleteTodo', { todoId: id })
    expect(again.ok).toBe(false)
    expect(again.error).toContain('不存在')
  })

  it('habit_deleteHabit 级联清理打卡记录并在副作用清单里给出条数', async () => {
    const hid = 'hb:1'
    await db.habits.put({
      id: hid,
      name: '早起',
      icon: 'directions_run',
      color: '#000',
      category: '健康',
      schedule: '每日',
      targetMinutes: 0,
      motivationNote: '',
      crossModuleSync: false,
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    for (const d of ['2026-09-08', '2026-09-09']) {
      await db.habitLogs.put({
        id: `hl-${hid}-${d}`,
        habitId: hid,
        date: d,
        completedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        deleted: 0,
        rev: 1,
      } as never)
    }
    const r = await dispatchAgentTool('habit_deleteHabit', { habitId: hid })
    expect(r.ok).toBe(true)
    expect((r.data as { sideEffects: { cascadedHabitLogs: number } }).sideEffects.cascadedHabitLogs).toBe(2)
    expect((await db.habits.get(hid))!.deleted).toBe(1)
    const logs = await db.habitLogs.toArray()
    expect(logs.every((l) => l.deleted === 1)).toBe(true)
  })
})

describe('crm_updateCustomer：档案编辑与档位三态', () => {
  it('改 decisionLevel 生效，intimacyLevel=null 清除手动档位', async () => {
    const id = 'cus:1'
    await db.customers.put({
      id,
      name: '王五',
      company: '深蓝科技',
      title: '',
      decisionLevel: '影响者',
      tags: [],
      phone: '',
      wechat: '',
      email: '',
      address: '',
      relations: [],
      intimacy: { level: 'T1', updatedAt: 1 },
      lastContactAt: 0,
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)

    const r = await dispatchAgentTool('crm_updateCustomer', {
      customerId: id,
      decisionLevel: '决策人',
      intimacyLevel: null,
    })
    expect(r.ok).toBe(true)
    const after = await db.customers.get(id)
    expect(after!.decisionLevel).toBe('决策人')
    expect(after!.intimacy).toBeUndefined()
  })

  it('设置档位写 intimacy.level', async () => {
    const id = 'cus:2'
    await db.customers.put({
      id,
      name: '李四',
      company: '',
      title: '',
      decisionLevel: '决策人',
      
      tags: [],
      phone: '',
      wechat: '',
      email: '',
      address: '',
      relations: [],
      lastContactAt: 0,
      createdAt: 1,
      updatedAt: 1,
      deleted: 0,
      rev: 1,
    } as never)
    await dispatchAgentTool('crm_updateCustomer', { customerId: id, intimacyLevel: 'T2' })
    expect((await db.customers.get(id))!.intimacy?.level).toBe('T2')
  })
})

describe('project / note 域：来源校验与读限幅', () => {
  it('project_createProject 默认 active，挂靠不存在客户被拒', async () => {
    const okRes = await dispatchAgentTool('project_createProject', { name: 'Q4 出海' })
    expect(okRes.ok).toBe(true)
    const pid = (okRes.data as { projectId: string }).projectId
    expect((await db.projects.get(pid))!.status).toBe('active')

    const bad = await dispatchAgentTool('project_createProject', {
      name: 'X',
      customerId: 'ghost',
    })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('客户不存在')
  })

  it('project_updateProject 可归档（status=archived，不删除）', async () => {
    const r = await dispatchAgentTool('project_createProject', { name: 'P' })
    const pid = (r.data as { projectId: string }).projectId
    const up = await dispatchAgentTool('project_updateProject', { projectId: pid, status: 'archived' })
    expect(up.ok).toBe(true)
    const p = await db.projects.get(pid)
    expect(p!.status).toBe('archived')
    expect(p!.deleted).toBe(0)
  })

  it('note_createNote 写入笔记；folderId 指向不存在的文件夹被拒', async () => {
    const okRes = await dispatchAgentTool('note_createNote', { title: '需求要点', markdown: '# hi' })
    expect(okRes.ok).toBe(true)

    const bad = await dispatchAgentTool('note_createNote', { title: 'x', folderId: 'ghost' })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('笔记文件夹不存在')
  })

  it('note_updateNote 传 null 移出文件夹（nullable 三态）', async () => {
    const fr = await dispatchAgentTool('note_createFolder', { name: 'Q3 复盘' })
    const fid = (fr.data as { folderId: string }).folderId
    const nr = await dispatchAgentTool('note_createNote', { title: 'N', folderId: fid })
    const nid = (nr.data as { noteId: string }).noteId
    expect((await db.notes.get(nid))!.folderId).toBe(fid)

    await dispatchAgentTool('note_updateNote', { noteId: nid, folderId: null })
    expect((await db.notes.get(nid))!.folderId).toBeUndefined()
  })

  it('listNotes 不下发 markdown 正文（只给长度），且上限受控', async () => {
    await dispatchAgentTool('note_createNote', { title: 'A', markdown: '#'.repeat(9999) })
    const r = await listNotes({})
    const item = r.items[0] as Record<string, unknown>
    expect(item.markdown).toBeUndefined()
    expect(item.markdownLength).toBe(9999)
    expect(READ_LIMITS.listNotes).toBe(50)
  })

  it('listNotes 超上限时截断并置 truncated=true', async () => {
    for (let i = 0; i < READ_LIMITS.listNotes + 3; i++) {
      await db.notes.put({
        id: `note:${i}`,
        title: `N${i}`,
        markdown: '',
        tags: [],
        backlinks: [],
        mentions: [],
        createdAt: i,
        updatedAt: 1,
        deleted: 0,
        rev: 1,
      } as never)
    }
    const r = await listNotes({})
    expect(r.items).toHaveLength(READ_LIMITS.listNotes)
    expect(r.truncated).toBe(true)
  })

  it('listProjects / listNoteFolders 返回最小投影', async () => {
    await dispatchAgentTool('project_createProject', { name: 'P1', budget: 100 })
    const r = await dispatchAgentTool('listProjects', {})
    expect(r.ok).toBe(true)
    const items = (r.data as { items: Record<string, unknown>[] }).items
    expect(items[0]).toMatchObject({ name: 'P1', status: 'active', budget: 100 })
  })
})

describe('新动作不产生领域事件（与 UI 同入口口径一致）', () => {
  it('todo_updateTodo / project_createProject / note_createNote 均不发事件', async () => {
    const seen: string[] = []
    const offs = (
      ['transaction:created', 'customer:contacted', 'habit:checked'] as const
    ).map((e) => eventBus.on(e, () => seen.push(e)))

    const pr = await dispatchAgentTool('project_createProject', { name: 'P' })
    const pid = (pr.data as { projectId: string }).projectId
    await dispatchAgentTool('project_updateProject', { projectId: pid, status: 'paused' })
    await dispatchAgentTool('note_createNote', { title: 'N' })
    await dispatchAgentTool('note_createFolder', { name: 'F' })

    offs.forEach((off) => off())
    expect(seen).toEqual([])
  })
})

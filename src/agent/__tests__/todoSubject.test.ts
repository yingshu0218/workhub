/**
 * 待办「正文 ↔ 标题」写入口径收口回归（Issue #148 后续）
 *
 * 断点：Agent 侧 `todo_createTodo` / `todo_updateTodo` 此前独立写 title/desc，
 * 与 UI 的「正文首行即标题」不同源 —— 后果是 Agent 建的待办在 UI 打开→保存时
 * `desc` 被编辑回填静默改写（连带 ⌘K 副标题、工作台日程行）。
 *
 * 本测试锁两条：
 *   ① Agent 写入恒满足 `title = 正文首行`（title/desc/content 三态都归一化到同一口径）；
 *   ② Agent 建的数据在 UI 往返（toTodoText → splitTodoText）后**不再变化**（幂等）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { dispatchAgentTool } from '../executor'
import { splitTodoText, toTodoText } from '@/modules/todo/title'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function create(input: unknown): Promise<string> {
  const r = await dispatchAgentTool('todo_createTodo', input)
  expect(r.ok, JSON.stringify(r)).toBe(true)
  return (r.data as { todoId: string }).todoId
}

describe('① todo_createTodo：正文口径与 UI 同源', () => {
  it('推荐用法：只传 content，标题 = 首行（60 字），desc = 正文全文', async () => {
    const id = await create({ content: '季度复盘会\n准备 Q3 数据' })
    const t = (await db.todos.get(id))!
    expect(t.title).toBe('季度复盘会')
    expect(t.desc).toBe('季度复盘会\n准备 Q3 数据')
  })

  it('兼容用法：只传 title（老契约）仍然可用，desc 为空', async () => {
    const id = await create({ title: '周五回访王五' })
    const t = (await db.todos.get(id))!
    expect(t.title).toBe('周五回访王五')
    expect(t.desc).toBe('周五回访王五')
  })

  it('老契约 title + desc：落库即完成归一化，title 取代 desc 首行位置', async () => {
    const id = await create({ title: '季度复盘会', desc: '准备 Q3 数据' })
    const t = (await db.todos.get(id))!
    expect(t.title).toBe('季度复盘会')
    // desc 折进同一正文（与 UI 编辑回填同规则），不再是「两个独立字段」
    expect(t.desc).toBe('季度复盘会\n准备 Q3 数据')
  })

  it('title 与 desc 首行已一致时不重复补行', async () => {
    const id = await create({ title: '写周报', desc: '写周报\n附上本周数据' })
    const t = (await db.todos.get(id))!
    expect(t.desc).toBe('写周报\n附上本周数据')
    expect(t.desc.match(/写周报/g)).toHaveLength(1)
  })

  it('content 为空且无 title → 拒绝（可操作错误，与 UI「请先写下待办内容」同语义）', async () => {
    const r = await dispatchAgentTool('todo_createTodo', { content: '   ' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('待办内容')
  })
})

describe('② todo_updateTodo：正文三态与整体替换', () => {
  it('content 整体替换正文，标题随之由首行重推', async () => {
    const id = await create({ content: '旧标题\n旧备注' })
    await dispatchAgentTool('todo_updateTodo', { todoId: id, content: '新标题\n新备注' })
    const t = (await db.todos.get(id))!
    expect(t.title).toBe('新标题')
    expect(t.desc).toBe('新标题\n新备注')
  })

  it('只传 title：只改标题，备注保持不动', async () => {
    const id = await create({ content: '旧标题\n原备注留在原处' })
    await dispatchAgentTool('todo_updateTodo', { todoId: id, title: '改后标题' })
    const t = (await db.todos.get(id))!
    expect(t.title).toBe('改后标题')
    expect(t.desc).toBe('旧标题\n原备注留在原处')
  })

  it('只传 desc：只改备注，标题保持不动', async () => {
    const id = await create({ content: '标题不动' })
    await dispatchAgentTool('todo_updateTodo', { todoId: id, desc: '补一段备注' })
    const t = (await db.todos.get(id))!
    expect(t.title).toBe('标题不动')
    expect(t.desc).toBe('补一段备注')
  })

  it('title + desc 同传 = 整体替换（与 create 同口径）', async () => {
    const id = await create({ content: '原始' })
    await dispatchAgentTool('todo_updateTodo', { todoId: id, title: '甲', desc: '乙' })
    const t = (await db.todos.get(id))!
    expect(t.title).toBe('甲')
    expect(t.desc).toBe('甲\n乙')
  })
})

describe('③ 收口后的核心收益：Agent 建的数据在 UI 往返不再被改写', () => {
  it('Agent 建（老契约 title≠首行）→ UI 打开 → 保存：结果稳定，无需二次归一化', async () => {
    const id = await create({ title: '季度复盘会', desc: '准备 Q3 数据' })
    const stored = (await db.todos.get(id))!

    // UI 回填（toTodoText）→ 保存（splitTodoText）一轮往返
    const roundTrip = splitTodoText(toTodoText(stored))
    expect(roundTrip.title).toBe(stored.title)
    expect(roundTrip.desc).toBe(stored.desc)
  })

  it('速记转待办产物同样满足「首行 = 标题」（消除同数据两条路径不同 desc）', async () => {
    const { captureToTodo } = await import('@/modules/notes/quickCapture')
    const id = await captureToTodo('单行灵感')
    const t = (await db.todos.get(id))!
    expect(t.title).toBe('单行灵感')
    // desc 含来源行不影响首行口径
    expect(t.desc.startsWith('单行灵感')).toBe(true)
    expect(splitTodoText(toTodoText(t))).toEqual({ title: t.title, desc: t.desc })
  })
})

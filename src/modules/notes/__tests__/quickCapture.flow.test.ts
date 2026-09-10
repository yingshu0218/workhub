/**
 * 随手速记处置链路对照测试（Issue #134）
 *
 * 覆盖「速记 → 待办收集箱 / 团队笔记」这条首页右下角收集箱链路的三条纪律：
 * ① 转入待办必须落在「收集箱」（listId 缺省），不得被任何清单字段带偏；
 * ② 转入待办的初始态是干净的未完成态（status='todo'、无 completedAt/dueAt），
 *    否则会污染工作台「今日待办日程」与完成率分母；
 * ③ 处置后速记回写 convertedTo 并离开暂存区（幂等语义：同一条速记不再出现在待处置列表）；
 * ④ 二轮（Issue #134 视觉对齐）新增的**通道留痕**：转入的待办/笔记要能回答「从哪来」，
 *    且 dashboard / sidebar 两个入口留痕不同 —— 留痕是唯一的入参差异，故单独断言。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import type { QuickNote } from '@/db/types'
import {
  captureToNote,
  captureToTodo,
  convertQuickNote,
  quickCaptureTodoTitle,
  quickCaptureTitle,
  CONVERTED_VIA,
  QUICK_CAPTURE_ARCHIVE_TAG,
} from '../quickCapture'
import { isTodoOpen } from '@/modules/todo/domain'

function mkQuickNote(id: string, content: string): QuickNote {
  return { id, content, createdAt: 1, updatedAt: 0, deleted: 0, rev: 0 }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('① 速记 → 待办：归属收集箱', () => {
  it('转入待办后 listId 缺省（即收集箱成员）', async () => {
    const id = await captureToTodo('给客户回个电话')
    const todo = await db.todos.get(id)
    expect(todo).toBeDefined()
    expect(todo!.listId).toBeUndefined()
  })

  it('初始态干净：未完成、无完成时间、无截止时间（不进今日日程、不计完成率）', async () => {
    const id = await captureToTodo('灵感：把催付与发票流联动')
    const todo = (await db.todos.get(id))!
    expect(isTodoOpen(todo)).toBe(true)
    expect(todo.completedAt).toBeUndefined()
    expect(todo.voidedAt).toBeUndefined()
    expect(todo.dueAt).toBeUndefined()
  })

  it('首行作标题（60 字截断）；多行正文全文入 desc 不丢信息', async () => {
    const id = await captureToTodo('标题行\n第二行细节\n第三行细节')
    const todo = (await db.todos.get(id))!
    expect(todo.title).toBe('标题行')
    // 多行速记：全文保真 + 末行来源留痕（留痕是追加行，不覆盖原文）
    expect(todo.desc).toBe('标题行\n第二行细节\n第三行细节\n\n— 由随手速记转入收集箱')
  })

  it('单行速记的 desc 标明来源（便于待办中心回溯）', async () => {
    const id = await captureToTodo('单行灵感')
    const todo = (await db.todos.get(id))!
    expect(todo.title).toBe('单行灵感')
    expect(todo.desc).toBe('由随手速记转入收集箱')
  })

  it('超长单行标题截 60 字（标题不膨胀撑破列表行）', () => {
    const long = 'x'.repeat(120)
    expect(quickCaptureTodoTitle(long)).toHaveLength(60)
  })

  it('空正文回退占位标题（不产生无名记录）', () => {
    expect(quickCaptureTodoTitle('   ')).toBe('未命名待办')
  })
})

describe('② 速记 → 团队笔记', () => {
  it('落正式 Note 并打「速记归档」标签', async () => {
    const id = await captureToNote('一段值得留存的灵感')
    const note = (await db.notes.get(id))!
    // 正文保真 + 末行来源引用（`> ` 引用行，渲染后是灰色出处，不干扰正文）
    expect(note.markdown).toBe('一段值得留存的灵感\n\n> 由随手速记转入团队笔记')
    expect(note.tags).toEqual([QUICK_CAPTURE_ARCHIVE_TAG])
  })

  it('标题取首行并截 30 字', () => {
    const long = 'y'.repeat(80)
    expect(quickCaptureTitle(long)).toHaveLength(30)
    expect(quickCaptureTitle('')).toBe('未命名笔记')
  })
})

describe('③ convertQuickNote：处置后速记离开暂存区', () => {
  it('传入待办：回写 convertedTo=todo，速记不再是「待处置」', async () => {
    const qn = mkQuickNote('qn1', '回访王五')
    await db.quickNotes.put(qn)
    await convertQuickNote(qn, 'todo')
    const saved = (await db.quickNotes.get('qn1'))!
    expect(saved.convertedTo).toBe('todo')
  })

  it('传入笔记：回写 convertedTo=note', async () => {
    const qn = mkQuickNote('qn2', '一段纪要')
    await db.quickNotes.put(qn)
    await convertQuickNote(qn, 'note')
    expect((await db.quickNotes.get('qn2'))!.convertedTo).toBe('note')
  })

  it('返回值为目标记录 id，且目标记录确实落库（可跳转查看）', async () => {
    const qn = mkQuickNote('qn3', '验证跳转目标')
    await db.quickNotes.put(qn)
    const todoId = await convertQuickNote(qn, 'todo')
    expect((await db.todos.get(todoId))!.title).toBe('验证跳转目标')
    const qn4 = mkQuickNote('qn4', '验证笔记目标')
    await db.quickNotes.put(qn4)
    const noteId = await convertQuickNote(qn4, 'note')
    expect((await db.notes.get(noteId))!.markdown).toContain('验证笔记目标')
  })
})

describe('④ 通道留痕：转入的待办/笔记能回答「从哪来」', () => {
  it('dashboard 通道：单行速记 desc 记为「由工作台速记转入收集箱」', async () => {
    const id = await captureToTodo('工作台记的一条', 'dashboard')
    expect((await db.todos.get(id))!.desc).toBe(CONVERTED_VIA.dashboard.todoDesc)
  })

  it('sidebar 通道：同一正文留痕与 dashboard 不同（可区分入口）', async () => {
    const id = await captureToTodo('侧栏记的一条', 'sidebar')
    expect((await db.todos.get(id))!.desc).toBe(CONVERTED_VIA.sidebar.todoDesc)
    expect(CONVERTED_VIA.sidebar.todoDesc).not.toBe(CONVERTED_VIA.dashboard.todoDesc)
  })

  it('通道缺省（旧调用）：退回通用文案，签名向后兼容', async () => {
    const id = await captureToTodo('老入口记的')
    expect((await db.todos.get(id))!.desc).toBe('由随手速记转入收集箱')
  })

  it('归笔记同样按通道留痕，且重复处置不叠加第二行来源', async () => {
    const noteId = await captureToNote('带通道的灵感', 'sidebar')
    const markdown = (await db.notes.get(noteId))!.markdown
    expect(markdown.endsWith(CONVERTED_VIA.sidebar.noteOrigin)).toBe(true)
    // 末尾已带来源行时再处置（同内容）不重复追加
    const again = await captureToNote(`${markdown}`, 'sidebar')
    expect((await db.notes.get(again))!.markdown.match(/由侧栏快速便签转入团队笔记/g)).toHaveLength(
      1,
    )
  })

  it('convertQuickNote 回写处置通道与时间（暂存区可回溯从哪处置）', async () => {
    const qn = mkQuickNote('qn-via', '带留痕的速记')
    await db.quickNotes.put(qn)
    await convertQuickNote(qn, 'todo', 'dashboard')
    const saved = (await db.quickNotes.get('qn-via'))!
    expect(saved.convertedTo).toBe('todo')
    expect(saved.convertedVia).toBe('dashboard')
    expect(typeof saved.convertedAt).toBe('number')
  })
})

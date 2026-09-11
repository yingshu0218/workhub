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
import { mergeRemoteRecord as mergeRemote } from '@/sync/mergeRemote'

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

/**
 * ⑤ 处置态同步合并（Issue #134 三轮）
 *
 * 回归场景（跨设备「复活」）：换设备 / 重装 / 同步队列清空后，pull 拉回服务端旧记录，
 * 而本机已把该速记处置掉。原实现走通用整体覆盖分支 → `convertedTo` 被抹成空 →
 * 速记重新出现在「暂存区待处置」，再点一次「转入待办」就多出一条**重复待办**。
 * 修复口径：与 todos 终态本地优先同款 ——「本地已处置 + 远端未处置」时保留本地处置态。
 */
describe('⑤ 速记处置态本地优先（同步合并）', () => {
  it('本地已处置、远端未处置：拉回远端旧记录后处置态仍在（不复活）', async () => {
    const qn: QuickNote = {
      id: 'qn-sync1',
      content: '已转成待办的一条',
      convertedTo: 'todo',
      convertedAt: 111,
      convertedVia: 'dashboard',
      createdAt: 1,
      updatedAt: 100,
      deleted: 0,
      rev: 1,
    }
    await db.quickNotes.put(qn)

    const res = await mergeRemote('quickNotes', {
      id: 'pbh_qn1',
      localId: 'qn-sync1',
      content: '已转成待办的一条',
      convertedTo: '',
      createdAt: 1,
      updatedAt: 200, // 服务端 updatedAt 更新（LWW 单看时间戳本会让远端赢）
      deleted: 0,
      rev: 2,
    })

    expect(res).toBe('write')
    const after = (await db.quickNotes.get('qn-sync1'))!
    // 核心断言：处置态不复活
    expect(after.convertedTo).toBe('todo')
    // 去向 + 时间 + 通道成对保留（单保 convertedTo 会让暂存区排序与来源回溯失去依据）
    expect(after.convertedAt).toBe(111)
    expect(after.convertedVia).toBe('dashboard')
  })

  it('本地未处置、远端已处置：按 LWW 采纳远端处置（可能是另一端的处置结果）', async () => {
    await db.quickNotes.put({
      id: 'qn-sync2',
      content: '另一端处置掉的',
      createdAt: 1,
      updatedAt: 100,
      deleted: 0,
      rev: 1,
    } as QuickNote)

    await mergeRemote('quickNotes', {
      id: 'pbh_qn2',
      localId: 'qn-sync2',
      content: '另一端处置掉的',
      convertedTo: 'note',
      convertedAt: 300,
      convertedVia: 'sidebar',
      createdAt: 1,
      updatedAt: 200,
      deleted: 0,
      rev: 2,
    })

    const after = (await db.quickNotes.get('qn-sync2'))!
    expect(after.convertedTo).toBe('note')
    expect(after.convertedVia).toBe('sidebar')
  })

  it('两端都未处置：正常写入远端内容，不被处置态分支干扰', async () => {
    await db.quickNotes.put({
      id: 'qn-sync3',
      content: '旧内容',
      createdAt: 1,
      updatedAt: 100,
      deleted: 0,
      rev: 1,
    } as QuickNote)

    await mergeRemote('quickNotes', {
      id: 'pbh_qn3',
      localId: 'qn-sync3',
      content: '新内容',
      createdAt: 1,
      updatedAt: 200,
      deleted: 0,
      rev: 2,
    })

    const after = (await db.quickNotes.get('qn-sync3'))!
    expect(after.content).toBe('新内容')
    expect(after.convertedTo).toBeUndefined()
  })
})

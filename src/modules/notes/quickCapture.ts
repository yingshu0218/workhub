import { noteRepo, quickNoteRepo, todoRepo, newId } from '@/repositories'
import type { PutInput } from '@/repositories/repository'
import type { Note, QuickNote, Todo } from '@/db/types'
import { eventBus } from '@/shared/eventBus'
import { extractMentions } from './shared'

/**
 * 「随手速记」领域收口（Issue #70 创立，Issue #134 扩为速记的**唯一**处置入口）。
 *
 * 速记（QuickNote）是「灵感一闪、先记下来」的原始捕获态；它本身不是终点，
 * 必须能被一键处置为**待办**或**正式笔记**。此前工作台卡片各自内联拼 Todo/Note
 * 字段（漏 folderId、漏 mentions、漏 syncEngine.requestSync），Sidebar 入口又只
 * 会落笔记——同一条速记走不同入口落库字段不同，属「多份实现靠巧合成立」。
 *
 * 本模块把三类动作收口为唯一实现体（UI 只调这里，不再手拼记录字段）：
 * - saveQuickCapture   ：正文 → 正式 Note（tag「速记」+ 默认目录）
 * - captureToTodo      ：正文 → 待办，**归属「收集箱」（listId 缺省）**
 * - captureToNote      ：正文 → 正式 Note（tag「速记归档」）
 * - convertQuickNote   ：已落库的速记记录 → 待办 / 笔记（处置后回写 convertedTo）
 *
 * 「收集箱」口径（与待办中心一致）：`listId` 缺省即收集箱成员；速记转入的待办
 * **不得**被任何清单字段带偏，保持「先收集、再归类」的两段式节奏。
 */

export const QUICK_CAPTURE_TAG = '速记'
/** 「归入团队笔记」专用标签：与侧栏速记的「速记」区分，两个入口可检索区分 */
export const QUICK_CAPTURE_ARCHIVE_TAG = '速记归档'
/** 速记转待办的默认优先级：速记不是紧急事项，进收集箱待后续排期 */
export const QUICK_CAPTURE_TODO_PRIORITY: Todo['priority'] = 'P2'
/** 速记转待办的 desc：标明来源，便于在待办中心回溯 */
export const QUICK_CAPTURE_TODO_DESC = '由随手速记转入收集箱'

export interface SaveQuickCaptureInput {
  content: string
  /** 目标文件夹；缺省 undefined = 未归档根层 */
  folderId?: string
}

/** 从正文取标题：首行 trim，截断 30 字；空正文回退「未命名笔记」 */
export function quickCaptureTitle(content: string): string {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  return (firstLine || '未命名笔记').slice(0, 30)
}

/** 从正文取待办标题：首行 trim，截断 60 字；空正文回退「未命名待办」 */
export function quickCaptureTodoTitle(content: string): string {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  return (firstLine || '未命名待办').slice(0, 60)
}

/**
 * 保存一条快速便签为正式 Note，返回落库后的 Note id（供「查看」跳转）。
 * Note 由 noteRepo 统一盖章同步元数据，本函数只回传业务 id。
 */
export async function saveQuickCapture({
  content,
  folderId,
}: SaveQuickCaptureInput): Promise<string> {
  const markdown = content.trim()
  const id = newId('note')
  const note: PutInput<Note> = {
    id,
    title: quickCaptureTitle(markdown),
    markdown,
    tags: [QUICK_CAPTURE_TAG],
    backlinks: [],
    mentions: extractMentions(markdown),
    folderId: folderId || undefined,
    createdAt: Date.now(),
  }
  await noteRepo.put(note)
  return note.id
}

/**
 * 正文 → 待办（进「收集箱」）。返回新建待办 id。
 *
 * 口径（Issue #134）：
 * - `listId` 恒为 undefined —— 新建即收集箱成员，与待办中心「收集箱 = 无归属未完成」一致；
 * - `status='todo'`、不带 `dueAt` —— 收集箱不催办，截止时间留给用户在待办中心补；
 * - 正文首行作标题（60 字），全文入 `desc`，长文速记不丢信息。
 */
export async function captureToTodo(content: string): Promise<string> {
  const text = content.trim()
  const id = newId('td')
  await todoRepo.put({
    id,
    title: quickCaptureTodoTitle(text),
    desc: text === quickCaptureTodoTitle(text) ? QUICK_CAPTURE_TODO_DESC : text,
    priority: QUICK_CAPTURE_TODO_PRIORITY,
    status: 'todo',
    createdAt: Date.now(),
  })
  return id
}

/** 正文 → 正式笔记（tag「速记归档」）。返回新建笔记 id。 */
export async function captureToNote(content: string): Promise<string> {
  const markdown = content.trim()
  const id = newId('n')
  await noteRepo.put({
    id,
    title: quickCaptureTitle(markdown),
    markdown,
    tags: [QUICK_CAPTURE_ARCHIVE_TAG],
    backlinks: [],
    mentions: extractMentions(markdown),
    createdAt: Date.now(),
  })
  return id
}

/**
 * 处置一条**已落库**的速记：转入待办或归入笔记，并把 `convertedTo` 回写（速记离开暂存区）。
 *
 * @returns 目标记录 id（待办 / 笔记），供 UI 提示「已转入，去查看」时跳转
 */
export async function convertQuickNote(
  quickNote: QuickNote,
  to: 'todo' | 'note',
): Promise<string> {
  const targetId = to === 'todo' ? await captureToTodo(quickNote.content) : await captureToNote(quickNote.content)
  await quickNoteRepo.put({ ...quickNote, convertedTo: to })
  eventBus.emit('quicknote:convert', { quickNoteId: quickNote.id, to })
  return targetId
}

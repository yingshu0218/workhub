import { quickNoteRepo, todoRepo, newId, saveNoteWithMentions } from '@/repositories'
import type { PutInput } from '@/repositories/repository'
import type { Note, QuickNote, Todo } from '@/db/types'
import { eventBus } from '@/shared/eventBus'
import { syncEngine } from '@/sync/engine'
import { DEFAULT_TODO_PRIORITY } from '@/modules/todo/priority'

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
export const QUICK_CAPTURE_TODO_PRIORITY: Todo['priority'] = DEFAULT_TODO_PRIORITY
/** 速记转待办的 desc：标明来源，便于在待办中心回溯（无通道信息时的默认值） */
export const QUICK_CAPTURE_TODO_DESC = '由随手速记转入收集箱'
/** 速记转笔记时追加的 desc 行：正式笔记模型暂无来源字段，用 markdown 末行留痕 */
export const QUICK_CAPTURE_NOTE_ORIGIN = '> 由随手速记转入团队笔记'

/**
 * 速记处置**发起通道** —— 用于在目标记录上留痕，回答「这条待办是哪来的」。
 * 目前有工作台卡（dashboard）与侧栏快速便签（sidebar）两个入口，两者 UI 不同、
 * 处置语义相同，唯一差异就是来源留痕，故作为参数由调用方声明而非各自拼字段。
 */
export type ConvertChannel = 'dashboard' | 'sidebar'

/**
 * 处置通道 → 待办 desc / 笔记来源行的映射。
 * 做成表而非散落的模板字符串：新增通道时只加一行，不会漏改某一个入口。
 */
export const CONVERTED_VIA: Record<ConvertChannel, { todoDesc: string; noteOrigin: string }> = {
  dashboard: {
    todoDesc: '由工作台速记转入收集箱',
    noteOrigin: '> 由工作台速记转入团队笔记',
  },
  sidebar: {
    todoDesc: '由侧栏快速便签转入收集箱',
    noteOrigin: '> 由侧栏快速便签转入团队笔记',
  },
}

/** 取通道留痕：通道缺省（旧调用）时退回通用文案，保持签名向后兼容 */
function viaText(channel?: ConvertChannel) {
  const conf = channel ? CONVERTED_VIA[channel] : undefined
  return {
    todoDesc: conf?.todoDesc ?? QUICK_CAPTURE_TODO_DESC,
    noteOrigin: conf?.noteOrigin ?? QUICK_CAPTURE_NOTE_ORIGIN,
  }
}

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

/**
 * 从正文取待办标题：首行 trim，截断 60 字；空正文回退「未命名待办」。
 *
 * 收口说明（Issue #148 后续 / P2 方向反转）：实现本体已收口到 `modules/todo/title.ts`
 * （agentOps 服务端化——服务端 bundle 不能拖本模块 → repositories → Dexie 的依赖链），
 * 此处 import 本地消费 + re-export 保持旧 import 路径不破坏。
 */
import { quickCaptureTodoTitle } from '@/modules/todo/title'
export { quickCaptureTodoTitle } from '@/modules/todo/title'

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
    folderId: folderId || undefined,
    createdAt: Date.now(),
  }
  // 提及随正文同步成 mention link（与笔记行同事务，见 saveNoteWithMentions）
  await saveNoteWithMentions(note)
  return note.id
}

/**
 * 正文 → 待办（进「收集箱」）。返回新建待办 id。
 *
 * 口径（Issue #134，Issue #148 后续修订）：
 * - `listId` 恒为 undefined —— 新建即收集箱成员，与待办中心「收集箱 = 无归属未完成」一致；
 * - `status='todo'`、不带 `dueAt` —— 收集箱不催办，截止时间留给用户在待办中心补；
 * - 正文首行作标题（60 字），全文入 `desc`，长文速记不丢信息；
 * - 末尾追加一行通道留痕（`— 由<通道>转入收集箱`），**单行与多行同一写法**。
 *
 * 单行口径修订（Issue #148 后续）：原实现对单行正文写「desc = 来源文案」，
 * 使得同一条速记转出的待办与表单新建的待办在 `desc` 上**形态不同**（一个只有来源、
 * 一个含正文全文），进而在编辑表单回填时产生两种往返结果。现统一为
 * 「正文全文 + 来源行」，与表单「正文即 desc」的落库形态对齐，往返幂等。
 */
export async function captureToTodo(content: string, channel?: ConvertChannel): Promise<string> {
  const text = content.trim()
  const id = newId('td')
  const title = quickCaptureTodoTitle(text)
  const { todoDesc } = viaText(channel)
  // 正文全文保真 + 来源留痕（单行/多行同一写法的唯一实现）
  const desc = `${text}\n\n— ${todoDesc}`
  await todoRepo.put({
    id,
    title,
    desc,
    priority: QUICK_CAPTURE_TODO_PRIORITY,
    status: 'todo',
    createdAt: Date.now(),
  })
  return id
}

/**
 * 正文 → 正式笔记（tag「速记归档」）。返回新建笔记 id。
 * 末行附通道来源（`> 由…转入团队笔记`），便于在笔记里回溯这条归档从哪来。
 */
export async function captureToNote(content: string, channel?: ConvertChannel): Promise<string> {
  const body = content.trim()
  const { noteOrigin } = viaText(channel)
  const markdown = body.endsWith(noteOrigin) ? body : `${body}\n\n${noteOrigin}`
  const id = newId('n')
  await saveNoteWithMentions({
    id,
    title: quickCaptureTitle(body),
    markdown,
    tags: [QUICK_CAPTURE_ARCHIVE_TAG],
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
  channel?: ConvertChannel,
): Promise<string> {
  const convertedAt = Date.now()
  const targetId =
    to === 'todo'
      ? await captureToTodo(quickNote.content, channel)
      : await captureToNote(quickNote.content, channel)
  // `convertedTo` 记录「去向 + 通道 + 时间」，便于暂存区与审计回溯
  await quickNoteRepo.put({
    ...quickNote,
    convertedTo: to,
    convertedAt,
    ...(channel ? { convertedVia: channel } : {}),
  })
  eventBus.emit('quicknote:convert', { quickNoteId: quickNote.id, to })
  // 处置后立即触发一次同步：速记处置是用户显式动作，不应等下一次自动心跳
  syncEngine.requestSync()
  return targetId
}

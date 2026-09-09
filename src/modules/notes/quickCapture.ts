import { noteRepo, newId } from '@/repositories'
import type { PutInput } from '@/repositories/repository'
import type { Note } from '@/db/types'
import { extractMentions } from './shared'

/**
 * 侧栏快速便签 / dashboard「归笔记」共用的领域收口函数（Issue #70）。
 * 语义 = 一次落库成一条真正的 Note：正文首行作标题（截 30 字）、正文全文作 markdown、
 * 自动打 tag「速记」（与 dashboard 卡片的「速记归档」区分，两个入口可检索区分）、
 * 提取 @提及、落指定默认目录（缺省 = 未归档根层）。
 *
 * 复用点：后续 dashboard 卡片「归笔记」也可迁移到此，顺带修复它不落 folderId 的旧问题。
 */
export const QUICK_CAPTURE_TAG = '速记'

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

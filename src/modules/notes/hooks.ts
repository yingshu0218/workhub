import type { Note, NoteMention } from '@/db/types'
import { db } from '@/db/db'
import { useCollection, useQuery } from '@/queries/hooks'

/**
 * 笔记模块领域查询 Hook（组件不直碰 Dexie，存储切换只改查询层）
 */

const EMPTY: Note[] = []

/** 笔记列表投影行（审计 P2-6）：不携带 markdown 大字段，正文不进列表内存 */
export interface NoteListItem {
  id: string
  title: string
  tags: string[]
  mentions: NoteMention[]
  updatedAt: number
}

/** 投影版笔记列表：只取 id/title/tags/mentions/updatedAt，摘要与搜索均不依赖 markdown */
export function useNoteList(): NoteListItem[] {
  return useCollection<NoteListItem>('notes', ['id', 'title', 'tags', 'mentions', 'updatedAt'])
}

/**
 * 笔记详情（审计 P2-11 直链修复）—— 三态返回：
 * undefined = 查询进行中（首帧/loading，调用方显示加载态，避免闪「不存在」）；
 * null = 查询已完成且记录不存在或已软删；
 * Note = 就绪。
 */
export function useNoteRecord(id: string | undefined): Note | null | undefined {
  return useQuery<Note | null>(
    () =>
      id
        ? db.notes.get(id).then((n) => (n && !n.deleted ? n : null))
        : Promise.resolve(null),
    [id],
  )
}

/**
 * 反向链接：其他笔记的 markdown 中 @提及（含链接文本）了本笔记标题。
 * 简化实现（Phase 4 约定）：扫描其他笔记 markdown 是否包含本笔记标题。
 */
export function useBacklinks(note: Pick<Note, 'id' | 'title'> | undefined): Note[] {
  const { id, title } = note ?? {}
  const list = useQuery<Note[]>(
    () =>
      id && title
        ? db.notes
            .filter((n) => !n.deleted && n.id !== id && !!n.title && n.markdown.includes(title))
            .toArray()
        : Promise.resolve(EMPTY),
    [id, title],
  )
  return list ?? EMPTY
}

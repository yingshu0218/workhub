import type { Note } from '@/db/types'
import { db } from '@/db/db'
import { useQuery } from '@/queries/hooks'

/**
 * 笔记模块领域查询 Hook（组件不直碰 Dexie，存储切换只改查询层）
 */

const EMPTY: Note[] = []

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

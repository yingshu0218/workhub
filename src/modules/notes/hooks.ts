import type { Note, NoteFolder, NoteMention } from '@/db/types'
import { db } from '@/db/db'
import { newId } from '@/repositories'
import { useCollection, useQuery } from '@/queries/hooks'
import { syncEngine } from '@/sync/engine'

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
  folderId?: string
  updatedAt: number
}

/** 投影版笔记列表：只取 id/title/tags/mentions/folderId/updatedAt，摘要与搜索均不依赖 markdown */
export function useNoteList(): NoteListItem[] {
  return useCollection<NoteListItem>('notes', [
    'id',
    'title',
    'tags',
    'mentions',
    'folderId',
    'updatedAt',
  ])
}

/**
 * 笔记详情（审计 P2-11 直链修复）—— 三态返回：
 * undefined = 查询进行中（首帧/loading，调用方显示加载态，避免闪「不存在」）；
 * null = 查询已完成且记录不存在或已软删；
 * Note = 就绪。
 */
export function useNoteRecord(id: string | undefined): Note | null | undefined {
  return useQuery<Note | null>(
    () => (id ? db.notes.get(id).then((n) => (n && !n.deleted ? n : null)) : Promise.resolve(null)),
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

// ===== 笔记文件夹（文件树体系，数据层与 todo 自定义清单同款事务纪律） =====

/** 订阅文件夹（按名称排序，过滤软删） */
export function useNoteFolders(): NoteFolder[] {
  const folders = useQuery<NoteFolder[]>(async () => {
    const all = await db.noteFolders.toArray()
    return all.filter((f) => !f.deleted).sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [])
  return folders ?? []
}

/** 新建文件夹（重名直接复用既有文件夹，避免重复节点） */
export async function createNoteFolder(name: string): Promise<NoteFolder> {
  const trimmed = name.trim()
  const existing = await db.noteFolders.toArray()
  const hit = existing.find((f) => !f.deleted && f.name === trimmed)
  if (hit) return hit
  const now = Date.now()
  const folder: NoteFolder = {
    id: newId('nf'),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    deleted: 0,
    rev: 1,
  }
  await db.transaction('rw', [db.noteFolders, db.syncQueue], async () => {
    await db.noteFolders.put(folder)
    await db.syncQueue.add({
      table: 'noteFolders',
      recordId: folder.id,
      op: 'upsert',
      createdAt: now,
    })
  })
  return folder
}

/** 重命名文件夹 */
export async function renameNoteFolder(id: string, name: string): Promise<void> {
  const prev = await db.noteFolders.get(id)
  if (!prev || prev.deleted) return
  const now = Date.now()
  await db.transaction('rw', [db.noteFolders, db.syncQueue], async () => {
    await db.noteFolders.put({ ...prev, name: name.trim(), updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({ table: 'noteFolders', recordId: id, op: 'upsert', createdAt: now })
  })
}

/** 删除文件夹（级联：名下笔记解绑 folderId 回到「全部笔记」根层） */
export async function deleteNoteFolderCascade(id: string): Promise<void> {
  const prev = await db.noteFolders.get(id)
  if (!prev || prev.deleted) return
  const now = Date.now()
  const notes = await db.notes.where('folderId').equals(id).toArray()
  await db.transaction('rw', [db.noteFolders, db.notes, db.syncQueue], async () => {
    await db.noteFolders.put({ ...prev, deleted: 1, updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({ table: 'noteFolders', recordId: id, op: 'delete', createdAt: now })
    for (const n of notes.filter((x) => !x.deleted)) {
      await db.notes.put({ ...n, folderId: undefined, updatedAt: now, rev: n.rev + 1 })
      await db.syncQueue.add({ table: 'notes', recordId: n.id, op: 'upsert', createdAt: now })
    }
  })
}

/** 移动笔记到文件夹（folderId=undefined 即移回根层） */
export async function moveNoteToFolder(
  noteId: string,
  folderId: string | undefined,
): Promise<void> {
  const prev = await db.notes.get(noteId)
  if (!prev || prev.deleted) return
  const now = Date.now()
  await db.transaction('rw', [db.notes, db.syncQueue], async () => {
    await db.notes.put({ ...prev, folderId, updatedAt: now, rev: prev.rev + 1 })
    await db.syncQueue.add({ table: 'notes', recordId: noteId, op: 'upsert', createdAt: now })
  })
  syncEngine.requestSync()
}

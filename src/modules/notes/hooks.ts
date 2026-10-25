import type { Note, NoteFolder, TrashSnapshot } from '@/db/types'
import { db } from '@/db/db'
import { storage } from '@/storage'
import { newId, setNoteFolder } from '@/repositories'
import { cascadeSoftDeleteLinks, memberIndexOf } from '@/repositories/links'
import type { Link } from '@/db/types'
import { useCollection, useQuery } from '@/queries/hooks'

/**
 * 笔记模块领域查询 Hook（组件不直碰 Dexie，存储切换只改查询层）
 */

const EMPTY: Note[] = []

/** 笔记列表投影行（审计 P2-6）：不携带 markdown 大字段，正文不进列表内存。
 *  v16 起不含归属（folderId 已迁 member link）——归属一律走 useNoteFolderIdOf 索引 */
export interface NoteListItem {
  id: string
  title: string
  tags: string[]
  updatedAt: number
}

/** 投影版笔记列表：只取 id/title/tags/updatedAt，摘要与搜索均不依赖 markdown
 *  （提及已迁 links：列表角标/搜索走 mentionLinks.ts 的 useMentionLinkIndex） */
export function useNoteList(): NoteListItem[] {
  return useCollection<NoteListItem>('notes', ['id', 'title', 'tags', 'updatedAt'])
}

/**
 * 笔记 → 文件夹归属索引（Phase 3 读侧收口）：Map<noteId, folderId>，liveQuery 订阅 links。
 * 新建/移动/级联/恢复/同步对 member link 的任何变更都自动重渲染消费组件。
 */
export function useNoteFolderIdOf(): Map<string, string> {
  const rows =
    useQuery<Link[]>(
      () =>
        db.links
          .where('kind')
          .equals('member')
          .filter((l) => !l.deleted && l.fromType === 'notes' && l.toType === 'noteFolders')
          .toArray(),
      [],
    ) ?? EMPTY_MEMBER_ROWS
  return memberIndexOf(rows)
}

const EMPTY_MEMBER_ROWS: Link[] = []

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

/**
 * 新建文件夹（重名直接复用既有文件夹，避免重复节点）
 *
 * ⚠️ 写入口纪律（2026-10-21 审计 P1 收口）：本模块**禁止** `db.transaction` 直写，
 * 写一律经 `storage.transaction`（StorageAdapter 原语），读仍走 `db.*`。
 */
export async function createNoteFolder(name: string): Promise<NoteFolder> {
  const trimmed = name.trim()
  const existing = await storage.list<NoteFolder>('noteFolders')
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
  await storage.transaction(['noteFolders', 'syncQueue'], async (tx) => {
    await tx.put('noteFolders', folder)
    await tx.enqueue('noteFolders', folder.id, 'upsert', now)
  })
  // Issue #169 P1-B：本模块 4 个文件夹写函数里原本只有 moveNoteToFolder 触发同步，
  // 建/改/删三个只入队不唤醒引擎 → 变更只能等 30s 心跳（用户建完文件夹立刻关标签页，
  // 本机可见、其他设备要等到下次心跳；属延迟而非丢失，但对「刚建就看得到」是硬缺陷）。
  storage.requestSync()
  return folder
}

/** 重命名文件夹 */
export async function renameNoteFolder(id: string, name: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['noteFolders', 'syncQueue'], async (tx) => {
    const prev = await tx.get<NoteFolder>('noteFolders', id)
    if (!prev || prev.deleted) return
    await tx.put('noteFolders', { ...prev, name: name.trim(), updatedAt: now, rev: prev.rev + 1 })
    await tx.enqueue('noteFolders', id, 'upsert', now)
  })
  storage.requestSync()
}

/**
 * 删除文件夹（Phase 3 集合层版：成员 = member link，删除即统一墓碑化）
 *
 * 旧路径（解绑 folderId 字段 + mode:'set' 快照）随 v16 整体退役：名下笔记的 member link
 * 由 cascadeSoftDeleteLinks 与文件夹软删同事务墓碑化（含已软删笔记的 link —— 与旧口径
 * 一致），快照 `cascadeLinkIds` 留档；恢复时按「两端存活」逐条复活。笔记行全程不动 ——
 * 不属于任何文件夹的笔记自然落入根层（无 member link = 根层口径）。
 */
export async function deleteNoteFolderCascade(id: string): Promise<void> {
  const now = Date.now()
  await storage.transaction(['noteFolders', 'notes', 'links', 'syncQueue'], async (tx) => {
    const prev = await tx.get<NoteFolder>('noteFolders', id)
    if (!prev || prev.deleted) return
    const cascadeLinkIds = await cascadeSoftDeleteLinks(tx, [{ type: 'noteFolders', id }], now)
    const trashSnapshot: TrashSnapshot = {
      children: [],
      links: [],
      ...(cascadeLinkIds.length ? { cascadeLinkIds } : {}),
    }
    await tx.update('noteFolders', id, {
      deleted: 1,
      updatedAt: now,
      rev: prev.rev + 1,
      deletedAt: now,
      restoredAt: undefined,
      trashSnapshot,
    })
    await tx.enqueue('noteFolders', id, 'delete', now)
  })
  storage.requestSync()
}

/** 移动笔记到文件夹（folderId=undefined 即移回根层）—— v16 起只动 member link */
export async function moveNoteToFolder(
  noteId: string,
  folderId: string | undefined,
): Promise<void> {
  await setNoteFolder(noteId, folderId)
}

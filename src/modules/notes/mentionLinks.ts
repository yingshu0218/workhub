import { useMemo } from 'react'
import { db } from '@/db/db'
import type { Link } from '@/db/types'
import { useQuery } from '@/queries/hooks'

/**
 * mention link 读侧 hooks（关联层 Phase 2：mentions 迁 links 后的统一读入口）。
 *
 * 读路径纪律与 linksOf/linksTo 相同：走 kind / [fromType+fromId] 索引，禁止全表扫；
 * useQuery 内建 liveQuery —— links 表变化（保存提及 / 删除级联 / 恢复回填）自动重渲染。
 */

/** 全量提及索引：Map<noteId, 该笔记的 mention links>（列表页角标 / 搜索用） */
export function useMentionLinkIndex(): Map<string, Link[]> {
  const rows = useQuery<Link[]>(
    () =>
      db.links
        .where('kind')
        .equals('mention')
        .filter((l) => !l.deleted && l.fromType === 'notes')
        .toArray(),
    [],
  )
  return useMemo(() => {
    const m = new Map<string, Link[]>()
    for (const l of rows ?? []) {
      const list = m.get(l.fromId)
      if (list) list.push(l)
      else m.set(l.fromId, [l])
    }
    return m
  }, [rows])
}

/** 单篇笔记的提及 links（编辑页「@提及实体」面板用） */
export function useNoteMentions(noteId: string | undefined): Link[] {
  const rows = useQuery<Link[]>(
    () =>
      noteId
        ? db.links
            .where('[fromType+fromId]')
            .equals(['notes', noteId])
            .filter((l) => !l.deleted && l.kind === 'mention')
            .toArray()
        : Promise.resolve([] as Link[]),
    [noteId],
  )
  return rows ?? []
}

/** 提及展示形态：type 还原为 mention 语法侧的短名（customers → customer），label 取 meta */
export interface MentionView {
  type: 'customer' | 'todo' | 'ledger' | 'project'
  id: string
  label: string
}

export function mentionViewOf(l: Link): MentionView {
  const type: MentionView['type'] =
    l.toType === 'customers'
      ? 'customer'
      : l.toType === 'todos'
        ? 'todo'
        : l.toType === 'ledgers'
          ? 'ledger'
          : 'project'
  return { type, id: l.toId, label: typeof l.meta?.label === 'string' ? l.meta.label : '' }
}

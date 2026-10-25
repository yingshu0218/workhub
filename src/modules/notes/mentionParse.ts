import type { NoteMention } from '@/db/types'

/**
 * @提及语法解析（纯函数层）。
 *
 * 关联层 Phase 2（v15）起，mentions 不再随笔记落库，而是保存时同步成
 * kind='mention' 的 link（见 repositories/links.ts#syncMentionLinks）；但**解析本身
 * 仍是运行时的**：编辑器渲染高亮、保存时从 markdown 抽取提及，都离不开这份语法。
 * 从 shared.tsx 抽出成独立 .ts（零 React 依赖）—— repositories 的复合保存函数
 * 也要用（saveNoteWithMentions），.tsx 会把 React 拖进存储链。
 */

/** 提及语法：@[名称](type:id) */
export const MENTION_RE = /@\[([^\]]+)\]\((customer|todo|ledger|project):([^)\s]+)\)/g

/** 从 markdown 提取去重后的提及（同目标只留首个 label；label 供 link.meta 与悬浮卡展示） */
export function extractMentions(markdown: string): NoteMention[] {
  const seen = new Set<string>()
  const list: NoteMention[] = []
  for (const m of markdown.matchAll(MENTION_RE)) {
    const [, label, type, id] = m
    const key = `${type}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ type: type as NoteMention['type'], id, label })
  }
  return list
}

/**
 * 提及 label 净化（审计 P2-1）：剔除会截断 MENTION_RE 解析的字符。
 * label 段为 [^\]]+，含 `]` 会让语法在 label 中间提前闭合；
 * `)` 会与 type:id 段后的收尾括号混淆。实体名/待办标题来自用户输入，插入前必须过滤。
 */
export function safeMentionLabel(label: string): string {
  return label.replace(/[\])]/g, '')
}

import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { CSSProperties } from 'react'
import { MENTION_RE } from './mentionParse'

/**
 * 笔记模块共享工具：智能彩色标签 / @提及语法解析 / marked 渲染（DOMPurify 净化）
 * 本地内容可信（开发计划 Phase 4 约定），但仍禁止外链脚本与内联事件执行。
 */

// ===== 智能彩色标签：标签名 hash 成固定色相 =====

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function tagHue(tag: string): number {
  return hashStr(tag) % 360
}

/** 彩色标签样式（同一标签恒定同色） */
export function tagStyle(tag: string): CSSProperties {
  const h = tagHue(tag)
  return {
    background: `hsl(${h} 85% 92%)`,
    color: `hsl(${h} 70% 28%)`,
  }
}

// ===== @提及语法 =====
// 实现已抽到 mentionParse.ts（纯函数层，零 React 依赖 —— repositories 的复合保存
// 函数也用它；mentions 已迁 links，解析仍服务渲染高亮与保存时同步）
export { MENTION_RE, extractMentions, safeMentionLabel } from './mentionParse'

// ===== Markdown 渲染 =====

marked.use({ gfm: true, breaks: true })

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 提及语法 → 彩色胶囊（内联 HTML，marked 原样保留） */
function preprocessMentions(md: string): string {
  const pill = (_m: string, label: string, type: string) =>
    `<span class="md-mention md-mention-${type}">@${escapeHtml(label)}</span>`
  // 审计 P2-2：按 ``` 围栏切分，仅对非代码段做提及替换（代码块内的 @语法保持字面原样）
  return md
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((seg) => (seg.startsWith('```') ? seg : seg.replace(MENTION_RE, pill)))
    .join('')
}

/** 渲染为 HTML：markdown → 提及胶囊预处理 → DOMPurify 净化后再进预览 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(preprocessMentions(md)) as string
  return DOMPurify.sanitize(raw)
}

/** 剥掉 markdown 语法后的纯文本（列表摘要用） */
export function markdownToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(MENTION_RE, (_m, label) => `@${label}`)
    .replace(/[#>*`~_\-[\]()!|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 字数（不含空白字符） */
export function wordCount(md: string): number {
  return md.replace(/\s/g, '').length
}

// ===== 预览区基础排版（手写 prose，限定 .note-prose 作用域） =====

export const NOTE_PROSE_CSS = `
.note-prose { font-size: 1rem; line-height: 1.75; color: var(--color-on-surface); word-break: break-word; }
.note-prose > :first-child { margin-top: 0; }
.note-prose h1 { font-size: 1.7143rem; font-weight: 700; letter-spacing: -0.01em; margin: 22px 0 10px; }
.note-prose h2 { font-size: 1.2857rem; font-weight: 600; margin: 20px 0 8px; }
.note-prose h3 { font-size: 1.1071rem; font-weight: 600; margin: 16px 0 6px; }
.note-prose p { margin: 8px 0; }
.note-prose ul, .note-prose ol { margin: 8px 0; padding-left: 22px; }
.note-prose ul { list-style: disc; }
.note-prose ol { list-style: decimal; }
.note-prose li { margin: 3px 0; }
.note-prose li input[type="checkbox"] { margin-right: 6px; accent-color: var(--color-primary); }
.note-prose blockquote { margin: 10px 0; padding: 8px 14px; border-left: 3px solid var(--color-primary); background: var(--color-surface-container-high); border-radius: 0 8px 8px 0; color: var(--color-on-surface-variant); }
.note-prose code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8929rem; background: var(--color-surface-container-high); padding: 1.5px 5px; border-radius: 4px; }
.note-prose pre { background: #0b1c30; color: #e5eeff; padding: 12px 14px; border-radius: 8px; overflow-x: auto; margin: 10px 0; }
.note-prose pre code { background: transparent; color: inherit; padding: 0; }
.note-prose a { color: var(--color-primary); text-decoration: underline; text-underline-offset: 2px; }
.note-prose img { max-width: 100%; border-radius: 8px; }
.note-prose hr { border: none; border-top: 1px solid var(--color-outline-variant); margin: 18px 0; }
.note-prose table { border-collapse: collapse; margin: 10px 0; width: 100%; }
.note-prose th, .note-prose td { border: 1px solid var(--color-outline-variant); padding: 5px 10px; text-align: left; }
.note-prose th { background: var(--color-surface-container-low); font-weight: 600; }
.note-prose strong { font-weight: 600; }
/* @提及胶囊：按实体类型着色 */
.note-prose .md-mention, .md-mention { display: inline-flex; align-items: center; border-radius: 999px; padding: 0 8px; font-size: 0.8929rem; font-weight: 500; vertical-align: baseline; line-height: 1.5; }
.note-prose .md-mention-customer { background: var(--color-primary-fixed); color: var(--color-primary); }
.note-prose .md-mention-todo { background: var(--color-success-container); color: var(--color-success); }
.note-prose .md-mention-ledger { background: var(--color-warning-container); color: var(--color-warning); }
.note-prose .md-mention-project { background: color-mix(in srgb, #6d43c4 14%, transparent); color: #6d43c4; }
`

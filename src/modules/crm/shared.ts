/**
 * CRM 页面间共享的轻量展示工具（相对时间等）。
 * 注：原「分层配色 `tierChipTone`」已随手动 `tier` 字段一并移除；健康分档位的展示口径
 * 已收口在 `healthScore.ts` 的 `resolveHealthScoreDisplay`，不要再在这里另起一套。
 */
import dayjs from 'dayjs'

/** 相对时间（本地推导，避免引入 relativeTime 插件） */
export function fmtRelative(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return dayjs(ts).format('YYYY-MM-DD')
}

/**
 * 标签归一化 —— 实现已收敛到 `@/shared/tags`（单一真相，功能测试 #32 整改）。
 * 此处保留同名导出，CRM 内部调用点无需关心实现落点。
 * 口径：trim → 去首 `#` → 折叠小写 → 去空 → 去重；不做强制词库约束，手打自由标签照旧（Issue #63 收敛稿）。
 */
export { normalizeTags } from '@/shared/tags'

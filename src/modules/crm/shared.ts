import type { Chip } from '@/design-system/ui'
import dayjs from 'dayjs'

/** CRM 页面间共享的轻量展示工具（分层配色 / 相对时间） */

export type ChipTone = React.ComponentProps<typeof Chip>['tone']

/** 分层 Chip 配色：S=红（核心）/ A=琥珀（重点）/ B=灰 / 潜在=蓝 */
export function tierChipTone(tier: 'S' | 'A' | 'B' | '潜在'): ChipTone {
  switch (tier) {
    case 'S':
      return 'red'
    case 'A':
      return 'amber'
    case '潜在':
      return 'blue'
    default:
      return 'gray'
  }
}

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
 * 标签归一化（配组界面 / 客户表单共用，避免「打错字导致分组失效」）：
 * 按英文逗号切分 → trim → 去首 # → 去空 → Set 去重。
 * 不做强制词库约束，仅归一化，手打自由标签照旧（Issue #63 收敛稿）。
 */
export function normalizeTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,,]/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ]
}

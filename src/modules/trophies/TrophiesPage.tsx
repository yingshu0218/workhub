import { useState } from 'react'
import type { Trophy, TrophyTier, TrophyConditionType } from '@/db/types'
import { Icon } from '@/design-system/Icon'
import { Card, EmptyState, PageHeader } from '@/design-system/ui'
import {
  useTrophyStats,
  useTrophyList,
  computeConditionValue,
  CONDITION_LABELS,
  deriveProfileSummary,
} from './hooks'
import { downloadTrophyPoster } from './poster'

/** tier → 主题配色（边框/渐变/文字/标签）；ProfilePage 复用 */
export const TIER_THEME: Record<
  TrophyTier,
  { border: string; gradient: string; text: string; label: string }
> = {
  铜: {
    border: 'border-amber-700/50',
    gradient: 'from-amber-700 via-amber-500 to-amber-200',
    text: 'text-amber-700',
    label: '铜杯',
  },
  银: {
    border: 'border-slate-400/50',
    gradient: 'from-slate-400 via-slate-300 to-slate-100',
    text: 'text-slate-500',
    label: '银杯',
  },
  金: {
    border: 'border-amber-500/60',
    gradient: 'from-amber-500 via-yellow-400 to-amber-100',
    text: 'text-amber-600',
    label: '金杯',
  },
  白金: {
    border: 'border-sky-400/60',
    gradient: 'from-cyan-600 via-sky-300 to-indigo-200',
    text: 'text-sky-700',
    label: '白金',
  },
}

/** 条件类型 → 还差单位的中文量词（下一里程碑卡用） */
const CONDITION_UNITS: Record<TrophyConditionType, string> = {
  focus_minutes_total: '分钟',
  focus_once_minutes: '分钟',
  habit_streak: '天',
  habit_checks_total: '次',
  transactions_total: '笔',
  customers_total: '位',
}

/** PSN 风格解锁弹窗已全局化为 src/app/TrophyUnlockToast.tsx（Phase 6），任何页面解锁都能弹出 */

export default function TrophiesPage() {
  const trophies = useTrophyList()
  const stats = useTrophyStats()
  const level = deriveProfileSummary(stats, trophies).level
  // 分享海报生成中状态（按奖杯 id 记录，按钮防重入）
  const [posterId, setPosterId] = useState<string | null>(null)

  const sharePoster = async (t: Trophy) => {
    if (posterId) return
    setPosterId(t.id)
    try {
      await downloadTrophyPoster(t, level)
    } catch (err) {
      console.error('[TrophiesPage] 海报生成失败', err)
      window.alert(`海报生成失败：${err instanceof Error ? err.message : '请稍后重试'}`)
    } finally {
      setPosterId(null)
    }
  }

  const unlocked = trophies.filter((t) => t.unlockedAt)
  const tierOrder: TrophyTier[] = ['白金', '金', '银', '铜']
  const tierCount = (tier: TrophyTier) => unlocked.filter((t) => t.tier === tier).length
  const tierTotal = (tier: TrophyTier) => trophies.filter((t) => t.tier === tier).length

  // 展示排序：已解锁在前，tier 白金>金>银>铜
  const sorted = [...trophies].sort((a, b) => {
    const ua = a.unlockedAt ? 0 : 1
    const ub = b.unlockedAt ? 0 : 1
    if (ua !== ub) return ua - ub
    if (a.tier !== b.tier) return tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier)
    return (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)
  })

  // 下一里程碑：未解锁且已登记条件的奖杯中进度百分比最高者（并列取目标更小的，更快解锁）
  let milestone: { trophy: Trophy; pct: number; remaining: number } | null = null
  for (const t of trophies) {
    if (t.unlockedAt || !t.conditionType || !t.conditionValue) continue
    const current = computeConditionValue(t.conditionType, stats)
    const target = t.conditionValue
    const pct = Math.min(100, Math.round((current / target) * 100))
    if (
      !milestone ||
      pct > milestone.pct ||
      (pct === milestone.pct && target < milestone.trophy.conditionValue!)
    ) {
      milestone = { trophy: t, pct, remaining: Math.max(0, target - current) }
    }
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="成就殿堂" subtitle="记录每一个卓越时刻 · 条件从源记录实时推导" />

      {/* 顶部收集统计 */}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-6 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-primary via-primary-container to-secondary text-on-primary">
            <Icon name="emoji_events" size={32} fill />
          </div>
          <div>
            <div className="text-[1.4286rem] font-bold">
              {unlocked.length}{' '}
              <span className="text-[1rem] font-normal text-on-surface-variant">
                / 总 {trophies.length}
              </span>
            </div>
            <div className="text-[0.8571rem] text-on-surface-variant">奖杯收集进度</div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {tierOrder.map((tier) => (
            <div key={tier} className="flex flex-col items-center">
              <span className={`text-[1.0714rem] font-bold ${TIER_THEME[tier].text}`}>
                {tierCount(tier)}
                <span className="text-[0.7857rem] font-normal text-outline">/{tierTotal(tier)}</span>
              </span>
              <span className="text-[0.7857rem] text-on-surface-variant">{TIER_THEME[tier].label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 下一里程碑卡（对齐原型 16：最接近解锁的奖杯 + 进度） */}
      {milestone ? (
        <Card className="mb-4 flex items-center gap-4 p-5">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr ${TIER_THEME[milestone.trophy.tier].gradient} text-white`}
          >
            <Icon name={milestone.trophy.icon} size={26} fill />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[0.7857rem] font-semibold uppercase tracking-wide text-outline">
              下一里程碑
            </div>
            <div className="mt-0.5 truncate text-[1.0357rem] font-semibold">
              {milestone.trophy.name}
              <span className="ml-2 text-[0.8571rem] font-normal text-on-surface-variant">
                还差 {milestone.remaining} {CONDITION_UNITS[milestone.trophy.conditionType!]}解锁
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${milestone.pct}%` }}
              />
            </div>
          </div>
          <span className="shrink-0 text-[1.2857rem] font-bold tabular-nums text-primary">
            {milestone.pct}%
          </span>
        </Card>
      ) : trophies.length > 0 && unlocked.length === trophies.length ? (
        <Card className="mb-4 flex items-center justify-center gap-2 p-4 text-[1rem] font-semibold text-success">
          <Icon name="emoji_events" size={20} fill />
          已收集全部奖杯 🎉
        </Card>
      ) : null}

      {/* 奖杯墙 */}
      {trophies.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon="emoji_events"
            title="奖杯墙还是空的"
            description="坚持打卡与专注，奖杯会随事件自动解锁"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((t) => {
            const theme = TIER_THEME[t.tier]
            const current = computeConditionValue(t.conditionType, stats)
            const target = t.conditionValue ?? 0
            const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
            return (
              <Card
                key={t.id}
                className={`flex h-44 flex-col justify-between p-5 ${t.unlockedAt ? `border ${theme.border}` : 'opacity-75 grayscale'}`}
              >
                <div className="flex items-start justify-between">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      t.unlockedAt
                        ? `bg-gradient-to-tr ${theme.gradient} text-white`
                        : 'bg-surface-container text-outline'
                    }`}
                  >
                    <Icon
                      name={t.unlockedAt ? t.icon : 'lock'}
                      size={24}
                      fill
                      className="t.unlockedAt ? '' : ''}"
                    />
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[0.7857rem] font-medium ${
                      t.unlockedAt
                        ? 'bg-success-container/60 text-success'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    {t.unlockedAt ? '已解锁' : '未解锁'}
                  </span>
                  {t.unlockedAt && (
                    <button
                      className="ml-2 flex items-center gap-1 rounded px-2 py-0.5 text-[0.7857rem] text-primary transition-colors hover:bg-primary-fixed disabled:opacity-50"
                      title="生成分享海报（Canvas 绘制 · 下载 PNG）"
                      disabled={posterId === t.id}
                      onClick={() => void sharePoster(t)}
                    >
                      <Icon name={posterId === t.id ? 'sync' : 'download'} size={13} />
                      {posterId === t.id ? '生成中' : '分享海报'}
                    </button>
                  )}
                </div>
                <div>
                  <div className={`text-[1rem] font-semibold ${t.unlockedAt ? theme.text : ''}`}>
                    {t.name}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[0.8214rem] leading-snug text-on-surface-variant">
                    {t.description}
                  </div>
                </div>
                {t.unlockedAt ? (
                  <div className="flex items-center justify-between text-[0.7857rem]">
                    <span className="font-semibold text-success">
                      {theme.label} · {t.rarity}
                    </span>
                    <span className="text-on-surface-variant">
                      {new Date(t.unlockedAt).toLocaleDateString('zh-CN')} 解锁
                    </span>
                  </div>
                ) : t.conditionType ? (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[0.7857rem] text-on-surface-variant">
                      <span>{CONDITION_LABELS[t.conditionType]}</span>
                      <span>
                        {current}/{target}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-container">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-[0.7857rem] text-outline">条件未登记</div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

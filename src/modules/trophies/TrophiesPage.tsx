import type { TrophyTier } from '@/db/types'
import { Icon } from '@/design-system/Icon'
import { Card, EmptyState, PageHeader } from '@/design-system/ui'
import { useTrophyStats, useTrophyList, computeConditionValue, CONDITION_LABELS } from './hooks'

/** tier → 主题配色（边框/渐变/文字/标签）；ProfilePage 复用 */
export const TIER_THEME: Record<TrophyTier, { border: string; gradient: string; text: string; label: string }> = {
  '铜': { border: 'border-amber-700/50', gradient: 'from-amber-700 via-amber-500 to-amber-200', text: 'text-amber-700', label: '铜杯' },
  '银': { border: 'border-slate-400/50', gradient: 'from-slate-400 via-slate-300 to-slate-100', text: 'text-slate-500', label: '银杯' },
  '金': { border: 'border-amber-500/60', gradient: 'from-amber-500 via-yellow-400 to-amber-100', text: 'text-amber-600', label: '金杯' },
  '白金': { border: 'border-sky-400/60', gradient: 'from-cyan-600 via-sky-300 to-indigo-200', text: 'text-sky-700', label: '白金' },
}

/** PSN 风格解锁弹窗已全局化为 src/app/TrophyUnlockToast.tsx（Phase 6），任何页面解锁都能弹出 */

export default function TrophiesPage() {
  const trophies = useTrophyList()
  const stats = useTrophyStats()

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
            <div className="text-[20px] font-bold">
              {unlocked.length} <span className="text-[14px] font-normal text-on-surface-variant">/ 总 {trophies.length}</span>
            </div>
            <div className="text-[12px] text-on-surface-variant">奖杯收集进度</div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {tierOrder.map((tier) => (
            <div key={tier} className="flex flex-col items-center">
              <span className={`text-[15px] font-bold ${TIER_THEME[tier].text}`}>
                {tierCount(tier)}<span className="text-[11px] font-normal text-outline">/{tierTotal(tier)}</span>
              </span>
              <span className="text-[11px] text-on-surface-variant">{TIER_THEME[tier].label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 奖杯墙 */}
      {trophies.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon="emoji_events" title="奖杯墙还是空的" description="坚持打卡与专注，奖杯会随事件自动解锁" />
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
                      t.unlockedAt ? `bg-gradient-to-tr ${theme.gradient} text-white` : 'bg-surface-container text-outline'
                    }`}
                  >
                    <Icon name={t.unlockedAt ? t.icon : 'lock'} size={24} fill className="t.unlockedAt ? '' : ''}" />
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      t.unlockedAt ? 'bg-success-container/60 text-success' : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    {t.unlockedAt ? '已解锁' : '未解锁'}
                  </span>
                </div>
                <div>
                  <div className={`text-[14px] font-semibold ${t.unlockedAt ? theme.text : ''}`}>{t.name}</div>
                  <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-on-surface-variant">{t.description}</div>
                </div>
                {t.unlockedAt ? (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-success">{theme.label} · {t.rarity}</span>
                    <span className="text-on-surface-variant">{new Date(t.unlockedAt).toLocaleDateString('zh-CN')} 解锁</span>
                  </div>
                ) : t.conditionType ? (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[11px] text-on-surface-variant">
                      <span>{CONDITION_LABELS[t.conditionType]}</span>
                      <span>{current}/{target}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-container">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-outline">条件未登记</div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

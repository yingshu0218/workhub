import { Avatar, Card, Chip, EmptyState, PageHeader } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import {
  useProfileSummary,
  useRecentUnlockedTrophies,
  useTrophyList,
  EXP_PER_LEVEL,
} from './hooks'
import { TIER_THEME } from './TrophiesPage'

export default function ProfilePage() {
  const summary = useProfileSummary()
  const recent = useRecentUnlockedTrophies(5)
  const trophies = useTrophyList()
  const { level, exp, expIntoLevel, unlockedTrophies, totalTrophies, stats } = summary
  const levelPct = Math.round((expIntoLevel / EXP_PER_LEVEL) * 100)

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="个人主页" subtitle="等级 · 成就 · 统计（EXP 由源记录实时推导）" />

      {/* 用户卡片 + Lv 徽章 */}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-6 p-6">
        <div className="flex items-center gap-4">
          <Avatar name="陈致远" size={64} />
          <div>
            <div className="text-[18px] font-bold">陈致远</div>
            <div className="text-[13px] text-on-surface-variant">青枫工作室 · Owner</div>
            <div className="mt-1.5 flex gap-2">
              <Chip tone="blue" icon="bolt">累计 EXP {exp}</Chip>
              <Chip tone="green" icon="emoji_events">奖杯 {unlockedTrophies}/{totalTrophies}</Chip>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5">
          {/* 大 Lv 徽章 */}
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-container text-on-primary shadow-md">
            <span className="text-[11px] font-medium opacity-80">LEVEL</span>
            <span className="text-[30px] font-bold leading-none">{level}</span>
          </div>
          <div className="w-52">
            <div className="mb-1 flex items-center justify-between text-[12px] text-on-surface-variant">
              <span>Lv.{level} → Lv.{level + 1}</span>
              <span>{expIntoLevel}/{EXP_PER_LEVEL}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-container">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all" style={{ width: `${levelPct}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-outline">专注分钟×2 + 打卡×10 + 奖杯×50</div>
          </div>
        </div>
      </Card>

      {/* 源统计速览 */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { icon: 'timer', label: '累计专注分钟', value: stats.focusMinutesTotal },
          { icon: 'event_repeat', label: '累计打卡次数', value: stats.habitChecksTotal },
          { icon: 'local_fire_department', label: '最长连击天数', value: stats.habitStreak },
          { icon: 'receipt_long', label: '累计交易笔数', value: stats.transactionsTotal },
        ].map((m) => (
          <Card key={m.label} className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-fixed text-primary">
              <Icon name={m.icon} size={20} />
            </div>
            <div>
              <div className="text-[18px] font-bold leading-tight">{m.value}</div>
              <div className="text-[11px] text-on-surface-variant">{m.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* 奖杯收集 + 最近解锁 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">奖杯收集统计</h2>
          <ul className="space-y-3">
            {(['白金', '金', '银', '铜'] as const).map((tier) => {
              const theme = TIER_THEME[tier]
              const got = trophies.filter((t) => t.tier === tier && t.unlockedAt).length
              const total = trophies.filter((t) => t.tier === tier).length
              const pct = total > 0 ? Math.round((got / total) * 100) : 0
              return (
                <li key={tier}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className={`font-semibold ${theme.text}`}>{theme.label}</span>
                    <span className="text-on-surface-variant">{got}/{total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-container">
                    <div className={`h-full rounded-full bg-gradient-to-r ${theme.gradient} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">最近解锁</h2>
          {recent.length === 0 ? (
            <EmptyState icon="military_tech" title="还没有解锁记录" description="完成专注与打卡，第一座奖杯很快到来" />
          ) : (
            <ul className="space-y-2">
              {recent.map((t) => {
                const theme = TIER_THEME[t.tier]
                return (
                  <li key={t.id} className="flex items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2.5">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr ${theme.gradient} text-white`}>
                      <Icon name={t.icon} size={20} fill />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">{t.name}</div>
                      <div className={`text-[11px] ${theme.text}`}>{theme.label} · {t.rarity}</div>
                    </div>
                    <span className="shrink-0 text-[11px] text-outline">
                      {t.unlockedAt ? new Date(t.unlockedAt).toLocaleDateString('zh-CN') : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

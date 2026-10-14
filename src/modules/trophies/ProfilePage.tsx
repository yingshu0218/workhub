import { NavLink } from 'react-router-dom'
import { Avatar, Card, Chip, EmptyState, PageHeader } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import { useProfileSummary, useRecentUnlockedTrophies, useTrophyList, EXP_PER_LEVEL } from './hooks'
import { TIER_THEME } from './TrophiesPage'
import { useIdentity } from '@/modules/identity'

export default function ProfilePage() {
  // 身份信息（Issue #123）：改为可改的当前用户身份，默认「阿蓝」
  const identity = useIdentity()
  const summary = useProfileSummary()
  const recent = useRecentUnlockedTrophies(5)
  const trophies = useTrophyList()
  const { level, exp, expIntoLevel, unlockedTrophies, totalTrophies, stats } = summary
  const levelPct = Math.round((expIntoLevel / EXP_PER_LEVEL) * 100)

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="个人主页" />

      {/* 用户卡片 + Lv 徽章。窄屏（<768px）靠 flex-wrap 把「等级与 EXP」挤到第二行，
          构成原型 07 的「个人卡 → 等级与 EXP」上下两块；≥768px 仍是同一行，逐像素不变。 */}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-6 p-5 md:p-6">
        {/* 刻意不加 min-w-0：身份名可被用户改成长文本，加了会让桌面端由「整组换行」
            变成「名字折行」，破坏逐像素一致；窄屏的 Chip 行已可换行，不需要靠收缩兜底。 */}
        <div className="flex items-center gap-4">
          <Avatar name={identity.name} size={64} />
          <div>
            <div className="text-[1.2857rem] font-bold">{identity.name}</div>
            <div className="text-[0.9286rem] text-on-surface-variant">
              {identity.workspace} · {identity.role}
            </div>
            {/* 允许换行：390px 下两枚 Chip 贴边时宁可换行，也不要撑出横向滚动 */}
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Chip tone="blue" icon="bolt">
                累计 EXP {exp}
              </Chip>
              <Chip tone="green" icon="emoji_events">
                奖杯 {unlockedTrophies}/{totalTrophies}
              </Chip>
            </div>
          </div>
        </div>

        <div className="flex w-full items-center gap-5 md:w-auto">
          {/* 大 Lv 徽章 */}
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-container text-on-primary shadow-md">
            <span className="text-[0.7857rem] font-medium opacity-80">LEVEL</span>
            <span className="text-[2.1429rem] font-bold leading-none">{level}</span>
          </div>
          {/* w-52 在 390px 会把本行顶出容器，窄屏改为吃掉剩余宽度；md 起恢复固定宽 */}
          <div className="flex-1 md:w-52 md:flex-none">
            <div className="mb-1 flex items-center justify-between text-[0.8571rem] text-on-surface-variant">
              <span>
                Lv.{level} → Lv.{level + 1}
              </span>
              <span>
                {expIntoLevel}/{EXP_PER_LEVEL}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-container">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all"
                style={{ width: `${levelPct}%` }}
              />
            </div>
            <div className="mt-1 text-[0.7857rem] text-outline">专注分钟×2 + 打卡×10 + 奖杯×50</div>
          </div>
        </div>
      </Card>

      {/* 源统计速览（历史最长连击与当前连击分开展示，审计 P2-8） */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { icon: 'timer', label: '累计专注分钟', value: stats.focusMinutesTotal },
          { icon: 'event_repeat', label: '累计打卡次数', value: stats.habitChecksTotal },
          { icon: 'workspace_premium', label: '最长连续打卡', value: stats.habitStreak },
          { icon: 'local_fire_department', label: '当前连击', value: stats.habitCurrentStreak },
          { icon: 'receipt_long', label: '累计交易笔数', value: stats.transactionsTotal },
        ].map((m) => (
          <Card key={m.label} className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-fixed text-primary">
              <Icon name={m.icon} size={20} />
            </div>
            <div>
              <div className="text-[1.2857rem] font-bold leading-tight">{m.value}</div>
              <div className="text-[0.7857rem] text-on-surface-variant">{m.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* 移动端奖杯墙（原型 07）：窄屏用等分小图标网格一眼看清收集度。
          方块尺寸由栅格推导（aspect-square + w-full），不给图标定死像素，故 320~767px 都不会溢出。
          桌面（≥768px）同一信息已由下方「收集统计 / 最近解锁」两块承担，再铺一遍是重复，故 md:hidden。 */}
      {trophies.length > 0 && (
        <div className="mb-4 grid grid-cols-4 gap-x-2 gap-y-3 md:hidden">
          {trophies.map((t) => (
            <div key={t.id} className="flex flex-col items-center gap-1" title={t.name}>
              <div
                className={`flex aspect-square w-full items-center justify-center rounded-xl ${
                  t.unlockedAt
                    ? `bg-gradient-to-tr ${TIER_THEME[t.tier].gradient} text-white`
                    : 'bg-surface-container text-outline'
                }`}
              >
                <Icon name={t.unlockedAt ? t.icon : 'lock'} size={22} fill />
              </div>
              <span className="w-full truncate text-center text-[0.7143rem] text-on-surface-variant">
                {t.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 奖杯收集 + 最近解锁 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-[1.0714rem] font-semibold">奖杯收集统计</h2>
          <ul className="space-y-3">
            {(['白金', '金', '银', '铜'] as const).map((tier) => {
              const theme = TIER_THEME[tier]
              const got = trophies.filter((t) => t.tier === tier && t.unlockedAt).length
              const total = trophies.filter((t) => t.tier === tier).length
              const pct = total > 0 ? Math.round((got / total) * 100) : 0
              return (
                <li key={tier}>
                  <div className="mb-1 flex items-center justify-between text-[0.8571rem]">
                    <span className={`font-semibold ${theme.text}`}>{theme.label}</span>
                    <span className="text-on-surface-variant">
                      {got}/{total}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-container">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${theme.gradient} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-[1.0714rem] font-semibold">最近解锁</h2>
          {recent.length === 0 ? (
            <EmptyState
              icon="military_tech"
              title="还没有解锁记录"
              description="完成专注与打卡，第一座奖杯很快到来"
            />
          ) : (
            <ul className="space-y-2">
              {recent.map((t) => {
                const theme = TIER_THEME[t.tier]
                return (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2.5"
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr ${theme.gradient} text-white`}
                    >
                      <Icon name={t.icon} size={20} fill />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[0.9643rem] font-medium">{t.name}</div>
                      <div className={`text-[0.7857rem] ${theme.text}`}>
                        {theme.label} · {t.rarity}
                      </div>
                    </div>
                    <span className="shrink-0 text-[0.7857rem] text-outline">
                      {t.unlockedAt ? new Date(t.unlockedAt).toLocaleDateString('zh-CN') : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* 「设置与更多」：<768px 侧栏整体隐藏，而 /trophies、/settings、/module-config 在桌面
          只由侧栏底部区块承载 —— 不在这里补一份，移动端这三个页面将没有任何入口（功能不可达，
          不是样式偏好）。桌面已有等价入口，故 md:hidden 避免出现两份。 */}
      <Card className="mt-4 overflow-hidden md:hidden">
        {[
          { to: '/trophies', icon: 'emoji_events', label: '成就奖杯', hint: '全部奖杯与解锁进度' },
          { to: '/settings', icon: 'settings', label: '系统设置', hint: '外观、通知、同步与导出' },
          { to: '/module-config', icon: 'tune', label: '功能配置', hint: '各业务模块的规则' },
        ].map((item, i) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={`flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-surface-container ${
              i > 0 ? 'border-t border-outline-variant/40' : ''
            }`}
          >
            <Icon name={item.icon} size={20} className="text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9643rem] font-medium leading-tight">{item.label}</span>
              <span className="block truncate text-[0.7857rem] text-outline">{item.hint}</span>
            </span>
            <Icon name="chevron_right" size={18} className="text-outline" />
          </NavLink>
        ))}
      </Card>
    </div>
  )
}

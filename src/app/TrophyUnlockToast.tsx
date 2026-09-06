import { useEffect, useState } from 'react'
import type { Trophy } from '@/db/types'
import { eventBus } from '@/shared/eventBus'
import { Button } from '@/design-system/ui'
import { useTrophyList } from '@/modules/trophies/hooks'
import { TIER_THEME } from '@/modules/trophies/TrophiesPage'

/**
 * PSN 风格奖杯解锁弹窗 —— 全局挂载于 AppLayout（Phase 6 全局化）
 * 任何页面触发 trophy:unlocked 都能弹出；5 秒自动关闭或点击关闭
 */
export default function TrophyUnlockToast() {
  const trophies = useTrophyList()
  const [unlockingId, setUnlockingId] = useState<string | null>(null)

  useEffect(() => {
    return eventBus.on('trophy:unlocked', ({ trophyId }) => setUnlockingId(trophyId))
  }, [])

  useEffect(() => {
    if (!unlockingId) return
    const timer = window.setTimeout(() => setUnlockingId(null), 5000)
    return () => window.clearTimeout(timer)
  }, [unlockingId])

  const trophy: Trophy | undefined = trophies.find((t) => t.id === unlockingId)
  if (!trophy) return null
  const theme = TIER_THEME[trophy.tier]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45" onClick={() => setUnlockingId(null)}>
      <div className={`rounded-2xl bg-gradient-to-br ${theme.gradient} p-1 shadow-2xl`}>
        <div className="flex w-[340px] flex-col items-center gap-4 rounded-2xl bg-surface-container-lowest px-8 py-10">
          <div className={`rounded-xl bg-gradient-to-tr ${theme.gradient} p-1`}>
            <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-surface-container-lowest">
              <span className={`material-symbols-rounded msr-fill ${theme.text}`} style={{ fontSize: 56 }}>
                {trophy.icon}
              </span>
            </div>
          </div>
          <div className="text-center">
            <div className={`text-[12px] font-bold uppercase tracking-[0.2em] ${theme.text}`}>
              {theme.label} · 已解锁
            </div>
            <div className="mt-1 text-[20px] font-bold">{trophy.name}</div>
            <div className="mt-1.5 text-[12.5px] text-on-surface-variant">{trophy.description}</div>
            <div className="mt-1 text-[11px] text-outline">稀有度 {trophy.rarity}</div>
          </div>
          <Button size="sm" variant="tonal" onClick={() => setUnlockingId(null)}>
            收下奖杯
          </Button>
        </div>
      </div>
    </div>
  )
}

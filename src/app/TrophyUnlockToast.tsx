import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import type { Trophy } from '@/db/types'
import { eventBus } from '@/shared/eventBus'
import { Button } from '@/design-system/ui'
import { useTrophyList } from '@/modules/trophies/hooks'
import { TIER_THEME } from '@/modules/trophies/TrophiesPage'

const TOAST_DURATION = 5000

/**
 * PSN 风格奖杯解锁弹窗 —— 全局挂载于 AppLayout（Phase 6 全局化）
 * 队列化（审计 P2-9）：多杯同时解锁逐个排队展示，每座 5 秒自动切下一座或点击收下
 */
export default function TrophyUnlockToast() {
  const trophies = useTrophyList()
  /** 待展示队列：队首为当前展示项 */
  const [queue, setQueue] = useState<string[]>([])

  useEffect(() => {
    return eventBus.on('trophy:unlocked', ({ trophyId }) =>
      setQueue((q) => (q.includes(trophyId) ? q : [...q, trophyId])),
    )
  }, [])

  const currentId = queue[0] ?? null

  // 队首展示 5s 后出队，自动轮到下一座
  useEffect(() => {
    if (!currentId) return
    const timer = window.setTimeout(() => setQueue((q) => q.slice(1)), TOAST_DURATION)
    return () => window.clearTimeout(timer)
  }, [currentId])

  const dismiss = () => setQueue((q) => q.slice(1))

  const trophy: Trophy | undefined = trophies.find((t) => t.id === currentId)
  if (!trophy) return null
  const theme = TIER_THEME[trophy.tier]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45"
      onClick={dismiss}
    >
      {queue.length > 1 && (
        <div className="absolute right-6 top-6 rounded-full bg-black/40 px-3 py-1 text-[0.8571rem] font-medium text-white">
          还有 {queue.length - 1} 座奖杯待展示
        </div>
      )}
      <div className={`rounded-2xl bg-gradient-to-br ${theme.gradient} p-1 shadow-2xl`}>
        <div className="flex w-[340px] flex-col items-center gap-4 rounded-2xl bg-surface-container-lowest px-8 py-10">
          <div className={`rounded-xl bg-gradient-to-tr ${theme.gradient} p-1`}>
            <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-surface-container-lowest">
              <Icon name={trophy.icon} fill size={56} className={theme.text} />
            </div>
          </div>
          <div className="text-center">
            <div className={`text-[0.8571rem] font-bold uppercase tracking-[0.2em] ${theme.text}`}>
              {theme.label} · 已解锁
            </div>
            <div className="mt-1 text-[1.4286rem] font-bold">{trophy.name}</div>
            <div className="mt-1.5 text-[0.8929rem] text-on-surface-variant">{trophy.description}</div>
            <div className="mt-1 text-[0.7857rem] text-outline">稀有度 {trophy.rarity}</div>
          </div>
          <Button size="sm" variant="tonal" onClick={dismiss}>
            收下奖杯
          </Button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Icon } from '@/design-system/Icon'
import type { Trophy } from '@/db/types'
import { eventBus } from '@/shared/eventBus'
import { Button } from '@/design-system/ui'
import { usePresence } from '@/shared/usePresence'
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

  const found: Trophy | undefined = trophies.find((t) => t.id === currentId)

  /**
   * 出场期间要「留着上一座的数据」再渲染。
   *
   * 为什么：dismiss 后 currentId 立即变空，若直接跟着它渲染，组件会在出场动画
   * 开始的那一帧就 return null —— 最后一座奖杯仍然是「啪」地消失，白做。
   * 所以留一份「最后一次拿到的奖杯」：只在 found 有值时更新（不写 undefined），
   * 渲染时 found 优先、为空则回退到它。用派生而不是在 effect 里判断 closing ——
   * 后者读到的 closing 是上一轮渲染的陈旧值，一样会闪空白帧。
   */
  const [lastShown, setLastShown] = useState<Trophy | undefined>(found)
  useEffect(() => {
    if (found) setLastShown(found)
  }, [found])

  const trophy = found ?? lastShown
  const { present, phase, ref } = usePresence(Boolean(found), 200)
  const closing = phase === 'out'

  if (!trophy || !present) return null
  const theme = TIER_THEME[trophy.tier]

  return (
    <div
      ref={ref}
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/45 ${
        closing ? 'anim-overlay-out' : 'anim-overlay-in'
      }`}
      onClick={dismiss}
    >
      {queue.length > 1 && (
        <div className="absolute right-6 top-6 rounded-full bg-black/40 px-3 py-1 text-[0.8571rem] font-medium text-white">
          还有 {queue.length - 1} 座奖杯待展示
        </div>
      )}
      {/* key 挂在这里：队列轮到下一座时整块重挂 → 入场动画重播。
          这是「多杯同时解锁逐个展示」能看出切换的关键（否则第二座是静默替换）。 */}
      <div
        key={trophy.id}
        className={`rounded-2xl bg-gradient-to-br ${theme.gradient} p-1 shadow-2xl ${
          closing ? 'anim-panel-out' : 'anim-pop'
        }`}
      >
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

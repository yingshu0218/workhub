import { trophyRepo } from '@/repositories'
import { eventBus } from '@/shared/eventBus'
import { collectTrophyStats, computeConditionValue } from './hooks'
import type { Trophy } from '@/db/types'

/**
 * 奖杯引擎 —— 事件驱动 + 启动全量检查（开发计划 Phase 5）
 * 条件一律从源记录推导（focusSessions/habitLogs/transactions/customers），不存同步快照。
 * 依赖事件：focus:completed {minutes} / habit:checked {habitId, date} /
 * transaction:created {transactionId}（死事件已接通，交易数条件实时评估）；
 * 另有启动时全量评估兜底。
 */

let installed = false
let evaluating = false
/** 评估期间有新事件到来 → 置脏，本轮结束后基于最新数据重跑一次（不丢弃事件） */
let dirty = false

/** 评估所有未解锁奖杯，达标者解锁并广播 trophy:unlocked */
export async function evaluateTrophies(): Promise<void> {
  if (evaluating) {
    dirty = true
    return
  }
  evaluating = true
  try {
    do {
      dirty = false
      const stats = await collectTrophyStats()
      const trophies = await trophyRepo.list()
      for (const trophy of trophies) {
        if (trophy.unlockedAt) continue // 已解锁不重复评估
        if (!trophy.conditionType || trophy.conditionValue == null) continue // 无条件奖杯跳过
        const current = computeConditionValue(trophy.conditionType, stats)
        if (current >= trophy.conditionValue) {
          // 以旧记录展开为基底解锁，保留 rarity/description/同步元数据
          const unlocked: Trophy = { ...trophy, unlockedAt: Date.now() }
          await trophyRepo.put(unlocked)
          eventBus.emit('trophy:unlocked', { trophyId: trophy.id })
        }
      }
    } while (dirty) // 评估期间有新事件 → 用最新源数据再评估一轮
  } catch (err) {
    console.error('[trophyEngine] 评估失败', err)
  } finally {
    evaluating = false
  }
}

/** 安装奖杯引擎（幂等）：监听专注完成/习惯打卡/交易创建事件 + 启动时全量检查一次 */
export function installTrophyEngine(): void {
  if (installed) return
  installed = true

  eventBus.on('focus:completed', () => void evaluateTrophies())
  eventBus.on('habit:checked', () => void evaluateTrophies())
  eventBus.on('transaction:created', () => void evaluateTrophies())
  void evaluateTrophies()
}

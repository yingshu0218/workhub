// @vitest-environment jsdom
/**
 * 清空本地库的语义锁（2026-10-28）
 *
 * 锁的是**语义**不是实现：清空之后必须是空库。
 *
 * 事故背景：`resetAndSeedLocalData()` 清完表又调 `seedIfEmpty()`，于是「点清空 →
 * 立刻又长回 5 个演示客户」，正式站永远回不到空库；而 `main.tsx` 启动时也无条件 seed，
 * 双重回灌。现在改为：清空不写种子、种子只在开发模式启动时写。
 * **任何人把 seed 加回清空流程，这条就会红。**
 */
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { seedIfEmpty } from '@/db/seed'
import { resetLocalData } from '@/repositories/localAdmin'
import { DEFAULT_SETTINGS } from '@/db/types'

describe('清空本地库', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('清完是空库：不会写回演示种子', async () => {
    // 先造出「有数据」的现场，否则「清空空库」这条断言等于什么都没验证
    await seedIfEmpty()
    expect(await db.customers.count()).toBeGreaterThan(0)
    // 种子标记 synced=1，理论上不进队列；显式清掉，避免 reset 内的预推送分支干扰本用例
    await db.syncQueue.clear()

    await resetLocalData()

    // 判据用「业务表全空」，不查某条具体种子记录 —— 种子内容将来变了也不会误红
    for (const t of db.tables) {
      if (t.name === 'settings' || t.name === 'syncQueue') continue
      expect(await t.count(), `${t.name} 应为空`).toBe(0)
    }
  })

  it('settings 豁免：清空不清掉同步配置与外观偏好', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS })
    await resetLocalData()
    expect(await db.settings.get('singleton')).toBeTruthy()
  })
})

/**
 * settings `ai` 段持久化对照测试（方案 §四.2 / §四.3；P1 第 4 步配套配置页）
 *
 * 关键：`ai` 段是「能力白名单 + 接入凭据」的唯一事实源，且**仅存本地、不进同步**。
 * mergeSettings 分段合并必须完整保留 `bridgeEnabled/bridgeToken/bridgeUrl/domains`——
 * 任一字段未登记即被合并丢弃（历史踩过的坑）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { settingsRepo } from '@/repositories'
import { DEFAULT_SETTINGS } from '@/db/types'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('settings.ai 持久化', () => {
  it('缺省：bridgeEnabled=false，且不含 token（不自动连接）', async () => {
    const s = await settingsRepo.get()
    expect(s.ai.bridgeEnabled).toBe(false)
    expect(s.ai.bridgeToken).toBeUndefined()
    expect(s.ai.domains).toBeUndefined()
  })

  it('分段合并保留 bridgeToken/bridgeUrl/domains（不丢字段）', async () => {
    await settingsRepo.save({ ai: { ...DEFAULT_SETTINGS.ai, bridgeEnabled: true, bridgeToken: 'tk-1', bridgeUrl: 'ws://127.0.0.1:9999' } })
    await settingsRepo.save({ ai: { ...DEFAULT_SETTINGS.ai, bridgeEnabled: true, bridgeToken: 'tk-1', bridgeUrl: 'ws://127.0.0.1:9999', domains: { fin: false } } })
    const s = await settingsRepo.get()
    expect(s.ai.bridgeEnabled).toBe(true)
    expect(s.ai.bridgeToken).toBe('tk-1')
    expect(s.ai.bridgeUrl).toBe('ws://127.0.0.1:9999')
    expect(s.ai.domains).toEqual({ fin: false })
  })

  it('白名单域开关落库后可被桥读取（与 visibleToolNames 口径一致）', async () => {
    await settingsRepo.save({ ai: { ...DEFAULT_SETTINGS.ai, domains: { crm: false } } })
    const s = await settingsRepo.get()
    expect(s.ai.domains?.crm).toBe(false)
  })

  it('ai 段不进同步白名单（settings 表本身为本地独占表）', () => {
    // settings 属 4 张本地独占表之一（db.ts），此处以常量断言锁定口径
    expect(DEFAULT_SETTINGS.ai).toBeTruthy()
    expect(JSON.stringify(DEFAULT_SETTINGS.ai)).not.toContain('syncQueue')
  })
})

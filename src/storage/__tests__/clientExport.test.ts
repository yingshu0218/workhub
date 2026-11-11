// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import 'fake-indexeddb/auto'
vi.mock('@/sync/clientSync', () => ({ pullClientChanges: async () => {} }))
import { db } from '@/db/db'
import { activateClientSession } from '../clientSession'
import { exportBusinessCopy } from '../clientExport'
it('业务副本先从完整活动快照建立旧别名映射，软删活动不泄漏冻结沟通原文', async () => {
  activateClientSession('export-privacy', 'export-generation', 6)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  await db.interactions.bulkPut([
    { id: 'mapped-legacy', content: 'PRIVATE FROZEN TEXT', deleted: 0 },
    { id: 'unmapped-legacy', content: '尚未迁移的独立历史', deleted: 0 },
  ] as never)
  await db.activities.put({
    id: 'canonical',
    sourceTable: 'interactions',
    sourceId: 'mapped-legacy',
    title: '删除的活动',
    summary: 'PRIVATE FROZEN TEXT',
    deleted: 1,
    rev: 2,
  } as never)
  const copy = await exportBusinessCopy()
  expect(copy.data.activities).toEqual([])
  expect(JSON.stringify(copy)).not.toContain('PRIVATE FROZEN TEXT')
  expect((copy.data.interactions as { id: string }[]).map((r) => r.id)).toEqual(['unmapped-legacy'])
})

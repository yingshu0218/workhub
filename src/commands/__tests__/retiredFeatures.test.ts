import { describe, expect, it } from 'vitest'
import { BUSINESS_TABLES, validateRetiredFeatureWrite, type Row, type Write } from '../core'
import { SYNC_TABLES } from '@/sync/remoteNormalize'

const historic: Record<string, Row> = {
  habits: { id: 'h1', name: '旧习惯', schedule: '每日', createdAt: 1, deleted: 0, rev: 2 },
  habitLogs: { id: 'hl1', habitId: 'h1', date: '2026-10-01', completedAt: 1, deleted: 0, rev: 2 },
  trophies: { id: 'tr1', name: '旧奖杯', unlockedAt: 1, deleted: 0, rev: 2 },
}
const put = (table: string, value: Row): Write => ({ table, id: value.id, kind: 'put', value })

describe.each(Object.keys(historic))('%s 退役写边界', (table) => {
  const prev = historic[table]
  it('表仍保留在命令与镜像协议，历史资料可读与导出', () => {
    expect(BUSINESS_TABLES).toContain(table)
    expect(SYNC_TABLES).toContain(table)
  })
  it('新建、普通更新、伪造恢复和空白墓碑都拒绝', () => {
    expect(() => validateRetiredFeatureWrite(put(table, prev), undefined)).toThrow('FEATURE_RETIRED')
    expect(() => validateRetiredFeatureWrite(put(table, { ...prev, rev: 3 }), prev)).toThrow('FEATURE_RETIRED')
    expect(() => validateRetiredFeatureWrite(put(table, { ...prev, restoredAt: 123 }), prev)).toThrow('FEATURE_RETIRED')
    expect(() => validateRetiredFeatureWrite(put(table, { ...prev, deleted: 1 }), undefined)).toThrow('FEATURE_RETIRED')
  })
  it('只允许已有记录纯生命周期删除/恢复，并保留既有清理路径', () => {
    const deleted = { ...prev, deleted: 1, deletedAt: 10, trashSnapshot: { children: [] }, rev: 3 }
    expect(() => validateRetiredFeatureWrite(put(table, deleted), prev)).not.toThrow()
    const restored = { ...deleted, deleted: 0, deletedAt: undefined, trashSnapshot: undefined, restoredAt: 20, rev: 4 }
    expect(() => validateRetiredFeatureWrite(put(table, restored), deleted)).not.toThrow()
    expect(() => validateRetiredFeatureWrite({ table, id: prev.id, kind: 'delete' }, deleted)).not.toThrow()
    // 不信任调用方声明的操作名；恢复时也不能顺带改正文、日期、归属或解锁时刻。
    for (const [field, value] of Object.entries(prev)) {
      if (['id', 'deleted', 'rev'].includes(field)) continue
      const changed = { ...restored, [field]: typeof value === 'number' ? Number(value) + 1 : String(value) + '改' }
      expect(() => validateRetiredFeatureWrite(put(table, changed), deleted), field).toThrow('FEATURE_RETIRED')
    }
    expect(() => validateRetiredFeatureWrite(put(table, { id: prev.id, deleted: 1 }), prev)).toThrow('FEATURE_RETIRED')
  })
})

it('其它业务写入不受功能退役影响', () => {
  expect(() => validateRetiredFeatureWrite(put('todos', { id: 'td1', title: '仍可新建' }), undefined)).not.toThrow()
})

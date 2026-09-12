/**
 * 防漂移回归（功能测试 #100 整改）：
 * Dexie 表名与 PocketBase 集合名必须一一对应（经 `pbCollection()` 映射后）。
 *
 * 背景：`moduleConfigs`（前端驼峰）与 `module_configs`（服务端下划线）不一致，
 * 而适配器直接拿表名拼集合 URL，导致该集合的拉取/推送/物理删除全部 404 ——
 * 界面看不出异常，只有抓网络层才发现（每次同步静默失败）。
 *
 * 本断言让「任一端改名」在 CI 被挡住，与 `skill.parity.test.ts` 锁 schema 漂移是同一手法。
 */
import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SYNC_TABLES, pbCollection } from '../pocketbaseAdapter'

interface PbCollection {
  name: string
}

/** 服务端集合契约（部署时导入 PB 的那份定义） */
function loadServerCollectionNames(): Set<string> {
  const file = path.resolve(process.cwd(), 'pb_setup/collections.json')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as PbCollection[]
  return new Set(raw.map((c) => c.name))
}

/** 归一化：忽略下划线与大小写差异，用于识别「同物异名」 */
const norm = (s: string) => s.replace(/_/g, '').toLowerCase()

describe('同步集合名与 PocketBase 契约一致', () => {
  const serverNames = loadServerCollectionNames()

  it('pb_setup/collections.json 可读且非空', () => {
    expect(serverNames.size).toBeGreaterThan(0)
  })

  it('SYNC_TABLES 每一项经 pbCollection 映射后都能在服务端集合中找到', () => {
    const missing = SYNC_TABLES.filter((t) => !serverNames.has(pbCollection(t))).map(
      (t) => `${t} → ${pbCollection(t)}（服务端无此集合）`,
    )
    expect(missing).toEqual([])
  })

  it('历史遗留映射显式锁定（moduleConfigs → module_configs）', () => {
    // 这条不是重复断言，而是防止有人「顺手清理」掉映射表后 404 复发
    expect(pbCollection('moduleConfigs')).toBe('module_configs')
  })

  it('未声明的同物异名不得存在（防止再出现一处 moduleConfigs 式漂移）', () => {
    const declaredTargets = new Set(
      SYNC_TABLES.filter((t) => pbCollection(t) !== t).map((t) => pbCollection(t)),
    )
    const orphans = SYNC_TABLES.flatMap((t) =>
      [...serverNames]
        .filter((n) => n !== t && norm(n) === norm(t) && !declaredTargets.has(n))
        .map((n) => `${t} ←→ ${n}（同物异名但未在 PB_COLLECTION_NAME 声明）`),
    )
    expect(orphans).toEqual([])
  })
})

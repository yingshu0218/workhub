import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 存储边界门禁（agentOps 服务端化 P1，方案 docs/agentOps服务端化方案.md §5.1）
 *
 * 防什么：执行链文件（executor / reads / resolver / domain / repository）此前十几处
 * 直用 Dexie（`db.*`），是服务端化（PocketBaseAdapter 注入）的最大阻碍。P1 已全部改经
 * StorageAdapter；本测试锁住「执行链不得再 import @/db/db 或直用 db.*」——
 * 新增代码若顺手直连，这里会立刻红，而不是等 P2 服务端注入时才炸。
 *
 * 口径（故意从宽到窄只锁执行链，不做全仓禁令）：
 * - `src/repositories/index.ts` **豁免**：settingsRepo / focusSessionRepo /
 *   restoreFromJson / resetAndSeedLocalData 是浏览器本地管理功能（设置读写、存档导入、
 *   清库重播种），不在 AI 执行链上，服务端执行器也不会调用它们；
 * - `src/storage/browser.ts` 豁免：它是 DexieAdapter 的**注册入口**（全仓唯一允许
 *   import @/db/db 的 storage 文件）；`storage/dexie.ts` 已是纯工厂（依赖注入，零 db）；
 * - `src/storage/pocketbase.ts` / `src/sync/remoteNormalize.ts` 豁免：服务端 adapter 与
 *   协议归一化（均零 db，boundary 反而是它们的保护对象）；
 * - 测试文件豁免（arrange 阶段直接操作 Dexie 是既有惯例，fake-indexeddb 驱动）。
 */

/** 执行链核心文件：相对 src/ 的路径清单（新增执行链文件必须登记到这里） */
const EXECUTION_CHAIN_FILES = [
  'agent/executor.ts',
  'agent/reads.ts',
  'agent/resolver.ts',
  'agent/serverReads.ts',
  'domain/index.ts',
  'repositories/repository.ts',
] as const

const SRC_ROOT = resolve(__dirname, '../..')

/** 剔除行注释与块注释（`db.` 出现在注释里不算直连） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('存储边界门禁：执行链禁直连 Dexie', () => {
  for (const rel of EXECUTION_CHAIN_FILES) {
    it(`${rel} 不 import @/db/db`, () => {
      const src = readFileSync(resolve(SRC_ROOT, rel), 'utf-8')
      expect(src, `${rel} 出现 @/db/db import（执行链必须走 @/storage/dexie）`).not.toMatch(
        /from ['"]@\/db\/db['"]/,
      )
    })

    it(`${rel} 代码体不直用 db.*`, () => {
      const src = stripComments(readFileSync(resolve(SRC_ROOT, rel), 'utf-8'))
      expect(src, `${rel} 出现 db. 直连（执行链必须走 storage.*）`).not.toMatch(/\bdb\./)
    })
  }
})

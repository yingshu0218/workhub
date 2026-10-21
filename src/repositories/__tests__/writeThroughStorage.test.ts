/**
 * 防漂移锁：模块层禁止直写 Dexie 事务（审计 P1 收口 · 2026-10-21）
 *
 * ## 为什么要有这条锁
 *
 * `AGENTS.md §4` 规定「`src/repositories/` 写入口唯一层」，但实测有 **7 个模块文件、约 30 个写函数**
 * 绕过仓储、直接 `db.transaction(...)` + `db.syncQueue.add(...)`。代码注释自称
 * 「模块内合法 Dexie 访问层」—— 属**知情偏离**，不是漏改。
 *
 * 危害不在功能（当前 Dexie 下行为正确），而在**既定架构目标**：
 * Repository 层刻意做成存储无关（Dexie / Tauri SQLite 可替换），而这些直写
 * **不会随 StorageAdapter 迁移** —— 换存储时它们会静默失效。这正是「单一事实源」
 * 要防的那类漂移：靠「每个函数都记得写对」维系的纪律，一定会再漂移。
 *
 * ## 判据
 *
 * 模块层（modules / app / shared）写库**一律经 `storage.transaction`**（StorageAdapter 原语），
 * 禁止出现 `db.transaction(`。读取（`db.<table>`、`db.todos.toArray()` 等）**不受限制** ——
 * 读路径不在本次收口范围（UI 查询走 useCollection / useQuery 已有既有约定）。
 *
 * 白名单式：允许清单为空。若将来确有必须直写 Dexie 的场景（例如 Dexie 专属能力），
 * 必须在此**逐条署名并写明理由**，不得放宽为正则例外。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** 收口范围：模块层（写库必须经 StorageAdapter） */
const GUARDED_DIRS = ['src/modules', 'src/app', 'src/shared']

/**
 * 允许直写 `db.transaction(` 的例外（相对仓库根的路径 → 理由）。
 * ⚠️ 刻意留空：如需新增，必须在此署名说明，不允许用正则放宽。
 */
const ALLOWED: Record<string, string> = {}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) return e === '__tests__' ? [] : walk(p)
    return /\.tsx?$/.test(p) ? [p] : []
  })
}

/** 命中真实事务调用（排除 `db.transactions` 这张表名） */
function findTransactionWrites(src: string): number[] {
  const lines: number[] = []
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // 注释行不计
    // `db.transaction(` 且其后不是 `s`（排除 db.transactions 表）
    if (/db\.transaction(?!s)\s*\(/.test(line)) lines.push(i + 1)
  })
  return lines
}

describe('防漂移锁：模块层写库必须经 storage.transaction（不得直写 db.transaction）', () => {
  it('src/modules / src/app / src/shared 下无 db.transaction 直写（白名单为空）', () => {
    const root = process.cwd()
    const offenders: string[] = []
    for (const dir of GUARDED_DIRS) {
      for (const file of walk(path.resolve(root, dir))) {
        const rel = path.relative(root, file)
        if (ALLOWED[rel]) continue
        const hits = findTransactionWrites(readFileSync(file, 'utf8'))
        for (const line of hits) offenders.push(`${rel}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * 反向校验（关键）：证明判据**真的能识别**「直写」这种形状，也能**放过**表名 `db.transactions`。
   * 若本用例变红，说明判据失效（例如负向断言写错），上面那条绿灯不可信。
   */
  it('反向校验：判据能识别直写、且不误报 db.transactions 表名', () => {
    const bad = `  await db.transaction('rw', [db.todos, db.syncQueue], async () => {})`
    const goodTable = `  const rows = await db.transactions.toArray()`
    const goodStorage = `  await storage.transaction(['todos', 'syncQueue'], async (tx) => {})`
    const comment = `  // 历史：曾用 db.transaction('rw', [...]) 直写`

    expect(findTransactionWrites(bad)).toEqual([1])
    expect(findTransactionWrites(goodTable)).toEqual([]) // 表名不算
    expect(findTransactionWrites(goodStorage)).toEqual([])
    expect(findTransactionWrites(comment)).toEqual([]) // 注释不算
  })
})
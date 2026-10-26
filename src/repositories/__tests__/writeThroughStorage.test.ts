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
 * ⚠️ 第二批收口范围（2026-10-21 补漏）：`src/repositories` 与 `src/sync` **也在收口面内**。
 *
 * 为什么此前漏了：第一版锁只扫 `src/modules|app|shared` —— 而 `repositories/localAdmin.ts`
 * 与 `sync/pocketbaseAdapter.ts` 同样是「业务写入口」，却因目录不同被整片放过。
 * **教训：按目录圈范围时，要问「还有哪些目录也承担同名职责」，而不是只看当时改过哪些文件。**
 *
 * 这两个目录的情况不同（不是全禁，而是「默认禁 + 逐条署名例外」）：
 * - `src/repositories/` 本身是**仓储实现层**，Dexie 直写有其正当位置（如需要 `bulkPut` 等
 *   StorageAdapter 未提供的能力）—— 故以 ALLOWED 逐条署名，不允许悄悄新增。
 * - `src/sync/` 是同步协议实现层，同理。
 *
 * ⚠️ 第三批补面（2026-10-26 审计）：`src/storage` 与 `src/db` 也承担「写库」职责，
 * 此前同样处于**扫描面之外** —— `storage/dexie.ts`（StorageAdapter 的 Dexie 实现）与
 * `db/seed.ts`（播种）的直写一直靠「目录没被扫」，而不是靠「逐条署名放行」。
 * 这与本文件头「必须逐条署名」的自我要求不符：**绿灯必须来自判据，不能来自盲区**。
 * （同类教训见上面第二批那段的「按目录圈范围时要反问还有哪些目录」；这次是它的复盘执行。）
 */
const GUARDED_DIRS_2 = ['src/repositories', 'src/sync', 'src/storage', 'src/db']

/**
 * 允许直写 `db.transaction(` 的例外（相对仓库根的路径 → 理由）。
 * ⚠️ 刻意留空：如需新增，必须在此署名说明，不允许用正则放宽。
 *
 * `src/modules|app|shared` 的白名单：**为空**（模块层无任何正当直写理由）。
 */
const ALLOWED: Record<string, string> = {}

/**
 * 第二类目录（repositories / sync）的署名例外 —— 逐条列出**确认为能力边界**的直写。
 *
 * ⚠️ 每条都必须写清「为什么不能经 StorageAdapter」，而不是「没来得及改」。
 */
const ALLOWED_IMPL: Record<string, string> = {
  'src/repositories/localAdmin.ts':
    'settingsRepo.save：settings 表主键是 `key`（非 `id`），与 StorageTx 的 `T extends { id: string }` ' +
    '约束类型不兼容；且它是本地 singleton、刻意不进同步队列，无「随 StorageAdapter 迁移」诉求。' +
    '（同文件另有 focusSessionRepo.bulkPut / restoreFromJson 用 bulkPut：StorageTx 无该原语。）',
  'src/storage/dexie.ts':
    '**它就是 StorageAdapter 的实现层**（DexieAdapter.transaction 把 StorageTx 原语直映射到 Dexie 原生事务）。' +
    '「不随适配器迁移」这条理由对它不成立 —— 换 Tauri SQLite 时替换的是整个文件，而不是要求它调用自己。',
  'src/db/seed.ts':
    '**DB 层播种**（seedLocalData）：建库后一次性写入种子数据，含 `db.transactions.bulkPut` 等' +
    ' StorageTx 未提供的能力；且它只在「空库首启」路径上跑，不在业务写链路内。',
  'src/repositories/__tests__/writeThroughStorage.test.ts': '本文件自身（判据里的示例字符串）',
}

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
   * 第二批：`src/repositories` 与 `src/sync` 的直写必须**逐条署名**（不在允许表里就是漂移）。
   *
   * 判据刻意做成「**报告所有未署名的直写点**」而不是「数量断言」——
   * 后者会在「删一处、加一处」时保持绿灯（数量没变），漏掉新漂移。
   */
  it('repositories / sync 下的直写均在署名例外表内（新直写必须署名）', () => {
    const root = process.cwd()
    const offenders: string[] = []
    for (const dir of GUARDED_DIRS_2) {
      for (const file of walk(path.resolve(root, dir))) {
        const rel = path.relative(root, file)
        const hits = findTransactionWrites(readFileSync(file, 'utf8'))
        if (hits.length === 0) continue
        // 该文件有直写：必须整体在署名表里（按文件粒度署名 —— 新增一处也需重新审视）
        if (ALLOWED_IMPL[rel]) continue
        for (const line of hits) offenders.push(`${rel}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * 反向校验：证明「署名表」机制真的生效（否则上面那条绿灯不可信）。
   */
  it('反向校验：未署名的直写会被点名，已署名的被放过', () => {
    const allowed = 'src/repositories/localAdmin.ts'
    const notAllowed = 'src/sync/pocketbaseAdapter.ts'
    expect(ALLOWED_IMPL[allowed]).toBeTruthy()
    // pocketbaseAdapter 已经收口（enqueueAllForPush 改为 storage.transaction）→ 不应在署名表里
    expect(ALLOWED_IMPL[notAllowed]).toBeUndefined()

    // 2026-10-26 补面：storage / db 必须在扫描面内**且各有署名** —— 否则绿灯来自盲区而非判据
    expect(GUARDED_DIRS_2).toContain('src/storage')
    expect(GUARDED_DIRS_2).toContain('src/db')
    expect(ALLOWED_IMPL['src/storage/dexie.ts']).toBeTruthy()
    expect(ALLOWED_IMPL['src/db/seed.ts']).toBeTruthy()
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
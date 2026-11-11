import { db } from '@/db/db'
import type { Attachment, FocusSession } from '@/db/db'
import type { Table } from 'dexie'
import type { Settings } from '@/db/types'
import { DEFAULT_SETTINGS } from '@/db/types'
import type { PutInput } from './repository'
import { storage } from '@/storage'
import { eventBus } from '@/shared/eventBus'

/**
 * 浏览器本地管理仓储（agentOps 服务端化 P3 自 repositories/index.ts 拆出）
 *
 * 拆出动机：settingsRepo / focusSessionRepo / resetLocalData / restoreFromJson
 * 直用 Dexie（db.*），而 index.ts 的执行链部分（repo 工厂 + 复合函数）必须保持零 db——
 * 服务端执行器 bundle（agent/serverReads.ts → executor → repositories）不能拖 Dexie。
 * 本文件**只在浏览器侧被引用**（UI/设置页/存档导入导出）；AI 执行链绝不 import 它。
 * 语义与原实现逐行一致。
 */

/**
 * 专注会话瞬态仓储（本地推导数据，不进同步队列 —— 开发计划 2.3）
 * 仅供导出/恢复使用，写入不走 repository.put（避免误盖章入队）
 */
export const focusSessionRepo = {
  list(): Promise<FocusSession[]> {
    return db.focusSessions.toArray()
  },
  async bulkPut(items: FocusSession[]): Promise<void> {
    if (items.length === 0) return
    await db.transaction('rw', [db.focusSessions], async () => {
      await db.focusSessions.bulkPut(items)
    })
  },
}


/**
 * 设置 singleton 仓储（Phase 6）—— 本地偏好，不进同步队列
 * 读：缺省段位用 DEFAULT_SETTINGS 补齐（前向兼容新增字段）
 * 写：单事务覆盖 settings 表（singleton + 事务），写后广播 settings:changed 由消费端实时应用
 */
const SETTINGS_TABLE = () =>
  db.settings as unknown as {
    get(key: string): Promise<Settings | undefined>
    put(value: Settings): Promise<string>
  }

function mergeSettings(prev: Settings | undefined): Settings {
  const base = prev ?? DEFAULT_SETTINGS
  return {
    ...DEFAULT_SETTINGS,
    ...base,
    key: 'singleton',
    appearance: { ...DEFAULT_SETTINGS.appearance, ...base.appearance },
    typography: { ...DEFAULT_SETTINGS.typography, ...base.typography },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...base.notifications },
    security: { ...DEFAULT_SETTINGS.security, ...base.security },
    sync: { ...DEFAULT_SETTINGS.sync, ...base.sync },
    notes: { ...DEFAULT_SETTINGS.notes, ...base.notes },
    // ai 段含 domains 子对象：整体展开即可（调用方按域传 patch，见 §四.3 能力白名单）
    ai: { ...DEFAULT_SETTINGS.ai, ...base.ai },
  }
}

export const settingsRepo = {
  async get(): Promise<Settings> {
    return mergeSettings(await SETTINGS_TABLE().get('singleton'))
  },

  /**
   * 契约修复（审计 Phase 6 P2-7）：
   * 1. get 移入 db.transaction 内 —— 读-并-写同事务，杜绝并发写互相覆盖；
   * 2. 段合并改为「DEFAULT 兜底 ← 旧值段展开 ← patch 段」三层合并，
   *    调用方只传段内单字段（如 { appearance: { accent } }）时不再抹掉段内其他字段。
   */
  // appearance 允许段内单字段 patch（类型层面放宽；运行时 mergeSettings 本就逐字段合并，
  // 画布主题切换只传 { canvasTheme } 不抹掉其它段内字段）
  async save(
    patch: Omit<Partial<Omit<Settings, 'key'>>, 'appearance'> & { appearance?: Partial<Settings['appearance']> },
  ): Promise<Settings> {
    /**
     * ⚠️ 本处**刻意保留** `db.transaction` 直写（2026-10-21 复核结论，非漏网）：
     *
     * `StorageTx` 的原语签名约束是 `T extends { id: string }`，而 **settings 表的主键是 `key`**
     * （`db.ts` 的 `settings: 'key'`，singleton 行 `key: 'singleton'`）—— 二者类型上不兼容。
     * 强行收口只能靠 `as unknown as` 骗过类型，那会让「存储无关」的名义收益**变成类型谎言**。
     *
     * 另：settings 是**本地 singleton、刻意不进同步队列**（见文件头「不进同步队列」），
     * 因此它也没有「随 StorageAdapter 迁移」的诉求 —— 迁移到 SQLite 时同样要处理主键差异。
     *
     * 结论：此为**能力边界**而非纪律漂移。已在防漂移锁里逐条署名放行
     * （`writeThroughStorage.test.ts` 的 ALLOWED）。
     */
    const merged = await db.transaction('rw', [db.settings], async () => {
      const prev = await SETTINGS_TABLE().get('singleton')
      const next: Settings = {
        ...DEFAULT_SETTINGS,
        ...prev,
        key: 'singleton',
        appearance: { ...DEFAULT_SETTINGS.appearance, ...prev?.appearance, ...patch.appearance },
        typography: { ...DEFAULT_SETTINGS.typography, ...prev?.typography, ...patch.typography },
        notifications: {
          ...DEFAULT_SETTINGS.notifications,
          ...prev?.notifications,
          ...patch.notifications,
        },
        security: { ...DEFAULT_SETTINGS.security, ...prev?.security, ...patch.security },
        sync: { ...DEFAULT_SETTINGS.sync, ...prev?.sync, ...patch.sync },
        notes: { ...DEFAULT_SETTINGS.notes, ...prev?.notes, ...patch.notes },
        // 新增段必须在此登记，否则段内单字段 patch 会整体丢失（本函数是段内展开合并）
        ai: { ...DEFAULT_SETTINGS.ai, ...prev?.ai, ...patch.ai },
      }
      await SETTINGS_TABLE().put(next)
      return next
    })
    // ⚠️ 事件永在事务之后（AGENTS.md §6.1）：emit 必须在 db.transaction **commit 之后**。
    // 此前 emit 写在事务体内（put 之后、commit 之前）—— 事务一旦回滚，订阅方（effects.ts
    // 的 applySettingsToDom、graph/themes.ts 的画布主题）已应用一份**未落库**的设置 = 幽灵状态。
    // 全仓其余 6 处 emit（repositories/index.ts、crm/intimacy/config.ts、quickCapture.ts）
    // 都严格在事务块之外，此处曾是唯一反例。
    eventBus.emit('settings:changed', { settings: merged })
    return merged
  },
}

/**
 * 危险区：清空本地数据库（设置页「数据与安全」用）
 * 契约修复（审计 Phase 6 P2-8）：
 * 1. settings 表豁免清空 —— 保留同步配置（serverUrl/账号）与外观偏好，清空后无需重新配置；
 * 2. 若同步队列存在未推送条目，先执行一次 syncNow 清空队列再重置，
 *    避免尚未推送的本地增量随库被清（配置同步后丢数据）；推送后仍有积压则中止清空。
 *
 * ⚠️ 2026-10-28 改动（用户拍板）：**清空后不再写入演示种子**。
 * 原先末尾会调 `seedIfEmpty()`，结果「点清空 → 立刻又长回 5 个演示客户」，
 * 正式站永远回不到空库。演示数据现在只在开发模式（`import.meta.env.DEV`）
 * 首次启动时由 `main.tsx` 写入；生产构建不写。函数名也随之从
 * `resetAndSeedLocalData` 改为 `resetLocalData` —— 名字里带 seed 就是在骗调用方。
 *
 * 动态 import 规避 db.ts ↔ seed.ts 的模块环；调用方负责自行 reload 刷新界面态
 */
export async function resetLocalData(): Promise<void> {
  const pendingBefore = await db.syncQueue.filter((p) => !p.sentAt).count()
  if (pendingBefore > 0) {
    // 浏览器本地管理功能（豁免清单）：动态 import 保持本文件服务端 bundle 可加载
    const { syncEngine } = await import('@/sync/engine')
    await syncEngine.syncNow('pre-reset')
    const pendingAfter = await db.syncQueue.filter((p) => !p.sentAt).count()
    if (pendingAfter > 0) {
      throw new Error(
        `仍有 ${pendingAfter} 条变更未能推送到服务器，已中止清空以保护数据。请检查网络或同步配置后重试。`,
      )
    }
  }
  // 逐表清空（settings 豁免），替代整库 delete，保留设置 singleton
  await Promise.all(db.tables.filter((t) => t.name !== 'settings').map((t) => t.clear()))
}


/**
 * JSON 存档恢复（设置页「数据与安全」导入迁移用）：
 * 校验导出格式 → 单事务逐表 bulkPut（保留记录自带的 updatedAt/rev/deleted 盖章）。
 * 覆盖语义：与本地同 id 的记录整体被存档版本覆盖。
 * 附件恢复：存档中附件以 base64 dataUrl 承载（导出时 Blob 不可 JSON 序列化），
 * 恢复时转回 Blob 写入 attachments 表。
 * 同步说明：最简恢复不逐条入同步队列（避免恢复一次洪泛队列），
 * 跨设备传播依赖「全量推送」入口（enqueueAllForPush）。
 * @returns 实际写入的记录总数
 */
const RESTORE_TABLES = [
  'workspaces',
  'customers',
  'interactions',
  'ledgers',
  'transactions',
  'todos',
  'notes',
  'quickNotes',
  'habits',
  'habitLogs',
  'trophies',
  'attachments',
  'focusSessions',
  'todoLists',
  'noteFolders',
  'projects',
  'projectMilestones',
  'moduleConfigs',
  // 关联层（Phase 2）：links 随存档往返（存档里没有也不影响 —— 空表跳过）
  'links',
] as const

/** base64 dataUrl → Blob（附件恢复用，不依赖网络） */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'application/octet-stream'
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * 存档附件行（dataUrl 承载）→ 本地附件记录（blob 承载）。
 *
 * 同步盖章**原样保留**（与其它表 bulkPut「保留记录自带 updatedAt/rev/deleted」同口径）：
 * 恢复一次存档不应把所有附件的时间戳重置，否则这批记录会整批输给远端旧版本（LWW），
 * 换设备后看起来像「导入的附件被回滚掉了」。
 */
function attachmentRowToRecord(row: Record<string, unknown>): PutInput<Attachment> | null {
  const { dataUrl, ...rest } = row
  const blob =
    typeof dataUrl === 'string' && dataUrl.startsWith('data:')
      ? dataUrlToBlob(dataUrl)
      : rest.blob instanceof Blob
        ? rest.blob
        : null
  if (!blob || typeof rest.id !== 'string') return null
  return {
    id: rest.id,
    name: typeof rest.name === 'string' ? rest.name : 'attachment',
    mime: typeof rest.mime === 'string' ? rest.mime : blob.type,
    size: typeof rest.size === 'number' ? rest.size : blob.size,
    blob,
    createdAt: typeof rest.createdAt === 'number' ? rest.createdAt : 0,
    ...(typeof rest.updatedAt === 'number' ? { updatedAt: rest.updatedAt } : {}),
    ...(typeof rest.rev === 'number' ? { rev: rest.rev } : {}),
    ...(rest.deleted === 0 || rest.deleted === 1 ? { deleted: rest.deleted } : {}),
  }
}

export async function restoreFromJson(payload: unknown): Promise<number> {
  if (import.meta.env.PROD) throw new Error('在线版本的恢复必须使用服务端隔离迁移流程；本地存档可导出核对，不覆盖服务器事实')
  const parsed = payload as {
    app?: string
    data?: Partial<Record<(typeof RESTORE_TABLES)[number], unknown[]>>
  } | null
  if (
    !parsed ||
    parsed.app !== 'nexus-workspace' ||
    !parsed.data ||
    typeof parsed.data !== 'object'
  ) {
    throw new Error('所选文件不是本工作台导出的 JSON 存档（缺少 app / data 字段）')
  }
  let count = 0
  await db.transaction(
    'rw',
    RESTORE_TABLES.map((t) => db[t] as unknown as Table),
    async () => {
      for (const name of RESTORE_TABLES) {
        const rows = parsed.data?.[name]
        if (!Array.isArray(rows) || rows.length === 0) continue
        const table = db[name] as unknown as { bulkPut(items: unknown[]): Promise<unknown> }
        if (name === 'attachments') {
          // 附件特殊通道：dataUrl → Blob 后写入，跳过无法落库的存档原行
          const records = rows
            .map((r) => attachmentRowToRecord(r as Record<string, unknown>))
            .filter((r): r is PutInput<Attachment> => r !== null)
          if (records.length === 0) continue
          await table.bulkPut(records)
          count += records.length
        } else {
          await table.bulkPut(rows)
          count += rows.length
        }
      }
    },
  )
  storage.requestSync()
  return count
}


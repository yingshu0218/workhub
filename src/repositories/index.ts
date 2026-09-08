import { db } from '@/db/db'
import { syncEngine } from '@/sync/engine'
import { createRepository, newId } from './repository'
import type { PutInput } from './repository'
import type { Table } from 'dexie'
import type {
  Customer,
  Interaction,
  Ledger,
  Transaction,
  Todo,
  Note,
  QuickNote,
  Habit,
  HabitLog,
  Trophy,
  Workspace,
  Settings,
} from '@/db/types'
import { DEFAULT_SETTINGS } from '@/db/types'
import type { SyncMeta } from '@/db/types'
import type { Attachment, FocusSession } from '@/db/db'
import { eventBus } from '@/shared/eventBus'

/** 模块统一从这里拿仓储实例，不直接触碰 Dexie */
export const workspaceRepo = createRepository<Workspace>('workspaces')
export const customerRepo = createRepository<Customer>('customers')
export const interactionRepo = createRepository<Interaction>('interactions')
export const ledgerRepo = createRepository<Ledger>('ledgers')
export const transactionRepo = createRepository<Transaction>('transactions')
export const todoRepo = createRepository<Todo>('todos')
export const noteRepo = createRepository<Note>('notes')
export const quickNoteRepo = createRepository<QuickNote>('quickNotes')
export const habitRepo = createRepository<Habit>('habits')
export const habitLogRepo = createRepository<HabitLog>('habitLogs')
export const trophyRepo = createRepository<Trophy>('trophies')
export const todoListRepo = createRepository<import('@/db/types').TodoList>('todoLists')
export const noteFolderRepo = createRepository<import('@/db/types').NoteFolder>('noteFolders')
export const projectRepo = createRepository<import('@/db/types').Project>('projects')
export const projectMilestoneRepo =
  createRepository<import('@/db/types').ProjectMilestone>('projectMilestones')
export const attachmentRepo = createRepository<Attachment>('attachments')

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

export { newId }

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
  async save(patch: Partial<Omit<Settings, 'key'>>): Promise<Settings> {
    return db.transaction('rw', [db.settings], async () => {
      const prev = await SETTINGS_TABLE().get('singleton')
      const merged: Settings = {
        ...DEFAULT_SETTINGS,
        ...prev,
        key: 'singleton',
        appearance: { ...DEFAULT_SETTINGS.appearance, ...prev?.appearance, ...patch.appearance },
        typography: { ...DEFAULT_SETTINGS.typography, ...prev?.typography, ...patch.typography },
        notifications: { ...DEFAULT_SETTINGS.notifications, ...prev?.notifications, ...patch.notifications },
        security: { ...DEFAULT_SETTINGS.security, ...prev?.security, ...patch.security },
        sync: { ...DEFAULT_SETTINGS.sync, ...prev?.sync, ...patch.sync },
      }
      await SETTINGS_TABLE().put(merged)
      eventBus.emit('settings:changed', { settings: merged })
      return merged
    })
  },
}

/**
 * 危险区：清空本地数据库并重新写入演示种子（设置页「数据与安全」用）
 * 契约修复（审计 Phase 6 P2-8）：
 * 1. settings 表豁免清空 —— 保留同步配置（serverUrl/账号）与外观偏好，清空后无需重新配置；
 * 2. 若同步队列存在未推送条目，先执行一次 syncNow 清空队列再重置，
 *    避免尚未推送的本地增量随库被清（配置同步后丢数据）；推送后仍有积压则中止清空。
 * 动态 import 规避 db.ts ↔ seed.ts 的模块环；调用方负责自行 reload 刷新界面态
 */
export async function resetAndSeedLocalData(): Promise<void> {
  const pendingBefore = await db.syncQueue.filter((p) => !p.sentAt).count()
  if (pendingBefore > 0) {
    await syncEngine.syncNow('pre-reset')
    const pendingAfter = await db.syncQueue.filter((p) => !p.sentAt).count()
    if (pendingAfter > 0) {
      throw new Error(`仍有 ${pendingAfter} 条变更未能推送到服务器，已中止清空以保护数据。请检查网络或同步配置后重试。`)
    }
  }
  // 逐表清空（settings 豁免），替代整库 delete，保留设置 singleton
  await Promise.all(
    db.tables
      .filter((t) => t.name !== 'settings')
      .map((t) => t.clear()),
  )
  const { seedIfEmpty } = await import('@/db/seed')
  await seedIfEmpty()
}

/** 习惯打卡确定性 id：同日同习惯恒为同一条记录（幂等，杜绝重复打卡/幽灵记录） */
export function habitLogId(habitId: string, date: string): string {
  return `hl-${habitId}-${date}`
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
  'workspaces', 'customers', 'interactions', 'ledgers', 'transactions',
  'todos', 'notes', 'quickNotes', 'habits', 'habitLogs', 'trophies',
  'attachments', 'focusSessions', 'todoLists', 'noteFolders',
  'projects', 'projectMilestones',
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

/** 存档附件行（dataUrl 承载）→ 本地附件记录（blob 承载） */
function attachmentRowToRecord(row: Record<string, unknown>): Attachment | null {
  const { dataUrl, ...rest } = row
  const blob = typeof dataUrl === 'string' && dataUrl.startsWith('data:')
    ? dataUrlToBlob(dataUrl)
    : (rest.blob instanceof Blob ? rest.blob : null)
  if (!blob || typeof rest.id !== 'string') return null
  return {
    id: rest.id,
    refType: typeof rest.refType === 'string' ? rest.refType : '',
    refId: typeof rest.refId === 'string' ? rest.refId : '',
    name: typeof rest.name === 'string' ? rest.name : 'attachment',
    mime: typeof rest.mime === 'string' ? rest.mime : blob.type,
    size: typeof rest.size === 'number' ? rest.size : blob.size,
    blob,
    createdAt: typeof rest.createdAt === 'number' ? rest.createdAt : 0,
  }
}

export async function restoreFromJson(payload: unknown): Promise<number> {
  const parsed = payload as {
    app?: string
    data?: Partial<Record<(typeof RESTORE_TABLES)[number], unknown[]>>
  } | null
  if (!parsed || parsed.app !== 'nexus-workspace' || !parsed.data || typeof parsed.data !== 'object') {
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
            .filter((r): r is Attachment => r !== null)
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
  syncEngine.requestSync()
  return count
}

/**
 * 习惯级联删除：单 Dexie 事务覆盖 habits / habitLogs / syncQueue 三表，
 * 任一步失败整体回滚。语义：
 * 1. 软删习惯（盖章 + 入队 delete）
 * 2. 软删该习惯全部打卡日志（盖章 + 入队 delete）
 * 习惯不存在时静默返回（幂等），其余记录已属事务内一致状态。
 */
export async function deleteHabitCascade(habitId: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', [db.habits, db.habitLogs, db.syncQueue], async () => {
    const prevHabit = await db.habits.get(habitId)
    if (!prevHabit || prevHabit.deleted) return

    await db.habits.update(habitId, {
      deleted: 1,
      updatedAt: now,
      rev: prevHabit.rev + 1,
    })
    await db.syncQueue.add({
      table: 'habits',
      recordId: habitId,
      op: 'delete',
      createdAt: now,
    })

    const logs = await db.habitLogs
      .where('habitId')
      .equals(habitId)
      .filter((l) => !l.deleted)
      .toArray()
    for (const log of logs) {
      await db.habitLogs.update(log.id, {
        deleted: 1,
        updatedAt: now,
        rev: log.rev + 1,
      })
      await db.syncQueue.add({
        table: 'habitLogs',
        recordId: log.id,
        op: 'delete',
        createdAt: now,
      })
    }
  })
  syncEngine.requestSync()
}

/**
 * 交易 + 附件存根原子落库：单 Dexie 事务覆盖 transactions / attachments / syncQueue 三表，
 * 任一步失败整体回滚（避免"交易已落库而附件写入失败"的半成品数据）。
 * 每条记录统一盖章 updatedAt/rev/deleted 并入同步队列，语义与 repository.put 一致。
 */
export async function saveTransactionWithAttachments(
  txn: PutInput<Transaction>,
  attachments: PutInput<Attachment>[] = [],
): Promise<string> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.transactions, db.attachments, db.syncQueue],
    async () => {
      const putStamped = async <T extends { id: string }>(
        tableName: 'transactions' | 'attachments',
        record: T & Partial<SyncMeta>,
      ) => {
        const table = db[tableName] as unknown as {
          get(id: string): Promise<(T & SyncMeta) | undefined>
          put(value: T): Promise<string>
        }
        const prev = await table.get(record.id)
        await table.put({
          ...record,
          updatedAt: now,
          rev: (prev?.rev ?? 0) + 1,
          deleted: 0 as const,
        } as T)
        await db.syncQueue.add({
          table: tableName,
          recordId: record.id,
          op: 'upsert',
          createdAt: now,
        })
      }
      await putStamped('transactions', txn as Transaction & Partial<SyncMeta>)
      for (const att of attachments) {
        await putStamped('attachments', att as Attachment & Partial<SyncMeta>)
      }
    },
  )
  syncEngine.requestSync()
  return txn.id
}

/**
 * 沟通日志 + 客户最近联系时间原子落库：单 Dexie 事务覆盖 interactions / customers / syncQueue 三表，
 * 任一步失败整体回滚（避免"日志已落库而 lastContactAt 未刷新"的数据不一致）。
 * 客户侧先 get 最新记录再仅 update lastContactAt 单字段（禁止整记录展开覆盖并发写入的其他字段）。
 */
export async function saveInteractionAndTouchCustomer(
  interaction: PutInput<Interaction>,
  customerId: string,
): Promise<string> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.interactions, db.customers, db.syncQueue],
    async () => {
      const interactionTable = db.interactions as unknown as {
        get(id: string): Promise<(Interaction & SyncMeta) | undefined>
        put(value: Interaction): Promise<string>
      }
      const prevInteraction = await interactionTable.get(interaction.id)
      await interactionTable.put({
        ...interaction,
        updatedAt: now,
        rev: (prevInteraction?.rev ?? 0) + 1,
        deleted: 0 as const,
      } as Interaction)
      await db.syncQueue.add({
        table: 'interactions',
        recordId: interaction.id,
        op: 'upsert',
        createdAt: now,
      })

      const prevCustomer = await db.customers.get(customerId)
      if (!prevCustomer || prevCustomer.deleted) {
        // 客户不存在/已删除：抛错让整个事务回滚，杜绝孤儿日志
        throw new Error(`saveInteractionAndTouchCustomer: customer ${customerId} not found`)
      }
      await db.customers.update(customerId, {
        lastContactAt: interaction.at,
        updatedAt: now,
        rev: prevCustomer.rev + 1,
      })
      await db.syncQueue.add({
        table: 'customers',
        recordId: customerId,
        op: 'upsert',
        createdAt: now,
      })
    },
  )
  syncEngine.requestSync()
  return interaction.id
}

/**
 * 客户级联删除：单 Dexie 事务覆盖 customers / interactions / transactions / todos / syncQueue 五表，
 * 任一步失败整体回滚。语义：
 * 1. 软删客户（盖章 + 入队 delete）
 * 2. 软删该客户全部沟通日志（盖章 + 入队 delete）
 * 3. 解绑该客户名下交易/待办/项目：customerId 置 undefined（盖章 + 入队 upsert）
 *    —— projects.customerId 必须一并解绑，否则关系画布会出现「边指向已删除客户节点」的悬挂引用（崩溃根因）。
 * 客户不存在时静默返回（幂等），其余记录已属事务内一致状态。
 */
export async function deleteCustomerCascade(customerId: string): Promise<void> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.customers, db.interactions, db.transactions, db.todos, db.projects, db.syncQueue],
    async () => {
      const prevCustomer = await db.customers.get(customerId)
      if (!prevCustomer || prevCustomer.deleted) return

      await db.customers.update(customerId, {
        deleted: 1,
        updatedAt: now,
        rev: prevCustomer.rev + 1,
      })
      await db.syncQueue.add({
        table: 'customers',
        recordId: customerId,
        op: 'delete',
        createdAt: now,
      })

      const interactions = await db.interactions
        .where('customerId')
        .equals(customerId)
        .filter((it) => !it.deleted)
        .toArray()
      for (const it of interactions) {
        await db.interactions.update(it.id, {
          deleted: 1,
          updatedAt: now,
          rev: it.rev + 1,
        })
        await db.syncQueue.add({
          table: 'interactions',
          recordId: it.id,
          op: 'delete',
          createdAt: now,
        })
      }

      const txns = await db.transactions
        .where('customerId')
        .equals(customerId)
        .toArray()
      for (const txn of txns) {
        if (txn.deleted) continue
        await db.transactions.update(txn.id, {
          customerId: undefined,
          updatedAt: now,
          rev: txn.rev + 1,
        })
        await db.syncQueue.add({
          table: 'transactions',
          recordId: txn.id,
          op: 'upsert',
          createdAt: now,
        })
      }

      const todos = await db.todos
        .where('customerId')
        .equals(customerId)
        .toArray()
      for (const todo of todos) {
        if (todo.deleted) continue
        await db.todos.update(todo.id, {
          customerId: undefined,
          updatedAt: now,
          rev: todo.rev + 1,
        })
        await db.syncQueue.add({
          table: 'todos',
          recordId: todo.id,
          op: 'upsert',
          createdAt: now,
        })
      }

      // 解绑名下项目：项目不随客户消失，只清挂靠关系（弱引用语义，画布/CRM 下钻不悬挂）
      const projects = await db.projects
        .where('customerId')
        .equals(customerId)
        .toArray()
      for (const proj of projects) {
        if (proj.deleted) continue
        await db.projects.update(proj.id, {
          customerId: undefined,
          updatedAt: now,
          rev: proj.rev + 1,
        })
        await db.syncQueue.add({
          table: 'projects',
          recordId: proj.id,
          op: 'upsert',
          createdAt: now,
        })
      }
    },
  )
  syncEngine.requestSync()
}

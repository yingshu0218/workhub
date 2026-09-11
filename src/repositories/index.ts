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
  ModuleConfig,
  RelationCategory,
} from '@/db/types'
import { DEFAULT_SETTINGS } from '@/db/types'
import type { SyncMeta } from '@/db/types'
import type { Attachment, FocusSession } from '@/db/db'
import { eventBus } from '@/shared/eventBus'
import { txnCustomerIds, toLinkField } from '@/modules/finance/links'

/**
 * 关联字段「置空即删键」的更新补丁（Dexie update 语义：显式 undefined 才删键）。
 * 数组化后不能直接写 `customerIds: []` —— 空数组会被序列化进库、与服务端 json 字段
 * 形成"有键但空"的噪声态；统一走 `toLinkField`：有空键则写值，无关联则置 undefined 清键。
 */
function toLinkFieldPatch(
  key: 'customerIds' | 'todoIds' | 'projectIds',
  ids: string[],
): Record<string, string[] | undefined> {
  return { [key]: toLinkField(ids) }
}

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
export const moduleConfigRepo = createRepository<ModuleConfig>('moduleConfigs')
export const customerGroupRepo =
  createRepository<import('@/db/types').CustomerGroup>('customerGroups')

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
export { txnCustomerIds, txnProjectIds } from '@/modules/finance/links'
export { toLinkFieldPatch }

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
  async save(patch: Partial<Omit<Settings, 'key'>>): Promise<Settings> {
    return db.transaction('rw', [db.settings], async () => {
      const prev = await SETTINGS_TABLE().get('singleton')
      const merged: Settings = {
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
      throw new Error(
        `仍有 ${pendingAfter} 条变更未能推送到服务器，已中止清空以保护数据。请检查网络或同步配置后重试。`,
      )
    }
  }
  // 逐表清空（settings 豁免），替代整库 delete，保留设置 singleton
  await Promise.all(db.tables.filter((t) => t.name !== 'settings').map((t) => t.clear()))
  const { seedIfEmpty } = await import('@/db/seed')
  await seedIfEmpty()
}

/**
 * 默认账本唯一性收口（P1 补强 · 第 4/7 步跨轮一致性）：
 *
 * 现状是 UI（`LedgerFormDrawer.save()`）与 agentOps（`fin_createLedger`）**各自内联**同一段
 * 「先清其它账本 isDefault 再落库」，属 §9.7 第 3 步注同款「全仓重复的内联约定」——
 * 两处一旦漂移（如漏掉某一侧、或某侧漏传 updatedAt/rev）就会出现「两个默认账本」，
 * 而 `TransactionFormDrawer` 的记账缺省账本取 `ledgers.find(l => l.isDefault)` 是**取第一个命中**，
 * 双默认下记账会静默挂到不确定的账本上。故收口为唯一实现，两路共用。
 *
 * 语义与 UI 完全一致：只清「非自身」的默认标记；清标记走 ledgerRepo.put（自动盖章 + 入队）。
 */
export async function clearOtherDefaultLedgers(keepId?: string): Promise<void> {
  const now = Date.now()
  const others = (await db.ledgers.toArray()).filter(
    (l) => !l.deleted && l.isDefault && l.id !== keepId,
  )
  for (const l of others) {
    const { isDefault: _drop, ...rest } = l
    await ledgerRepo.put({ ...rest, updatedAt: now, rev: l.rev + 1 })
  }
}

/** 习惯打卡确定性 id：同日同习惯恒为同一条记录（幂等，杜绝重复打卡/幽灵记录） */
export function habitLogId(habitId: string, date: string): string {
  return `hl-${habitId}-${date}`
}

/**
 * 习惯打卡 / 取消打卡 —— 领域命令单点收口（方案 §9.6.1 / §9.7 第 5 步）。
 *
 * 收口前「打卡」逻辑内联重复在 3 处（`HabitsPage` 手工 toggle / `dashboard/cards` HabitLoopCard /
 * `shared/effects` 专注→习惯联动），各自 `put` + `emit('habit:checked')`，存在漂移风险：
 * 任一处漏 emit 或软删按 `existing.id` 而非确定性 `habitLogId` 派生 id，同一习惯就会出现
 * 「一条记录两套删除语义」。本函数把语义收敛为唯一一份。
 *
 * 幂等口径（§2.3 skill 幂等语义）：
 * - `checkinHabit` 只在**实际新建**（或软删后原地复活）时 emit `habit:checked`，已存在即 `{ created: false }` 且不 emit；
 * - 事件在**事务 commit 之后**发出（与 §2.1 事件纪律一致）；
 * - `uncheckHabit` 软删确定性 id，**不 emit**（取消不是「打卡成功」）；
 * - 打卡为空操作（新建/复活/已存在）语义由返回值 `{ created }` 表达，供调用方与测试观察。
 *
 * @param date YYYY-MM-DD；缺省为业务日（由调用方传入，保持与 UI「今天」口径同源）
 * @param opts.evidence 专注联动证据文案（`shared/effects` 传入）
 */
export async function checkinHabit(
  habitId: string,
  date: string,
  opts: { evidence?: string } = {},
): Promise<{ created: boolean }> {
  const id = habitLogId(habitId, date)
  const prev = await habitLogRepo.get(id)
  // 已存在（未软删）→ 幂等空操作，不落库不 emit
  if (prev) return { created: false }
  await habitLogRepo.put({
    id,
    habitId,
    date,
    completedAt: Date.now(),
    ...(opts.evidence ? { evidence: opts.evidence } : {}),
  } as PutInput<HabitLog>)
  // 事务 commit 之后 emit（仅实际新建/复活时）
  eventBus.emit('habit:checked', { habitId, date })
  return { created: true }
}

/** 取消打卡：软删确定性 id 派生的记录；不 emit `habit:checked`（§9.6.1 收口口径） */
export async function uncheckHabit(habitId: string, date: string): Promise<void> {
  await habitLogRepo.softDelete(habitLogId(habitId, date))
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
  const blob =
    typeof dataUrl === 'string' && dataUrl.startsWith('data:')
      ? dataUrlToBlob(dataUrl)
      : rest.blob instanceof Blob
        ? rest.blob
        : null
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
 *
 * **事件下沉（P1 第 2 步 / §2.1 事件纪律）**：`transaction:created` 在此统一发出，替代原先
 * UI（TransactionFormDrawer）内联 emit。落点是 repositories 层，时机是**事务 commit 之后**
 * （事务体之外的同一函数出口），永不进事务体。
 *
 * **create 门控（§2.1 边界① / §9.5 bug1）**：仅**新 id**（事务开始前该记录不存在）才 emit，
 * 编辑既有流水不再误发（旧实现编辑模式也会 emit，重复触发奖杯评估）。
 * 判断依据为事务内 `prev` 是否存在；返回值 `created` 供调用方与对照测试观察。
 */
export async function saveTransactionWithAttachments(
  txn: PutInput<Transaction>,
  attachments: PutInput<Attachment>[] = [],
): Promise<{ id: string; created: boolean }> {
  const now = Date.now()
  let created = false
  await db.transaction('rw', [db.transactions, db.attachments, db.syncQueue], async () => {
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
    // create 门控判据：事务开始前交易记录是否已存在（edited 既有记录 → prev 有值 → 不发事件）
    const prevTxn = await db.transactions.get(txn.id)
    created = !prevTxn || !!prevTxn.deleted
    await putStamped('transactions', txn as Transaction & Partial<SyncMeta>)
    for (const att of attachments) {
      await putStamped('attachments', att as Attachment & Partial<SyncMeta>)
    }
  })
  // 事务 commit 之后：仅在新建时发送事件（载荷与旧 UI 内联 emit 逐字段一致，无多余字段）
  if (created) {
    eventBus.emit('transaction:created', {
      transactionId: txn.id,
      // 事件载荷保持单值口径（Issue #140）：下游订阅方（灵感引擎失效、AI 事件流）按单值消费，
      // 多关联时代取首个关联客户即可表达"这笔钱和谁有关"，不放大事件契约的破坏面。
      customerId: txnCustomerIds(txn)[0],
    })
  }
  syncEngine.requestSync()
  return { id: txn.id, created }
}

/**
 * 沟通日志 + 客户最近联系时间原子落库：单 Dexie 事务覆盖 interactions / customers / syncQueue 三表，
 * 任一步失败整体回滚（避免"日志已落库而 lastContactAt 未刷新"的数据不一致）。
 * 客户侧先 get 最新记录再仅 update lastContactAt 单字段（禁止整记录展开覆盖并发写入的其他字段）。
 *
 * `touchAt`（可选，默认 = interaction.at）：客户侧「最近联系时间」的落库值。
 * 传入它允许调用方把「日志真实时间」与「客户最近联系时间」解耦 —— agentOps 补录历史沟通时
 * 用 `max(prev, at)` 避免把 lastContactAt 拉回过去（否则客户久未跟进提醒永久静默）。
 * 缺省行为与历史完全一致（= interaction.at），UI 两个入口不受影响。
 *
 * **事件下沉（P1 第 2 步 / §2.1 边界②）**：`customer:contacted` 在此统一发出，替代原先
 * 仅 CustomerDetailPage 内联 emit 的孤例。项目跟进（ProjectDetailPage）经本函数落库时
 * 同样获得事件（v0.3 裁决：项目跟进也算客户联系），消除「同一函数两条调用路径只一侧发事件」的漂移。
 * 时机为**事务 commit 之后**（函数出口），永不进事务体。`customer:contacted` 是孤儿事件（无消费者），
 * 对照测试降级为「emit 调用发生」级断言（§七.1）。
 */
export async function saveInteractionAndTouchCustomer(
  interaction: PutInput<Interaction>,
  customerId: string,
  touchAt?: number,
): Promise<string> {
  const now = Date.now()
  await db.transaction('rw', [db.interactions, db.customers, db.syncQueue], async () => {
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
      lastContactAt: touchAt ?? interaction.at,
      updatedAt: now,
      rev: prevCustomer.rev + 1,
    })
    await db.syncQueue.add({
      table: 'customers',
      recordId: customerId,
      op: 'upsert',
      createdAt: now,
    })
  })
  // 事务 commit 之后：统一 emit（UI 两个入口 + agentOps 都经此，单点收口）
  eventBus.emit('customer:contacted', { customerId })
  syncEngine.requestSync()
  return interaction.id
}

/**
 * 客户关系新增：**双向落两侧**（v0.2 裁决——存储只在各自 `relations[]` 内保存一条，
 * 客户详情页只读自己的 relations，故 A/B 两侧都要写，B 侧才看得到）。
 *
 * 单事务覆盖 customers + syncQueue；任一步失败整体回滚。
 * 单一来源：UI（CustomerFormDrawer 编辑态）与 agentOps（crm_addRelation）**都经此**，
 * 避免「各写一份盖章/入队」漂移（此前 agent 侧手写 update+syncQueue.add，
 * 漏了 syncEngine.requestSync()，只能等 30s 心跳才推送，且与 repository 盖章口径两套实现）。
 *
 * @returns `{ relationId, deduped }`；同 `目标 + 语义` 已存在时幂等返回既有关系（deduped=true）
 */
export async function addCustomerRelation(
  customerId: string,
  targetId: string,
  label: string,
  category?: RelationCategory,
): Promise<{ relationId: string; deduped: boolean }> {
  if (customerId === targetId) throw new Error('addCustomerRelation: 不能与自身建立关系')
  const now = Date.now()
  let relationId = ''
  let deduped = false
  await db.transaction('rw', [db.customers, db.syncQueue], async () => {
    const [a, b] = await Promise.all([db.customers.get(customerId), db.customers.get(targetId)])
    if (!a || a.deleted) throw new Error(`addCustomerRelation: customer ${customerId} not found`)
    if (!b || b.deleted) throw new Error(`addCustomerRelation: customer ${targetId} not found`)

    // 同 目标+语义 判重（与 UI 同款纪律，Issue #39）：命中即幂等返回，不重复写
    const aRels = a.relations ?? []
    const existing = aRels.find((r) => r.targetId === targetId && r.label === label)
    if (existing) {
      // 旧数据可能无 id（Issue #39 前落库的条目）：有则复用，无则按目标+语义回填一个稳定 id
      relationId = existing.id ?? newId('rel')
      deduped = true
      return
    }

    relationId = newId('rel')
    await db.customers.update(a.id, {
      relations: [
        ...aRels,
        { id: relationId, targetId, label, ...(category ? { category } : {}) },
      ],
      updatedAt: now,
      rev: a.rev + 1,
    })
    await db.syncQueue.add({ table: 'customers', recordId: a.id, op: 'upsert', createdAt: now })

    const bRels = b.relations ?? []
    await db.customers.update(b.id, {
      // B 侧反向写回 A：无该关系才写（防重复调用把 B 侧写重）
      relations: bRels.some((r) => r.targetId === a.id && r.label === label)
        ? bRels
        : [...bRels, { id: newId('rel'), targetId: a.id, label, ...(category ? { category } : {}) }],
      updatedAt: now,
      rev: b.rev + 1,
    })
    await db.syncQueue.add({ table: 'customers', recordId: b.id, op: 'upsert', createdAt: now })
  })
  syncEngine.requestSync()
  return { relationId, deduped }
}

/**
 * 客户级联删除：单 Dexie 事务覆盖 customers / interactions / transactions / todos / syncQueue 五表，
 * 任一步失败整体回滚。语义：
 * 1. 软删客户（盖章 + 入队 delete）
 * 2. 软删该客户全部沟通日志（盖章 + 入队 delete）
 * 3. 解绑该客户名下交易/待办/项目：customerId 置 undefined（盖章 + 入队 upsert）
 *    —— projects.customerId 必须一并解绑，否则关系画布会出现「边指向已删除客户节点」的悬挂引用（崩溃根因）。
 * 4. 解绑其它客户 relations 里指向被删者的条目（双向弱引用清理），否则全景图/聚焦图再次悬挂。
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

      // transactions 关联已数组化（Issue #140 v11）：去掉 customerId 索引，改内存过滤。
      // 理由见 db.ts v11 注释（避开 multiEntry 与同步队列整体覆盖语义的兼容坑，本表数据量级小）。
      const txns = (await db.transactions.filter((t) => !t.deleted).toArray()).filter((t) =>
        txnCustomerIds(t).includes(customerId),
      )
      for (const txn of txns) {
        await db.transactions.update(txn.id, {
          ...toLinkFieldPatch('customerIds', txnCustomerIds(txn).filter((id) => id !== customerId)),
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

      const todos = await db.todos.where('customerId').equals(customerId).toArray()
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

      // 解绑其它客户 relations 中指向被删者的条目（双向弱引用，Issue #22）
      // 悬挂的 relations 会让全景图/聚焦图画出「边指向已删除客户」，与 projects.customerId 同源崩溃根因
      const allCustomers = await db.customers.toArray()
      for (const other of allCustomers) {
        if (other.deleted || other.id === customerId) continue
        const rels = other.relations ?? []
        if (rels.length === 0 || !rels.some((r) => r.targetId === customerId)) continue
        await db.customers.update(other.id, {
          relations: rels.filter((r) => r.targetId !== customerId),
          updatedAt: now,
          rev: other.rev + 1,
        })
        await db.syncQueue.add({
          table: 'customers',
          recordId: other.id,
          op: 'upsert',
          createdAt: now,
        })
      }

      // 解绑名下项目：项目不随客户消失，只清挂靠关系（弱引用语义，画布/CRM 下钻不悬挂）
      const projects = await db.projects.where('customerId').equals(customerId).toArray()
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

/**
 * 客户建档 + 跨模块关联初始化（原 modules/crm/hooks.ts → 暂存 @/agent → 第 2 步下沉于此，§9.6 不变式）。
 *
 * 单事务五表（customers / todos / interactions / transactions / syncQueue），任一步失败整体回滚。
 * 事件口径（P1 第 2 步）：本函数**不新增任何事件**——`openingLog` 是建档初始化的一部分，
 * 建档本身在 TOOL_EVENTS 声明表里无既有事件（§2.1「crm_createCustomer 无既有事件，不加新的」），
 * 故保持原行为（不 emit），与本步骤「不改既有语义、只收口漂移」的边界一致。
 */
export interface CustomerInitOptions {
  /** 创建一条 opening 沟通日志（类型=拜访） */
  openingLog?: boolean
  /** 关联已有交易：把该交易的 customerId 指向新客户 */
  linkTransactionId?: string
}

export async function createCustomerWithInit(
  customer: Customer,
  opts: CustomerInitOptions = {},
): Promise<void> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.customers, db.todos, db.interactions, db.transactions, db.syncQueue],
    async () => {
      const prev = await db.customers.get(customer.id)
      await db.customers.put({
        ...customer,
        updatedAt: now,
        rev: (prev?.rev ?? 0) + 1,
        deleted: 0 as const,
      } as Customer)
      await db.syncQueue.add({
        table: 'customers',
        recordId: customer.id,
        op: 'upsert',
        createdAt: now,
      })

      if (opts.openingLog) {
        const itx = {
          id: newId('itx'),
          customerId: customer.id,
          type: '拜访' as const,
          content: '客户建档 · 首次建立联系（opening）',
          at: now,
        }
        await db.interactions.put({
          ...itx,
          updatedAt: now,
          rev: 1,
          deleted: 0 as const,
        } as Interaction)
        await db.syncQueue.add({
          table: 'interactions',
          recordId: itx.id,
          op: 'upsert',
          createdAt: now,
        })
      }

      if (opts.linkTransactionId) {
        const txn = await db.transactions.get(opts.linkTransactionId)
        if (txn && !txn.deleted) {
          await db.transactions.update(txn.id, {
            ...toLinkFieldPatch(
              'customerIds',
              [...txnCustomerIds(txn), customer.id].filter((v, i, a) => a.indexOf(v) === i),
            ),
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
      }
    },
  )
  syncEngine.requestSync()
}

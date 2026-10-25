import Dexie, { type Table } from 'dexie'
import { migrateLegacyLinks } from './legacyLinkMigration'
import type {
  SyncMeta,
  Workspace,
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
  Settings,
  ModuleConfig,
} from './types'

export interface SyncQueueItem {
  /** 自增主键（schema: ++seq） */
  seq?: number
  table: string
  recordId: string
  op: 'upsert' | 'delete'
  createdAt: number
  sentAt?: number
}

export interface MetaEntry {
  key: string
  value: unknown
}

/**
 * 附件 Blob 单独存表（凭证图片等），元数据随业务记录同步。
 *
 * P2 #1：本表此前是**有同步行为、却没有同步元数据类型**的孤例 ——
 * `SYNC_TABLES` 早已含 attachments、服务端集合也一直带 `updatedAt`(required) / `deleted` / `rev`、
 * 写入路径运行时确实在盖这些字段，但全靠 `as Attachment & Partial<SyncMeta>` 之类断言绕过类型。
 * 类型不声明、索引不建，等于「跨设备 LWW 与软删」只在约定层面成立。
 *
 * `blob` 是**仅本地**字段：推送前由 `toPayload` 剥离，改走 multipart 上传到服务端 file 字段。
 *
 * 归属字段 `refType/refId` 已随关联层 Phase 2（v15）迁往 links 表（kind='attachment'，
 * from=宿主流水）—— 本地不再持有这两个键；服务端列保留供老客户端降级，pull 侧由
 * `stripLegacyLinkFields` 剥键 + `legacyLinkSpecs` 派生 link（见 linkId.ts）。
 */
export interface Attachment extends SyncMeta {
  id: string
  name: string
  mime: string
  size: number
  blob: Blob
  createdAt: number
}

/**
 * 专注会话 —— 本地瞬态数据，不进同步队列（开发计划 2.3 多设备约定）
 * 指标「深度专注分钟数」从本表推导
 */
export interface FocusSession {
  id: string
  startedAt: number
  completedAt: number
  minutes: number
}

/**
 * 寻鸽工作台本地数据库
 * 所有业务表均含同步元数据 updatedAt/deleted/rev（索引统一建在 updatedAt 上）
 */
export class NexusDB extends Dexie {
  workspaces!: Table<Workspace, string>
  customers!: Table<Customer, string>
  interactions!: Table<Interaction, string>
  ledgers!: Table<Ledger, string>
  transactions!: Table<Transaction, string>
  todos!: Table<Todo, string>
  notes!: Table<Note, string>
  quickNotes!: Table<QuickNote, string>
  habits!: Table<Habit, string>
  habitLogs!: Table<HabitLog, string>
  trophies!: Table<Trophy, string>
  attachments!: Table<Attachment, string>
  syncQueue!: Table<SyncQueueItem, number>
  meta!: Table<MetaEntry, string>
  todoLists!: Table<import('./types').TodoList, string>
  noteFolders!: Table<import('./types').NoteFolder, string>
  projects!: Table<import('./types').Project, string>
  projectMilestones!: Table<import('./types').ProjectMilestone, string>
  focusSessions!: Table<FocusSession, string>
  settings!: Table<Settings, string>
  moduleConfigs!: Table<ModuleConfig, string>
  customerGroups!: Table<import('./types').CustomerGroup, string>
  links!: Table<import('./types').Link, string>

  constructor() {
    super('nexus-workspace')
    this.version(1).stores({
      workspaces: 'id, updatedAt',
      customers: 'id, workspaceId, tier, updatedAt, [workspaceId+tier]',
      interactions: 'id, customerId, at, updatedAt',
      ledgers: 'id, updatedAt',
      transactions: 'id, ledgerId, occurredAt, status, customerId, updatedAt',
      todos: 'id, status, dueAt, priority, customerId, updatedAt',
      notes: 'id, updatedAt',
      quickNotes: 'id, createdAt, updatedAt',
      habits: 'id, updatedAt',
      habitLogs: 'id, habitId, date, updatedAt, [habitId+date]',
      trophies: 'id, tier, unlockedAt, updatedAt',
      attachments: 'id, refType, refId, createdAt',
      syncQueue: '++seq, table, recordId, sentAt',
      meta: 'key',
    })
    this.version(2).stores({
      focusSessions: 'id, startedAt, completedAt',
    })
    // v3（Phase 6）：settings singleton 表 —— 本地偏好，不进同步队列
    this.version(3).stores({
      settings: 'key',
    })
    // v4（清单系统）：用户自定义清单
    this.version(4).stores({
      todoLists: 'id, sortOrder, updatedAt',
    })
    // v5：todos 加 listId 索引（deleteTodoListCascade 级联查询走索引，避免全表扫描）；
    // customers 移除已废弃的 workspaceId 残留索引（类型与业务代码均已不用，减少写放大）
    this.version(5).stores({
      todos: 'id, status, dueAt, priority, customerId, listId, updatedAt',
      customers: 'id, tier, updatedAt',
    })
    // v6（笔记文件夹）：笔记文件树体系
    this.version(6).stores({
      noteFolders: 'id, updatedAt',
      notes: 'id, folderId, updatedAt',
    })
    // v7（账本左侧树）：账本清单化，加 sortOrder 索引支持拖拽排序
    this.version(7).stores({
      ledgers: 'id, sortOrder, updatedAt',
    })
    // v8（项目模块）：projects / projectMilestones 新表；
    // transactions/todos/notes/interactions 补 projectId 索引（弱引用查询与级联解绑走索引，v5 同款纪律）
    this.version(8).stores({
      projects: 'id, customerId, status, updatedAt',
      projectMilestones: 'id, projectId, sortOrder, updatedAt, [projectId+sortOrder]',
      transactions: 'id, ledgerId, occurredAt, status, customerId, projectId, updatedAt',
      todos: 'id, status, dueAt, priority, customerId, listId, projectId, updatedAt',
      notes: 'id, folderId, projectId, updatedAt',
      interactions: 'id, customerId, at, projectId, updatedAt',
    })
    // v10（Issue #63 自定义客户分组）：tag 规则圈人，参与同步
    this.version(10).stores({
      customerGroups: 'id, sortOrder, updatedAt',
    })
    // v9（Issue #34 亲密度体系）：moduleConfigs 模块配置表（key 寻址，每模块一条）。
    // 亲密度等级名/黑名单开关/算法权重随同步多端一致，走同步表而非 settings（本地偏好不进同步）
    this.version(9).stores({
      moduleConfigs: 'id, updatedAt',
    })
    /**
     * v11（Issue #140 交易多关联）：transactions 的关联字段单值 → 数组
     * `customerId/todoId/projectId` → `customerIds/todoIds/projectIds`。
     *
     * 索引策略变更（有意为之，非疏漏）：v8 起 transactions.customerId 建有索引，
     * 级联解绑/CRM 建边均走 `where('customerId')`。数组化后若要保住"走索引"，
     * 只能上 Dexie `multiEntry` 索引 —— 但 multiEntry 与同步队列的整体替换语义
     * （`put` 整体覆盖记录）及 `rev` 递增存在兼容坑，且本表数据量级小（个人工作台，
     * 千级），故**改用内存过滤** `(t.customerIds ?? []).includes(cid)`：
     * 语义更直白、与 `deleteCustomerCascade` 的"逐条解绑"写法一致、避免 multiEntry 的坑。
     * 代价是全表扫描 —— 数据量增长到万级时需重新评估（届时应上 multiEntry 或独立关联表）。
     *
     * 旧字段在 migrate 中**清掉**（双写不双读）：新数组为唯一真源。
     * 远端拉取路径由 `sync/mergeRemote.normalizeTxnLinks` 兜底归一化（服务端未升级时旧字段仍可能回来）。
     */
    this.version(11)
      .stores({
        transactions: 'id, ledgerId, occurredAt, status, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('transactions')
          .toCollection()
          .modify((t: Record<string, unknown>) => {
            const toIds = (v: unknown): string[] | undefined => {
              if (typeof v === 'string' && v) return [v]
              if (Array.isArray(v)) {
                const ids = v.filter((x): x is string => typeof x === 'string' && !!x)
                return ids.length > 0 ? [...new Set(ids)] : undefined
              }
              return undefined
            }
            const customerIds = toIds(t.customerIds ?? t.customerId)
            const todoIds = toIds(t.todoIds ?? t.todoId)
            const projectIds = toIds(t.projectIds ?? t.projectId)
            if (customerIds) t.customerIds = customerIds
            else delete t.customerIds
            if (todoIds) t.todoIds = todoIds
            else delete t.todoIds
            if (projectIds) t.projectIds = projectIds
            else delete t.projectIds
            // 真源唯一：旧单值字段即刻清除，杜绝"双读 fallback"被写漏
            delete t.customerId
            delete t.todoId
            delete t.projectId
          })
      })
    /**
     * v12（P2 #1 附件同步语义）：attachments 补 `updatedAt` 索引。
     *
     * 附件此前只有 `id, refType, refId, createdAt` 四个索引位 —— 没有 `updatedAt`，
     * 而本项目的增量游标、LWW 判定、按时间序回溯全都依赖它。补索引是纯本地动作：
     * **服务端无需变更**（`pb_setup/collections.json` 的 attachments 早已含这三个字段，
     * 线上实测亦一致），也不涉及数据搬迁 —— 存量记录缺的字段由写入路径与远端合并
     * （`mergeRemoteRecord` 统一盖 updatedAt / deleted / rev）逐步补齐，
     * 读取侧对缺字段一律按「未删除」处理（`!a.deleted`），不会把老记录误判成已删。
     */
    this.version(12).stores({
      attachments: 'id, refType, refId, createdAt, updatedAt',
    })

    /**
     * v13（手动客户分层下线）：customers 索引去掉 `tier`（v5 起为 `id, tier, updatedAt`）。
     *
     * `tier`（S/A/B/潜在）已从模型删除，分层语义合并进健康分 `intimacy`。该索引全仓
     * **无任何 `.where('tier')` 消费点**，去掉它只是清掉死索引，**不涉及数据搬迁**
     * —— 存量记录上残留的 `tier` 属性会被 Dexie 忽略（不读即不存在）。
     *
     * **服务端无需变更**：`customers` 集合从来没有过 tier 列（这正是线上该字段一直为空的原因），
     * 故不触发部署指南里的 Schema 升级流程。
     */
    this.version(13).stores({
      customers: 'id, updatedAt',
    })
    /**
     * v14（关联层 · 原子化一期，docs/关联层设计方案-20261025.md）：links 通用关联表。
     * 端点复合索引 [fromType+fromId] / [toType+toId] 是本表读写主路径 —— 统一关联层的
     * 动机之一就是替换 mentions / transactions 数组的全表内存扫描（即 v11 注释预埋的
     * 「独立关联表」演进方向），读侧 API 一律走这两个索引，禁止退回全表过滤。
     * 无 upgrade：新表零存量；服务端集合见 pb_setup/collections.json `links`（同步登记
     * 清单完整版见方案 §3）。
     */
    this.version(14).stores({
      links: 'id, kind, updatedAt, [fromType+fromId], [toType+toId]',
    })
    /**
     * v15（关联层 Phase 2 · 旧关联字段 → links 记录）：迁移族由
     * `MIGRATED_LINK_TABLES` 圈定（首族 attachments：附件归属 refType/refId →
     * kind='attachment' link，from=流水）；后续 notes.mentions / transactions 数组 /
     * customers.relations 逐族并入。迁移体单一实现见 legacyLinkMigration.ts
     * （与 migrateV15.test.ts 共用，不复制）；派生 link 盖 updatedAt:0/rev:0
     * 最低优先级戳、不入队 —— 多端各自派生靠确定性 id 合流，理由见该文件头注释。
     * 索引侧：attachments 去掉 refType/refId（读归属一律走 links 复合索引）。
     */
    this.version(15)
      .stores({
        attachments: 'id, createdAt, updatedAt',
      })
      .upgrade(async (tx) => {
        await migrateLegacyLinks((name) => tx.table(name) as never)
      })
  }
}

export const db = new NexusDB()

/** 当前工作区（本期单工作区：Personal，种子写入）——常量本体在 @/storage/workspace（服务端 bundle 不拖 Dexie） */
export { DEFAULT_WORKSPACE_ID } from '@/storage/workspace'

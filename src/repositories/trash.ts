import { storage } from '@/storage'
import { forgetTombstoneMarks, pushTombstonesNow } from '@/sync/pocketbaseAdapter'
import { reviveCascadeLinks } from './links'
import type {
  CustomerRelation,
  NoteMention,
  TrashSnapshot,
  TrashSnapshotLink,
  TrashTable,
} from '@/db/types'

/**
 * 全站回收站数据层。
 *
 * 纪律：
 * - 读走 StorageAdapter（含软删行），过滤/投影在本文件完成；
 * - 恢复是跨表写，必须单事务（根 + 子记录 + 被回填的目标 + syncQueue）；
 * - 「事件永在事务之后」：本文件不发事件，调用方 UI 靠 Dexie liveQuery 刷新。
 * - 永久删除是**物理删除**，与软删语义彻底分离：它前置要求墓碑已送达服务端
 *   （见 `purgeTargets` 注释），否则跨设备会复活。
 */

export const TRASH_TABLES: readonly TrashTable[] = [
  'customers',
  'interactions',
  'ledgers',
  'transactions',
  'todos',
  'todoLists',
  'notes',
  'noteFolders',
  'projects',
  'projectMilestones',
  'habits',
  'habitLogs',
  'attachments',
  'customerGroups',
]

export const TRASH_TABLE_LABEL: Record<TrashTable, string> = {
  customers: '客户',
  interactions: '沟通日志',
  ledgers: '账本',
  transactions: '流水',
  todos: '待办',
  todoLists: '清单',
  notes: '笔记',
  noteFolders: '文件夹',
  projects: '项目',
  projectMilestones: '里程碑',
  habits: '习惯',
  habitLogs: '打卡',
  attachments: '附件',
  customerGroups: '客户分组',
}

interface ChildParent {
  table: TrashTable
  field: string
  label: string
}

/** 子记录 → 父项。attachments 的父项要按 refType 判定，单独处理 */
const CHILD_PARENT: Partial<Record<TrashTable, ChildParent>> = {
  interactions: { table: 'customers', field: 'customerId', label: '客户' },
  habitLogs: { table: 'habits', field: 'habitId', label: '习惯' },
  projectMilestones: { table: 'projects', field: 'projectId', label: '项目' },
}

type Rec = Record<string, unknown> & { id: string }

export interface TrashItem {
  table: TrashTable
  id: string
  title: string
  subtitle: string
  deletedAt: number
  parentTable?: TrashTable
  parentId?: string
  parentTitle?: string
  parentAlive?: boolean
  /** 根墓碑快照里记录的子记录数（恢复时会一并恢复） */
  childCount: number
  /** 根墓碑快照里记录的关联数（恢复时会尝试回填） */
  linkCount: number
  canRestore: boolean
  blockedReason?: string
}

const str = (r: Rec, key: string): string => (typeof r[key] === 'string' ? (r[key] as string) : '')
const num = (r: Rec, key: string): number => (typeof r[key] === 'number' ? (r[key] as number) : 0)
const isDeleted = (r: Rec | undefined): boolean => !!r && (r.deleted === 1 || r.deleted === true)
const isAlive = (r: Rec | undefined): r is Rec => !!r && !isDeleted(r)

function titleOf(table: TrashTable, r: Rec, maps: Map<TrashTable, Map<string, Rec>>): string {
  switch (table) {
    case 'customers': {
      const name = str(r, 'name')
      const company = str(r, 'company')
      return company ? `${name} · ${company}` : name || '未命名客户'
    }
    case 'transactions': {
      const summary = str(r, 'summary') || '未命名流水'
      const amount = num(r, 'amount')
      return amount ? `${summary} · ¥${amount.toLocaleString('zh-CN')}` : summary
    }
    case 'interactions': {
      const content = str(r, 'content').replace(/\s+/g, ' ').trim()
      return content.length > 36 ? `${content.slice(0, 36)}…` : content || '沟通日志'
    }
    case 'habitLogs': {
      const habit = maps.get('habits')?.get(str(r, 'habitId'))
      return `${habit ? titleOf('habits', habit, maps) : '习惯'} · ${str(r, 'date')}`
    }
    case 'attachments': {
      return str(r, 'name') || '附件'
    }
    case 'projectMilestones':
    case 'todos':
    case 'notes':
      return str(r, 'title') || TRASH_TABLE_LABEL[table]
    default:
      return str(r, 'name') || TRASH_TABLE_LABEL[table]
  }
}

/**
 * 附件 → 宿主流水的归属映射（归属已迁 links：kind='attachment'，from=流水）。
 *
 * 不过滤 deleted link：级联删除会把归属 link 一并墓碑化，而回收站恰恰要在这之后
 * 回答「这个附件属于谁」（父子分组 + 恢复前置校验）—— 墓碑只代表「当下已删」，
 * 不代表「从未归属」。附件理论上可挂多个宿主（当前写入方只会建一个），取第一条。
 */
async function attachmentParentMap(): Promise<Map<string, { table: TrashTable; id: string }>> {
  const links = await storage.list<{
    id: string
    kind: string
    fromType: string
    fromId: string
    toId: string
  }>('links')
  const m = new Map<string, { table: TrashTable; id: string }>()
  for (const l of links) {
    if (l.kind !== 'attachment' || l.fromType !== 'transactions') continue
    if (!m.has(l.toId)) m.set(l.toId, { table: 'transactions', id: l.fromId })
  }
  return m
}

function parentOf(
  table: TrashTable,
  r: Rec,
  attParent?: ReadonlyMap<string, { table: TrashTable; id: string }>,
): { table: TrashTable; id: string } | undefined {
  if (table === 'attachments') return attParent?.get(String(r.id))
  const spec = CHILD_PARENT[table]
  if (!spec) return undefined
  const id = str(r, spec.field)
  return id ? { table: spec.table, id } : undefined
}

function readSnapshot(r: Rec): TrashSnapshot | undefined {
  const raw = r.trashSnapshot
  if (!raw) return undefined
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as TrashSnapshot
    } catch {
      return undefined
    }
  }
  return raw as TrashSnapshot
}

/** 列出全站墓碑（含子记录），供回收站页面分组 */
export async function listTrash(): Promise<TrashItem[]> {
  const rows = await Promise.all(
    TRASH_TABLES.map((table) => storage.list<Rec>(table).then((list) => [table, list] as const)),
  )
  const maps = new Map<TrashTable, Map<string, Rec>>()
  for (const [table, list] of rows) maps.set(table, new Map(list.map((r) => [String(r.id), r])))
  const attParent = await attachmentParentMap()

  const items: TrashItem[] = []
  for (const [table, list] of rows) {
    for (const r of list) {
      if (!isDeleted(r)) continue
      const parent = parentOf(table, r, attParent)
      const parentRec = parent ? maps.get(parent.table)?.get(parent.id) : undefined
      const parentAlive = parent ? isAlive(parentRec) : undefined
      const snapshot = readSnapshot(r)
      const childCount = snapshot?.children?.length ?? 0
      // 关联数 = 旧字段快照（links 数组，v15 前语义）+ 级联 link 墓碑（cascadeLinkIds，v15 起）。
      // 两类不重叠：前者是「字段回填凭证」，后者是「link 记录复活凭证」——只数前者会把
      // links 时代删除的客户显示成 0~1 条关联，而恢复实际会带回全部（2026-10-26 真机验收发现）。
      const linkCount =
        (snapshot?.links?.length ?? 0) + (snapshot?.cascadeLinkIds?.length ?? 0)
      const canRestore = !parent || parentAlive === true
      items.push({
        table,
        id: String(r.id),
        title: titleOf(table, r, maps),
        subtitle: TRASH_TABLE_LABEL[table],
        // 真实删除时间优先；老墓碑没有 deletedAt（该字段 2026-10-24 才加），回退 updatedAt 近似
        deletedAt: num(r, 'deletedAt') || num(r, 'updatedAt'),
        parentTable: parent?.table,
        parentId: parent?.id,
        parentTitle: parent
          ? parentRec
            ? titleOf(parent.table, parentRec, maps)
            : `${TRASH_TABLE_LABEL[parent.table]}（已清理）`
          : undefined,
        parentAlive,
        childCount,
        linkCount,
        canRestore,
        // 父项「已删」与「已被永久删除」是两种处境：前者可操作（先恢复父项），
        // 后者永远不可恢复 —— 提示必须分开，否则用户会一直点一个没有出路的按钮。
        blockedReason: canRestore
          ? undefined
          : parentRec
            ? `请先恢复所属${CHILD_PARENT[table]?.label ?? TRASH_TABLE_LABEL[parent!.table]}`
            : `所属${CHILD_PARENT[table]?.label ?? TRASH_TABLE_LABEL[parent!.table]}已被永久删除，此记录无法恢复`,
      })
    }
  }
  return items.sort((a, b) => b.deletedAt - a.deletedAt)
}

async function alive(
  tx: { get: (table: string, id: string) => Promise<Rec | undefined> },
  table: TrashTable,
  id: string,
): Promise<Rec | undefined> {
  const rec = await tx.get(table, id)
  return isAlive(rec) ? rec : undefined
}

/**
 * 恢复一条墓碑。
 *
 * 关键语义：
 * - 子记录必须父项先活；父项与子项一起恢复时在同一个事务内先恢复父项；
 * - 根墓碑的 trashSnapshot 决定恢复哪些子项、回填哪些链接；
 * - 目标已删/已清理的链接跳过并返回 skippedLinks，不为了重建链接复活无关记录；
 * - 关联层：snapshot.cascadeLinkIds 里的 links 表记录随根复活（两端实体都存活才复活，
 *   reviveCascadeLinks；必须在实体复活之后调用才能读到同事务内的活行）；
 * - 每条恢复记录都清空 trashSnapshot，入队 upsert，restoredAt 作为同步层唯一复活凭证。
 */
export async function restoreTrashRecord(
  table: TrashTable,
  id: string,
  opts: { withChildren?: boolean } = {},
): Promise<{
  restored: number
  rebuiltLinks: number
  skippedLinks: number
  prunedRefs: number
  revivedCascadeLinks: number
  skippedCascadeLinks: number
}> {
  if (!TRASH_TABLES.includes(table)) throw new Error('该类型不支持恢复')
  const now = Date.now()
  const attParent = await attachmentParentMap()
  return storage.transaction(['syncQueue', 'links', ...TRASH_TABLES], async (tx) => {
    const root = (await tx.get(table, id)) as Rec | undefined
    if (!root || !isDeleted(root)) throw new Error('记录不存在或已恢复')

    // 子记录单独恢复：父项必须已存活
    const parent = parentOf(table, root, attParent)
    if (parent) {
      const p = (await tx.get(parent.table, parent.id)) as Rec | undefined
      if (!isAlive(p)) {
        throw new Error(`请先恢复所属${CHILD_PARENT[table]?.label ?? TRASH_TABLE_LABEL[parent.table]}`)
      }
    }

    const snapshot = readSnapshot(root)
    const records: { table: TrashTable; rec: Rec }[] = [{ table, rec: root }]
    if (opts.withChildren !== false && snapshot?.children?.length) {
      for (const child of snapshot.children) {
        const rec = (await tx.get(child.table, child.id)) as Rec | undefined
        if (rec && isDeleted(rec)) records.push({ table: child.table, rec })
      }
    }

    let restored = 0
    let prunedRefs = 0
    for (const { table: t, rec } of records) {
      const { patch, pruned } = await pruneDeadRefs(tx, t, rec)
      prunedRefs += pruned
      await tx.update(t, rec.id, {
        ...patch,
        deleted: 0,
        updatedAt: now,
        restoredAt: now,
        rev: num(rec, 'rev') + 1,
        // 恢复即离开删除态：删除时间必须一并清掉，否则回收站口径/保留期清理会读到活记录上的脏值
        deletedAt: undefined,
        trashSnapshot: undefined,
      })
      await tx.enqueue(t, rec.id, 'upsert', now)
      restored++
    }

    let rebuiltLinks = 0
    let skippedLinks = 0
    for (const link of snapshot?.links ?? []) {
      const rebuilt = await applySnapshotLink(tx, link, now)
      if (rebuilt) rebuiltLinks++
      else skippedLinks++
    }

    // 关联层：级联牺牲的 link 记录复活（根与子记录已在上面临活，此处能读到活行）
    const cascade = await reviveCascadeLinks(tx, snapshot?.cascadeLinkIds ?? [], now)

    return {
      restored,
      rebuiltLinks,
      skippedLinks,
      prunedRefs,
      revivedCascadeLinks: cascade.revived,
      skippedCascadeLinks: cascade.skipped,
    }
  }).then((result) => {
    storage.requestSync()
    return result
  })
}

type Tx = {
  get(table: string, id: string): Promise<Rec | undefined>
  update(table: string, id: string, patch: Record<string, unknown>): Promise<void>
  enqueue(table: string, id: string, op: 'upsert' | 'delete', createdAt: number): Promise<void>
}

/** 清掉指向已删/不存在实体的弱引用，避免恢复后产生悬挂 id */
async function pruneDeadRefs(
  tx: Tx,
  table: TrashTable,
  rec: Rec,
): Promise<{ patch: Record<string, unknown>; pruned: number }> {
  let pruned = 0
  const patch: Record<string, unknown> = {}
  const dropDeadIds = async (field: string, target: TrashTable) => {
    const value = rec[field]
    if (!Array.isArray(value)) return
    const next: string[] = []
    for (const v of value) {
      if (typeof v !== 'string') continue
      if (await alive(tx, target, v)) next.push(v)
      else pruned++
    }
    if (next.length !== value.length) patch[field] = next.length ? next : undefined
  }
  const dropDeadOne = async (field: string, target: TrashTable) => {
    const v = rec[field]
    if (typeof v !== 'string' || !v) return
    if (!(await alive(tx, target, v))) {
      patch[field] = undefined
      pruned++
    }
  }

  switch (table) {
    case 'transactions': {
      const ledgerId = str(rec, 'ledgerId')
      if (ledgerId && !(await alive(tx, 'ledgers', ledgerId))) {
        throw new Error('所属账本已删除，请先恢复账本')
      }
      await dropDeadIds('customerIds', 'customers')
      await dropDeadIds('todoIds', 'todos')
      await dropDeadIds('projectIds', 'projects')
      break
    }
    case 'todos':
      // listId 剪枝已随 v16 退役：归属在 member link（恢复由 reviveCascadeLinks 按两端存活处理）
      await dropDeadOne('customerId', 'customers')
      await dropDeadOne('projectId', 'projects')
      break
    case 'notes': {
      // folderId 剪枝已随 v16 退役：归属在 member link（恢复由 reviveCascadeLinks 处理）
      await dropDeadOne('projectId', 'projects')
      const mentions = rec.mentions
      if (Array.isArray(mentions)) {
        const next: unknown[] = []
        for (const m of mentions) {
          if (!m || typeof m !== 'object') continue
          const type = (m as { type?: unknown }).type
          const mid = (m as { id?: unknown }).id
          if (typeof mid !== 'string') continue
          const target: TrashTable | undefined =
            type === 'customer'
              ? 'customers'
              : type === 'todo'
                ? 'todos'
                : type === 'ledger'
                  ? 'ledgers'
                  : type === 'project'
                    ? 'projects'
                    : undefined
          if (!target || (await alive(tx, target, mid))) next.push(m)
          else pruned++
        }
        if (next.length !== mentions.length) patch.mentions = next
      }
      break
    }
    case 'projects':
      await dropDeadOne('customerId', 'customers')
      break
    case 'customers': {
      const rels = rec.relations
      if (Array.isArray(rels)) {
        const next: CustomerRelation[] = []
        for (const r of rels) {
          if (!r || typeof r !== 'object') continue
          const rel = r as CustomerRelation
          if (typeof rel.targetId === 'string' && (await alive(tx, 'customers', rel.targetId)))
            next.push(rel)
          else pruned++
        }
        if (next.length !== rels.length) patch.relations = next
      }
      break
    }
    case 'interactions': {
      const customerId = str(rec, 'customerId')
      if (customerId && !(await alive(tx, 'customers', customerId))) {
        throw new Error('所属客户已删除，请先恢复客户')
      }
      break
    }
    case 'habitLogs': {
      const habitId = str(rec, 'habitId')
      if (habitId && !(await alive(tx, 'habits', habitId))) {
        throw new Error('所属习惯已删除，请先恢复习惯')
      }
      break
    }
    case 'projectMilestones': {
      const projectId = str(rec, 'projectId')
      if (projectId && !(await alive(tx, 'projects', projectId))) {
        throw new Error('所属项目已删除，请先恢复项目')
      }
      break
    }
    default:
      break
  }
  return { patch, pruned }
}

/** 按快照回填一条链接；目标不存活则返回 false（调用方计入 skippedLinks） */
async function applySnapshotLink(tx: Tx, link: TrashSnapshotLink, now: number): Promise<boolean> {
  const target = (await tx.get(link.table, link.id)) as Rec | undefined
  if (!isAlive(target)) return false
  const rev = num(target, 'rev') + 1

  if (link.mode === 'append') {
    const current = Array.isArray(target[link.field]) ? (target[link.field] as unknown[]) : []
    const value = link.value as string
    if (!current.includes(value)) {
      await tx.update(link.table, link.id, {
        [link.field]: [...current, value],
        updatedAt: now,
        rev,
      })
      await tx.enqueue(link.table, link.id, 'upsert', now)
    }
    return true
  }

  if (link.mode === 'set') {
    const current = target[link.field]
    // 目标在删除后已被重新关联到别处：不覆盖用户后来的选择，按「未恢复」处理
    if (current !== undefined && current !== null && current !== '' && current !== link.value) {
      return false
    }
    if (current !== link.value) {
      await tx.update(link.table, link.id, {
        [link.field]: link.value,
        updatedAt: now,
        rev,
      })
      await tx.enqueue(link.table, link.id, 'upsert', now)
    }
    return true
  }

  if (link.mode === 'mention') {
    const mention = link.value as NoteMention
    const field = Array.isArray(target[link.field]) ? (target[link.field] as NoteMention[]) : []
    // 同一条 mention 已存在则不重复补（恢复期间用户可能已手动重新提及）
    if (!field.some((m) => m.type === mention.type && m.id === mention.id)) {
      await tx.update(link.table, link.id, {
        [link.field]: [...field, mention],
        updatedAt: now,
        rev,
      })
      await tx.enqueue(link.table, link.id, 'upsert', now)
    }
    return true
  }

  const relation = link.value as CustomerRelation
  const current = Array.isArray(target.relations) ? (target.relations as CustomerRelation[]) : []
  const exists = current.some(
    (r) => r.targetId === relation.targetId && r.label === relation.label,
  )
  if (!exists) {
    await tx.update(link.table, link.id, {
      relations: [...current, relation],
      updatedAt: now,
      rev,
    })
    await tx.enqueue(link.table, link.id, 'upsert', now)
  }
  return true
}

// ─────────────────────────── 永久删除（物理删除） ───────────────────────────

type PurgeResult = { purged: number; tables: TrashTable[] }

/**
 * 永久删除一条墓碑 —— **物理删除，不可恢复**。
 *
 * ## 语义边界（三条，缺一条就会出事）
 *
 * 1. **只接受墓碑**：对活记录调用直接抛错。把「永久删除」做成「顺手删了活数据」是最危险的
 *    可操作错误 —— 用户本来只是在回收站里点错一行。
 * 2. **连带删除子墓碑**：级联软删出来的子记录（沟通日志 / 打卡 / 里程碑 / 附件）本来就随
 *    父项进回收站，父项被永久删除后它们永远无法恢复（`canRestore` 恒 false），留着只是垃圾。
 *    但**只删仍是墓碑的**：子项若已被单独恢复，它是活数据，绝不能因父墓碑消失而被带走。
 * 3. **先同步、后删除**：见 `purgeTargets`。
 *
 * 引用处理：不需要额外断链 —— 软删阶段（`deleteXxxCascade`）已经把活数据里的强引用清空、
 * 弱引用解绑，活记录本来就不指向墓碑。被丢弃的 `trashSnapshot.links` 正是「恢复时才回填」
 * 的那份记录，永久删除后不再回填，语义正确。
 */
export async function purgeTrashRecord(table: TrashTable, id: string): Promise<PurgeResult> {
  if (!TRASH_TABLES.includes(table)) throw new Error('该类型不支持永久删除')
  const root = await storage.get<Rec>(table, id)
  if (!root) throw new Error('记录不存在（可能已被永久删除）')
  if (!isDeleted(root)) throw new Error('该记录未被删除，不能永久删除')

  const targets: { table: TrashTable; id: string }[] = [{ table, id }]
  for (const child of readSnapshot(root)?.children ?? []) {
    if (!TRASH_TABLES.includes(child.table)) continue
    const rec = await storage.get<Rec>(child.table, child.id)
    if (rec && isDeleted(rec)) targets.push({ table: child.table, id: child.id })
  }
  return purgeTargets(targets)
}

/** 清空回收站：把所有墓碑（含子记录）一次性物理删除 */
export async function purgeAllTrash(): Promise<PurgeResult> {
  const items = await listTrash()
  return purgeTargets(items.map((i) => ({ table: i.table, id: i.id })))
}

/**
 * 物理删除一组墓碑。顺序是硬约束：
 *
 * **① 同步前置（事务外）→ ② 单事务物理删 → ③ 清标记（事务外）**
 *
 * 为什么 ① 必须在前：本地行一旦消失，`pushImpl` 就读不到它（`!rec` 直接出队），
 * 这条删除永远送不到服务端 —— 服务端仍是活记录时，其他设备会继续拉到活数据并把它写回来。
 * `pushTombstonesNow` 在离线/推送失败时抛**可操作错误**，此时本地一条都没删，用户可重试。
 *
 * 为什么 ③ 在事务外：`tombstone_pushed:*` 是 `db.meta` 里的同步标记，不是业务表；
 * 把它放进业务事务会把「meta 表」拖成事务参与者，且删除已完成时不该因清标记失败而回滚。
 *
 * 为什么不清理 syncQueue：残留条目（delete 或 upsert）在推送时会因本地记录不存在而被
 * 直接出队（`pushImpl` 既有的 `if (!rec)` 分支），无害；反过来在事务里全表扫队列只为
 * 删几条记录，是把简单事做复杂。
 */
async function purgeTargets(targets: { table: TrashTable; id: string }[]): Promise<PurgeResult> {
  if (targets.length === 0) return { purged: 0, tables: [] }

  const entries = targets.map((t) => ({ table: t.table as string, recordId: t.id }))
  await pushTombstonesNow(entries)

  const tables = [...new Set(targets.map((t) => t.table))]
  const purgedTargets: { table: TrashTable; id: string }[] = []
  await storage.transaction(['syncQueue', ...tables], async (tx) => {
    for (const t of targets) {
      const cur = await tx.get<Rec>(t.table, t.id)
      // 事务内复核：收集之后、删除之前被恢复的记录必须放过 —— 绝不物理删活数据
      if (!cur || !isDeleted(cur)) continue
      await tx.delete(t.table, t.id)
      purgedTargets.push(t)
    }
  })

  await forgetTombstoneMarks(purgedTargets.map((t) => ({ table: t.table, recordId: t.id })))
  return { purged: purgedTargets.length, tables: [...new Set(purgedTargets.map((t) => t.table))] }
}

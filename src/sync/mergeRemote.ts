import { db } from '@/db/db'
import { normalizeTxnLinks } from '@/modules/finance/links'

/**
 * 远端记录 → 本地 LWW 合并（从 pocketbaseAdapter 抽出，Issue #130）
 *
 * 抽出动机：合并策略（本地未推送编辑保护 / relations 并集 / 待办完成态本地优先）
 * 是纯数据逻辑，与网络层无关；独立成模块后可被单测直接覆盖（原实现被
 * readSyncSettings / login / fetch 等网络依赖包裹，无法在 node 环境验证）。
 *
 * 调用方（pocketbaseAdapter.pullImpl）负责网络拉取、游标推进与附件 Blob 还原。
 */

export interface PbRecord {
  id: string
  [key: string]: unknown
}

/**
 * 附件 Blob 还原回调（由网络层 pocketbaseAdapter 注入）。
 *
 * 为何用注入而不是在这里直接 fetch：mergeRemote 是纯数据合并模块（单测在 node 环境跑，
 * 不能依赖网络/鉴权）；附件的下载地址、token 头由适配器负责。
 * 返回 undefined 表示不下载（无 file 字段 / 超限 / 下载失败）——不阻塞本条元数据落库。
 */
export type AttachmentBlobLoader = (remote: PbRecord) => Promise<Blob | undefined>

function bizTable(table: string) {
  return db[table as keyof typeof db] as unknown as {
    get(id: string): Promise<Record<string, unknown> | undefined>
    put(value: Record<string, unknown>): Promise<string>
  }
}

// ─────────────────────────── 本地未推送编辑保护（Issue #130） ───────────────────────────

/**
 * 本地是否有「尚未确认推送成功」的 upsert 队列条目。
 * 用于远端拉取合并时保护本地刚落库的编辑：队列中还有该记录的 upsert，
 * 说明本地版本还未被服务端接受，此时被远端旧值整体覆盖 = 用户编辑静默丢失。
 */
async function hasPendingUpsert(table: string, recordId: string): Promise<boolean> {
  const pending = await db.syncQueue
    .filter((q) => q.table === table && q.recordId === recordId && q.op === 'upsert')
    .count()
  return pending > 0
}

/**
 * 需要按数组归一化落库的 json 字段（服务端可能返回 JSON 字符串）。
 *
 * Issue #140 补充：transactions 的 `customerIds/todoIds/projectIds` 同为 json 数组字段 ——
 * 服务端集合未升级时这些键根本不会回来，本地数组会被整体覆盖丢掉（与 relations 同源的静默丢数据），
 * 故必须并入本表走「远端可解析才覆盖、否则保留本地」的收口逻辑。
 */
const JSON_ARRAY_FIELDS = ['tags', 'relations', 'customerIds', 'todoIds', 'projectIds'] as const

/** json 字段（customers.tags / customers.relations 等）归一化为数组，兼容服务端返回字符串或对象 */
function toArrayField(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  if (typeof v !== 'string' || !v) return null
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 关系条目稳定标识：优先条目 id，旧数据按 目标::语义 兜底（与 CustomerFormDrawer.relKey 同口径） */
function relationKey(r: Record<string, unknown>): string {
  const id = typeof r.id === 'string' && r.id ? r.id : ''
  if (id) return id
  return `${String(r.targetId ?? '')}::${String(r.label ?? '')}`
}

/**
 * customers.relations 并集合并（Issue #130）：
 * 服务端记录先到、本地编辑尚未推送成功时，关系数组按「条目 id」取并集而非整体覆盖 ——
 * 既保住本地新增的关系，也保住其他设备新增的关系，用户保存的编辑不再被回滚。
 */
function unionRelations(localVal: unknown, remoteVal: unknown): unknown {
  const local = toArrayField(localVal) ?? []
  const remote = toArrayField(remoteVal) ?? []
  const seen = new Set(remote.map((r) => relationKey(r as Record<string, unknown>)))
  const extra = local.filter((r) => !seen.has(relationKey(r as Record<string, unknown>)))
  return [...remote, ...extra]
}

// ─────────────────────────── LWW 合并（远端 → 本地，盖 rev 不入队） ───────────────────────────

export async function mergeRemoteRecord(
  table: string,
  remote: PbRecord,
  loadAttachmentBlob?: AttachmentBlobLoader,
): Promise<'write' | 'skip'> {
  const table0 = bizTable(table)
  // 由远端 localId 字段还原本地 id（服务端主键是哈希 pbId，不可直接当本地 id 用）
  const localId = typeof remote.localId === 'string' && remote.localId ? remote.localId : ''
  if (!localId) {
    console.warn(`[sync] 跳过缺失 localId 的远端记录 ${table}/${remote.id}`)
    return 'skip'
  }
  const local = await table0.get(localId)
  const remoteUpdatedAt = typeof remote.updatedAt === 'number' ? remote.updatedAt : 0
  const localUpdatedAt = typeof local?.updatedAt === 'number' ? local.updatedAt : 0
  // LWW：只认 updatedAt，新者胜；相等视为本端已推送的回环副本，跳过
  if (remoteUpdatedAt <= localUpdatedAt) return 'skip'

  // 本地编辑优先保护（Issue #130）：本地存在尚未推送成功（或推送被跳过的）的 upsert 队列条目时，
  // 远端记录先到一步也不能整体覆盖本地 —— 否则「刚编辑的字段被云端旧值抹掉」
  // （客户关系等嵌套字段的编辑会因整记录覆盖而丢失，表现为「保存了不生效」）。
  // 处理：按被编辑记录逐字段覆盖本地（本地保存的字段取本地值），推送到服务端后自然收敛。
  const hasPendingLocalEdit = await hasPendingUpsert(table, localId)
  if (hasPendingLocalEdit && local) {
    const {
      collectionId: _pc,
      collectionName: _pn,
      created: _pcr,
      updated: _pu,
      server_received_at: _ps,
      localId: _pl,
      ...mirroredPending
    } = remote
    const merged: Record<string, unknown> = {
      ...local,
      ...mirroredPending,
      id: localId,
      updatedAt: localUpdatedAt,
      deleted: local.deleted ?? 0,
      rev: Math.max(
        typeof local.rev === 'number' ? local.rev : 0,
        typeof remote.rev === 'number' ? remote.rev : 0,
      ),
    }
    // json 数组字段统一收口（回归修复）：本分支此前直接用 `...mirroredPending` 展开远端字段，
    // 有两个真实缺陷：
    // ① 服务端 json 字段可能返回 JSON 字符串（字段类型/版本差异），展开后本地数组被写成字符串，
    //    前端 `relations.map` / `tags.map` 立刻抛错（已由端到端用例暴露）；
    // ② 即使能解析成数组，整体覆盖也会把本地刚新增的条目冲掉（保护了「本地优先」却在字段内部又丢编辑）。
    // 收口为与下方同一套语义：relations 取并集，其余数组字段本地有值时保留本地。
    if (table === 'customers') {
      for (const key of JSON_ARRAY_FIELDS as readonly string[]) {
        const localVal = (local as Record<string, unknown>)[key]
        if (key === 'relations') {
          const remoteRels = remote[key]
          if (remoteRels !== undefined) {
            merged[key] = unionRelations(localVal, remoteRels)
          } else if (localVal !== undefined) {
            merged[key] = localVal
          } else {
            delete merged[key]
          }
          continue
        }
        // 其余数组字段：远端能解析成数组才并入，否则保留本地（本地未推送编辑优先）
        const parsed = toArrayField(remote[key])
        if (parsed) merged[key] = parsed
        else if (localVal === undefined) delete merged[key]
        else merged[key] = localVal
      }
    }
    // transactions 多关联（Issue #140）：数组字段同款收口 + 旧单值字段归一化。
    // 两条真实路径都要挡：
    // ① 服务端集合未升级（collections.json 未导入）→ 远端没有 customerIds 键，
    //    直接展开 = 本地刚选的关联被静默清空；
    // ② 老客户端仍推来旧键 customerId（多端混装期）→ 需折进数组，不能另存一份。
    // normalizeTxnLinks 同时做这两件事，并把旧键删掉（双写不双读）。
    if (table === 'transactions') {
      for (const key of ['customerIds', 'todoIds', 'projectIds'] as const) {
        const localVal = merged[key]
        const parsed = toArrayField(merged[key])
        if (parsed) merged[key] = parsed
        else if (localVal === undefined) delete merged[key]
        else merged[key] = localVal
      }
      normalizeTxnLinks(merged)
    }
    await attachBlobIfNeeded(table, remote, merged, loadAttachmentBlob)
    await table0.put(merged)
    return 'write'
  }

  // 待办完成态本地优先（Issue #74）：服务端 collections 未含 completedAt 字段时，
  // 本地「打勾完成」推送后被服务端静默丢弃该字段，随后远端记录以更新的 updatedAt 拉回，
  // 整体覆盖会把 status 回滚成未完成（表现为「勾了又弹回去」）。
  // 完成态以本地为准：本地已完成而远端非完成时，保留本地 status/completedAt，
  // 仅合并远端其余字段（标题/描述等编辑仍能同步）。
  // Issue #128 补充（main 合入时同步）：终态（完成/作废）同款本地优先——作废同理不应被远端旧值回滚。
  // 只认「本地是终态、远端不是」的情形：远端也是终态时按 LWW 让远端赢（可能是另一端的更新操作）
  const remoteDone = remote.status === 'done'
  const localDone = local?.status === 'done'
  const remoteVoided = remote.status === 'voided'
  const localVoided = local?.status === 'voided'
  const keepLocalDone =
    table === 'todos' &&
    ((localDone && !remoteDone) || (localVoided && !remoteVoided && !remoteDone))

  // 剥离 pb 系统字段（collectionId/collectionName/created/updated/server_received_at）与映射字段 localId
  const {
    collectionId: _c,
    collectionName: _n,
    created: _cr,
    updated: _u,
    server_received_at: _s,
    localId: _l,
    ...mirrored
  } = remote
  const record: Record<string, unknown> = { ...mirrored }
  record.id = localId
  record.updatedAt = remoteUpdatedAt
  record.deleted = remote.deleted ? 1 : 0
  record.rev = Math.max(
    typeof local?.rev === 'number' ? local.rev : 0,
    typeof remote.rev === 'number' ? remote.rev : 0,
  )
  if (keepLocalDone) {
    // 终态本地优先：status 与**对应**时间戳成对保留（Issue #74 完成态 / Issue #128 作废态），
    // 单保 status 不保时间戳会让「今日已完成」统计/时间轴锚点丢依据
    record.status = local!.status
    record.completedAt = local!.completedAt
    record.voidedAt = local!.voidedAt
  }

  // 客户关系并集合并（Issue #130）：relations 是弱引用数组，
  // 远端先到 + 本地编辑未推送成功时整体覆盖会丢新增关系；
  // 服务端集合也可能没有 relations 字段（Schema 未升级），此时同样不能丢本地关系。
  if (table === 'customers') {
    const localRels = (local as { relations?: unknown } | undefined)?.relations
    const remoteRels = (remote as { relations?: unknown }).relations
    if (remoteRels !== undefined) {
      const merged = unionRelations(localRels, remoteRels)
      record.relations = merged
    } else if (localRels !== undefined) {
      // 服务端 Schema 缺 relations 字段（collections.json 未导入/未升级）：保留本地
      record.relations = localRels
    }
  }

  // transactions 多关联（Issue #140）：同上，LWW 分支同样要收口 —— 远端没带的数组字段
  // 不能因为「远端更新」就被清掉（远端 updatedAt 更新只代表记录被改过，不代表关联被清空）。
  if (table === 'transactions') {
    for (const key of ['customerIds', 'todoIds', 'projectIds'] as const) {
      const localVal = local?.[key]
      const parsed = toArrayField(record[key])
      if (parsed) record[key] = parsed
      else if (localVal === undefined) delete record[key]
      else record[key] = localVal
    }
    normalizeTxnLinks(record)
  }

  await attachBlobIfNeeded(table, remote, record, loadAttachmentBlob)
  await table0.put(record)
  return 'write'
}

/**
 * 附件 Blob 还原（回归修复）：合并逻辑从 pocketbaseAdapter 抽出时，
 * 「pull 下载 pb file 字段还原本地 Blob」这一步没跟着搬过来，
 * 导致其他设备上传的附件拉回本地后 blob 为空（列表可见、点开打不开）。
 * 这里在落库前补回，仅对 attachments 表生效；下载失败不阻塞元数据落库。
 */
async function attachBlobIfNeeded(
  table: string,
  remote: PbRecord,
  target: Record<string, unknown>,
  loader?: AttachmentBlobLoader,
): Promise<void> {
  if (table !== 'attachments' || !loader) return
  try {
    const blob = await loader(remote)
    if (blob) target.blob = blob
  } catch (err) {
    console.warn(`[sync] 附件 Blob 下载失败 ${remote.id}`, err)
  }
}


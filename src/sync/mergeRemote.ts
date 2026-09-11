import { db } from '@/db/db'

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
 * 需要落库为数组的 json 字段（服务端可能返回 JSON 字符串）。
 * 只用于「远端缺该字段时是否兜底」的判断，不再承担反序列化职责 —— 见 rawJsonFromRemote。
 */
const JSON_ARRAY_FIELDS = ['tags', 'relations'] as const

/**
 * json 字段（customers.tags / customers.relations / customers.intimacy 等）归一化为数组，
 * 兼容服务端返回字符串或对象；空字符串 / null / 解析失败一律视为「无值」（null）。
 */
function toArrayField(v: unknown): unknown[] | null {
  const parsed = rawJsonFromRemote(v)
  return Array.isArray(parsed) ? parsed : null
}

/** 值是否「有内容」：null/undefined/空串视为无值（服务端空 json 字段即此形态） */
function hasJsonValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== ''
}

/** 反序列化一层：字符串且本身是合法 JSON 时取解析结果，其余原样返回 */
function parseOnce(v: unknown): { ok: boolean; value: unknown } {
  if (typeof v !== 'string') return { ok: true, value: v }
  const text = v.trim()
  if (!text) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    // 服务端确实存了一个普通字符串（如某字段误写成纯文本）：保持原值，不当作解析失败
    return { ok: false, value: v }
  }
}

/**
 * 反序列化「远端 json 字段」到本地该有的类型（Issue #130 根因修复）。
 *
 * 根因：本地「保存 → push」时仅把非基本类型做 `JSON.stringify`，但 PB 的 json 字段吃字符串
 * 会**再包一层引号**原样存回（两次编码），于是同一字段在不同情况下可能是三种形态：
 *   ① 真数组/对象（PB 正常返回的 json 值）
 *   ② JSON 字符串（PB 原样返回被双重编码的字符串）
 *   ③ 普通字符串（字段被误写成纯文本，如某客户的 tags = "重点客户"）
 * 而 pull 合并此前只在「有本地未推送编辑」那一条分支里做数组归一化，**正常分支直接整体落库**：
 *   - `tags` 落成字符串 → CRM 列表/详情 `c.tags.map` / `c.tags.join` 抛 TypeError → 页面白屏（功能全废）
 *   - `relations` 落成字符串 → 客户关系被静默回滚成空（打开编辑再保存即丢失）
 *   - `intimacy` 落成字符串 → 亲密度档位显示丢失
 * 故这里在**落库前统一反序列化**，一次覆盖所有分支（含正常 LWW 分支）。
 */
export function rawJsonFromRemote(v: unknown): unknown {
  const first = parseOnce(v)
  if (!first.ok) return first.value
  if (typeof first.value !== 'string') return first.value
  // 双层编码（JSON 字符串里又是 JSON 字符串）：最多再剥一层，足够覆盖本地 stringify + PB 再包一层
  const second = parseOnce(first.value)
  return second.ok ? second.value : first.value
}

/**
 * 数组型 json 字段（tags 等）的安全兜底：反序列化后仍不是数组时，
 * 说明服务端存的既不是数组也不是数组的 JSON 文本 —— 若原样落库，前端 `tags.map` 直接抛错白屏。
 * 此时不猜结构也不静默丢弃，按「单元素数组」降级保留原始文本。
 */
function toSafeArrayField(v: unknown): unknown {
  const revived = rawJsonFromRemote(v)
  if (Array.isArray(revived)) return revived
  if (typeof revived === 'string' && revived) return [revived]
  return []
}

/** 落库前把服务端的 json 字段反序列化回本地形态（customers.tags / relations / intimacy） */
function reviveRemoteJsonFields(table: string, record: Record<string, unknown>): void {
  if (table !== 'customers') return
  for (const key of ['tags', 'relations'] as const) {
    if (key in record) record[key] = toSafeArrayField(record[key])
  }
  if ('intimacy' in record) record.intimacy = rawJsonFromRemote(record.intimacy)
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
  // 反序列化远端 json 字段（Issue #130 根因）：不先还原，正常 LWW 分支会把字符串整体落库，
  // 前端 `customer.tags.map` / `relations.map` 抛 TypeError（页面白屏、关系被静默回滚成空）
  const revived: Record<string, unknown> = { ...remote }
  reviveRemoteJsonFields(table, revived)
  const remoteUpdatedAt = typeof revived.updatedAt === 'number' ? revived.updatedAt : 0
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
    } = revived
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
          const remoteRels = revived[key]
          if (remoteRels !== undefined) {
            merged[key] = unionRelations(localVal, remoteRels)
          } else if (hasJsonValue(localVal)) {
            merged[key] = localVal
          } else {
            delete merged[key]
          }
          continue
        }
        // 其余数组字段：远端取值「有内容」才并入，否则保留本地（本地未推送编辑优先）
        const remoteVal = revived[key]
        if (hasJsonValue(remoteVal)) merged[key] = remoteVal
        else if (!hasJsonValue(localVal)) delete merged[key]
        else merged[key] = localVal
      }
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
  const remoteDone = revived.status === 'done'
  const localDone = local?.status === 'done'
  const remoteVoided = revived.status === 'voided'
  const localVoided = local?.status === 'voided'
  const keepLocalDone =
    table === 'todos' &&
    ((localDone && !remoteDone) || (localVoided && !remoteVoided && !remoteDone))

  // 速记处置态本地优先（Issue #134 三轮）：与上面的待办终态本地优先同款。
  // 根因是**处置态是单边的**：本地「已处置」（有 convertedTo）、远端「未处置」（convertedTo 空）。
  // 服务端 quickNotes 集合未收录 convertedAt / convertedVia，且旧版本连 convertedTo 都可能丢，
  // 于是换设备 / 重装 / 队列清空后拉一次远端旧记录，处置态被整体抹掉——
  // 已转入待办的速记重新回到「暂存区待处置」，再点一次「转入待办」就多出一条重复待办。
  // 反向不保护：远端有 convertedTo 而本地没有时按 LWW 写入（可能是另一端的处置结果）。
  const keepLocalConverted =
    table === 'quickNotes' && !!local?.convertedTo && !remote.convertedTo

  // 剥离 pb 系统字段（collectionId/collectionName/created/updated/server_received_at）与映射字段 localId
  const {
    collectionId: _c,
    collectionName: _n,
    created: _cr,
    updated: _u,
    server_received_at: _s,
    localId: _l,
    ...mirrored
  } = revived
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

  if (keepLocalConverted) {
    // 处置态成对保留（去向 + 时间 + 通道）：单保 convertedTo 不保 convertedAt/convertedVia，
    // 会让暂存区排序与「从哪个入口处置的」回溯同时失去依据（Issue #134 二轮刚补的来源留痕会白做）
    record.convertedTo = local!.convertedTo
    record.convertedAt = local!.convertedAt
    record.convertedVia = local!.convertedVia
  }

  // 客户关系并集合并（Issue #130）：relations 是弱引用数组，
  // 远端先到 + 本地编辑未推送成功时整体覆盖会丢新增关系；
  // 服务端集合也可能没有 relations 字段（Schema 未升级），此时同样不能丢本地关系。
  if (table === 'customers') {
    const localRels = (local as { relations?: unknown } | undefined)?.relations
    const remoteRels = (revived as { relations?: unknown }).relations
    if (hasJsonValue(remoteRels)) {
      const merged = unionRelations(localRels, remoteRels)
      record.relations = merged
    } else if (hasJsonValue(localRels)) {
      // 服务端 Schema 缺 relations 字段（collections.json 未导入/未升级）或返回空值：保留本地
      record.relations = localRels
    }
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


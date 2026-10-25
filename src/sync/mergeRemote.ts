import { db } from '@/db/db'
import { normalizeTxnLinks } from '@/modules/finance/links'
import {
  buildLinkId,
  legacyLinkSpecs,
  stripLegacyLinkFields,
  MIGRATED_LINK_TABLES,
  type LegacyLinkSpec,
} from '@/repositories/linkId'
// 协议纯函数已收口到 remoteNormalize.ts（agentOps 服务端化 P2：服务端 adapter 需同一套
// 归一化逻辑但不能拖 Dexie）——本文件消费，不再各自持有副本。
import {
  isTombstone,
  rawJsonFromRemote,
  reviveRemoteJsonFields,
  stripPbMeta,
} from './remoteNormalize'

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

// ─────────────────────── 旧关联字段归一化（关联层 Phase 2） ───────────────────────

/**
 * 远端记录携带的旧关联字段 → 派生 links 记录（迁移族内的表才处理）。
 *
 * 为什么 pull 侧必须派生而不只是剥键：服务端旧列**永远残留旧值** —— 推送是 PATCH，
 * 本地记录不再带 customerIds / refType 等键，PATCH 就不会清服务端列；老客户端后来
 * 还会继续写这些键。于是「新设备 / 重装设备」拉到的记录仍带着旧关联，若只剥不派生，
 * 这些关联就凭空消失。派生规则与 v15 upgrade 同一实现（legacyLinkSpecs，确定性 id），
 * 多端各自派生天然合流；派生行盖 updatedAt:0 / rev:0 最低优先级戳且**不入队**
 * （远端真实 link 记录一到即按 LWW 胜出；本端真实编辑时 linkAtoms 再盖真戳入队）。
 * 端点已删/缺失的旧关联跳过（语义上已解绑）；本地已有同语义 link（活或墓碑）不动。
 */
async function deriveLegacyLinks(table: string, rec: Record<string, unknown>): Promise<void> {
  const specs = legacyLinkSpecs(table, rec)
  for (const s of specs as LegacyLinkSpec[]) {
    const from = await bizTable(s.from.type).get(s.from.id)
    if (!from || from.deleted) continue
    const to = await bizTable(s.to.type).get(s.to.id)
    if (!to || to.deleted) continue
    const id = buildLinkId(s.from, s.to, s.kind, s.meta)
    if (await db.links.get(id)) continue
    await db.links.put({
      id,
      fromType: s.from.type,
      fromId: s.from.id,
      toType: s.to.type,
      toId: s.to.id,
      kind: s.kind,
      ...(s.meta ? { meta: s.meta } : {}),
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
      updatedAt: 0,
      rev: 0,
      deleted: 0,
    } as never)
  }
}

// isTombstone / stripPbMeta / rawJsonFromRemote / reviveRemoteJsonFields 已收口 `./remoteNormalize`

// ─────────────────────────── 本地未推送编辑保护（Issue #130） ───────────────────────────

/**
 * 本地是否有「尚未确认推送成功」的 upsert 队列条目。
 * 用于远端拉取合并时保护本地刚落库的编辑：队列中还有该记录的 upsert，
 * 说明本地版本还未被服务端接受，此时被远端旧值整体覆盖 = 用户编辑静默丢失。
 *
 * ⚠️ 性能（审计 C-12 · 2026-10-21）：本函数是**在整表拉取循环里逐条调用**的，
 * 原实现在每次调用时都对 syncQueue 做一次 `filter().count()` —— 即
 * **O(远端条数 × 队列条数)** 的重复全表扫描。实测口径：一次 pull 若拉到 N 条远端记录、
 * 队列有 M 条待推送，就是 N 次扫描。
 *
 * 修法：调用方（`pullImpl`）**每表拉取前一次性**构建 `Set<'table:recordId'>`，
 * 经可选参数 `pendingIndex` 传入；未传时回落旧行为（保持该函数作为独立 API 的语义，
 * 且 12+ 处既有单测直接调 `mergeRemoteRecord` 不传该参数，行为完全不变）。
 */
async function hasPendingUpsert(
  table: string,
  recordId: string,
  pendingIndex?: ReadonlySet<string>,
): Promise<boolean> {
  if (pendingIndex) return pendingIndex.has(`${table}:${recordId}`)
  const pending = await db.syncQueue
    .filter((q) => q.table === table && q.recordId === recordId && q.op === 'upsert')
    .count()
  return pending > 0
}

/**
 * 一次性构建「待推送 upsert 索引」（审计 C-12）。
 *
 * 调用方在**每表拉取开始前**调一次，把结果传给 `mergeRemoteRecord(…, pendingIndex)`，
 * 把原来的「逐条查队列」变成「一次读队列 + N 次集合查找」。
 * 只收 `op === 'upsert'`（delete 不参与「本地编辑优先保护」的比较，与旧口径一致）。
 */
export async function buildPendingUpsertIndex(): Promise<Set<string>> {
  const rows = await db.syncQueue.filter((q) => q.op === 'upsert').toArray()
  return new Set(rows.map((q) => `${q.table}:${q.recordId}`))
}

/**
 * 需要落库为数组的 json 字段（服务端可能返回 JSON 字符串）。
 * 只用于「远端缺该字段时是否兜底」的判断，不再承担反序列化职责 —— 见 rawJsonFromRemote。
 *
 * Issue #140 补充：transactions 的 `customerIds/todoIds/projectIds` 同为 json 数组字段 ——
 * 服务端集合未升级时这些键根本不会回来，本地数组会被整体覆盖丢掉（与 relations 同源的静默丢数据），
 * 故必须并入本表走「远端可解析才覆盖、否则保留本地」的收口逻辑。
 */
const JSON_ARRAY_FIELDS = ['tags', 'relations', 'customerIds', 'todoIds', 'projectIds'] as const

// JSON_FIELDS_BY_TABLE / JSON_ARRAY_FIELDS_BY_TABLE / parseOnce / toSafeArrayField /
// reviveRemoteJsonFields 已收口 `./remoteNormalize`（单一事实源，两宿主共用）。

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
  /**
   * 待推送 upsert 索引（审计 C-12）：由 `buildPendingUpsertIndex()` 构建、
   * 调用方按「每表拉取一次」复用。缺省时回落到逐条查队列（旧行为）。
   */
  pendingIndex?: ReadonlySet<string>,
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
  // 关联层 Phase 2：迁移族内的表，先把旧关联字段剥掉 —— 本地行从此不再持有它们
  // （服务端列保留供老客户端降级）。派生要等记录**落库之后**做（记录自身常是 link
  // 端点，落库前判「端点不存在」会漏派生），故在剥除前留一份快照传给派生。
  let legacySource: Record<string, unknown> | undefined
  if (MIGRATED_LINK_TABLES.has(table)) {
    legacySource = { ...revived }
    stripLegacyLinkFields(table, revived)
  }
  const remoteUpdatedAt = typeof revived.updatedAt === 'number' ? revived.updatedAt : 0
  const localUpdatedAt = typeof local?.updatedAt === 'number' ? local.updatedAt : 0
  const localRestoredAt =
    typeof local?.restoredAt === 'number' ? (local.restoredAt as number) : 0
  const remoteRestoredAt =
    typeof revived.restoredAt === 'number' ? (revived.restoredAt as number) : 0

  // ── 删除优先（产品口径，2026-09-15 拍板）：软删默认是**不可逆终态** ──
  // 2026-10-23 回收站新增**唯一受控例外**：记录带 restoredAt，且恢复时间晚于本地墓碑的记录
  // 才允许复活。没有 restoredAt 的记录仍走原语义（对端不知情期间的编辑不得复活）。
  //
  // 判定必须**先于**下方 LWW 短路：否则「本地编辑更晚」会把远端墓碑挡回去，
  // 而 pullImpl 的游标随即推过该位置 —— 这条删除再也拉不到，本端滞留对端已删的幽灵记录，
  // 并在下次编辑时以更新的 updatedAt 反向复活（即 §4 的 P0 演化路径）。
  const revivingLocalTombstone =
    isTombstone(local) && !isTombstone(revived) && remoteRestoredAt > localUpdatedAt
  if (isTombstone(local) && !revivingLocalTombstone) {
    // 本端已是墓碑：只进不出，远端更晚的编辑一并丢弃（除非它是显式恢复）
    return 'skip'
  }
  if (isTombstone(revived)) {
    // 本地活着、远端是墓碑：恢复标记比远端删除更晚 → 本地是「恢复后未被对端知晓」的活记录
    if (!isTombstone(local) && localRestoredAt > remoteUpdatedAt) return 'skip'
    // 方案 B（2026-09-15）：本端**从未持有**该记录时不写墓碑 —— 这类墓碑纯属幽灵。
    //   · 删除只经服务端传播、设备之间不直连，本地墓碑并不承担「再传给第三台设备」的职责
    //     （其他设备各自的删除由它们自己从服务端墓碑拉到）；
    //   · 而 pull 游标一旦推过该位置就**永不重拉**，这条墓碑只会长期占着 IndexedDB。
    // 时序上安全：同一 localId 在服务端只有一行（pbId 即 localId 的哈希），
    // 不存在「同一记录的墓碑先到、活版本后到」这种先后关系。
    if (!local) return 'skip'
    // 远端墓碑落到本地：保留本地内容（墓碑时刻的远端业务字段更旧，覆盖无意义），
    // 只翻 deleted 并把 updatedAt 抬到两者较大值 —— 本端墓碑因此在回推时「不比旧墓碑旧」，
    // 不会被任何更旧的副本压回 deleted=0。
    const tombstone: Record<string, unknown> = {
      ...local,
      id: localId,
      updatedAt: Math.max(remoteUpdatedAt, localUpdatedAt),
      deleted: 1,
      rev: Math.max(
        typeof local?.rev === 'number' ? local.rev : 0,
        typeof remote.rev === 'number' ? remote.rev : 0,
      ),
    }
    // 删除是终态：清掉恢复标记；快照取「更晚那次删除」的版本（远端更新则用远端快照）
    delete tombstone.restoredAt
    const snapshot =
      remoteUpdatedAt > localUpdatedAt
        ? (revived as Record<string, unknown>).trashSnapshot
        : (local as Record<string, unknown>).trashSnapshot
    if (snapshot === undefined) delete tombstone.trashSnapshot
    else tombstone.trashSnapshot = snapshot
    // 删除时间取「较晚那次删除」：本地可能有精确的 deletedAt（本端删除），
    // 远端墓碑可能来自老客户端（没有该字段）→ 用它的 updatedAt 近似，绝不拿本地活记录的
    // updatedAt 冒充删除时间（那会把「上次编辑时间」写进回收站）。
    const localDeletedAt =
      typeof local?.deletedAt === 'number' ? (local.deletedAt as number) : 0
    const remoteDeletedAt =
      typeof (revived as Record<string, unknown>).deletedAt === 'number'
        ? ((revived as Record<string, unknown>).deletedAt as number)
        : remoteUpdatedAt
    const mergedDeletedAt = Math.max(localDeletedAt, remoteDeletedAt)
    if (mergedDeletedAt > 0) tombstone.deletedAt = mergedDeletedAt
    else delete tombstone.deletedAt
    await table0.put(tombstone)
    return 'write'
  }

  // LWW：只认 updatedAt，新者胜；相等视为本端已推送的回环副本，跳过
  // （仅适用于「双方都非墓碑」——墓碑已在上面先行收口；显式恢复分支不受此短路）
  if (!revivingLocalTombstone && remoteUpdatedAt <= localUpdatedAt) return 'skip'

  // 本地编辑优先保护（Issue #130）：本地存在尚未推送成功（或推送被跳过的）的 upsert 队列条目时，
  // 远端记录先到一步也不能整体覆盖本地 —— 否则「刚编辑的字段被云端旧值抹掉」
  // （客户关系等嵌套字段的编辑会因整记录覆盖而丢失，表现为「保存了不生效」）。
  // 处理：按被编辑记录逐字段覆盖本地（本地保存的字段取本地值），推送到服务端后自然收敛。
  //
  // 注：走到这里远端必然**不是**墓碑 —— 墓碑已在上方「删除优先」分支收口（2026-09-15 拍板），
  // 因此本分支只需处理「双方都是活记录」的字段级合并，不再需要操心 deleted 被回写的问题。
  const hasPendingLocalEdit =
    !revivingLocalTombstone && (await hasPendingUpsert(table, localId, pendingIndex))
  if (hasPendingLocalEdit && local) {
    const mirroredPending = stripPbMeta(revived)
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
    //
    // Issue #169 P1-A：本条与下方 LWW 分支的 `reviveRemoteJsonFields` 是**两条都必须过**的收口口
    // （`revived` 已在函数开头按表声明还原，这里直接消费 `revived[key]` 即可，不再需要逐表判定）。
    // notes / todos / customerGroups 等表此前既没有声明也没有本分支收口，属同一形状的漏网。
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
    // transactions 多关联（Issue #140）：数组字段同款收口 + 旧单值字段归一化。
    // 两条真实路径都要挡：
    // ① 服务端集合未升级（collections.json 未导入）→ 远端没有 customerIds 键，
    //    直接展开 = 本地刚选的关联被静默清空；
    // ② 老客户端仍推来旧键 customerId（多端混装期）→ 需折进数组，不能另存一份。
    // normalizeTxnLinks 同时做这两件事，并把旧键删掉（双写不双读）。
    if (table === 'transactions') {
      for (const key of ['customerIds', 'todoIds', 'projectIds'] as const) {
        // 与下方 LWW 分支同款写法：先反序列化（revived 已由 rawJsonFromRemote 还原，
        // 但展开 `...mirroredPending` 时 JSON 字符串形态仍可能透传到这里），可解析才覆盖。
        const parsed = toArrayField(revived[key])
        if (parsed) merged[key] = parsed
        else if (!hasJsonValue(merged[key])) delete merged[key]
        // else：保留本地值（本地编辑优先）
      }
      normalizeTxnLinks(merged)
    }
    await attachBlobIfNeeded(table, remote, merged, loadAttachmentBlob)
    await table0.put(merged)
    // 远端形状的 id 是 PB 哈希主键，派生前必须归一成本地 id（端点寻址靠它）
    if (legacySource) await deriveLegacyLinks(table, { ...legacySource, id: localId })
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
    !revivingLocalTombstone &&
    table === 'todos' &&
    ((localDone && !remoteDone) || (localVoided && !remoteVoided && !remoteDone))

  // 速记处置态本地优先（Issue #134 三轮）：与上面的待办终态本地优先同款。
  // 根因是**处置态是单边的**：本地「已处置」（有 convertedTo）、远端「未处置」（convertedTo 空）。
  // 服务端 quickNotes 集合**已收录** convertedAt / convertedVia（随 collections.json 同步升级），
  // 旧版本连 convertedTo 都可能丢，于是换设备 / 重装 / 队列清空后拉一次远端旧记录，处置态被整体抹掉——
  // 已转入待办的速记重新回到「暂存区待处置」，再点一次「转入待办」就多出一条重复待办。
  // 反向不保护：远端有 convertedTo 而本地没有时按 LWW 写入（可能是另一端的处置结果）。
  // （Issue #169 P3：本条注释此前写「服务端集合未收录 convertedAt / convertedVia」，与
  // collections.json 现状不符 —— 属注释漂移，已更正。）
  const keepLocalConverted =
    !revivingLocalTombstone && table === 'quickNotes' && !!local?.convertedTo && !remote.convertedTo

  // 剥离 pb 系统字段与映射字段（与上方保护分支同一套，收口到 stripPbMeta）
  const record: Record<string, unknown> = { ...stripPbMeta(revived) }
  record.id = localId
  record.updatedAt = revivingLocalTombstone
    ? Math.max(remoteUpdatedAt, localUpdatedAt)
    : remoteUpdatedAt
  // 到此双方都非墓碑（墓碑已在上方「删除优先」分支收口）→ 落库必然是活记录
  record.deleted = 0
  record.rev = Math.max(
    typeof local?.rev === 'number' ? local.rev : 0,
    typeof remote.rev === 'number' ? remote.rev : 0,
  )
  // restoredAt 是粘性标记：普通编辑（远端未带）不能把它抹掉
  const stickyRestoredAt = Math.max(localRestoredAt, remoteRestoredAt)
  if (stickyRestoredAt > 0) record.restoredAt = stickyRestoredAt
  else delete record.restoredAt
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
  // 同上：远端形状的 id 是 PB 哈希主键，派生前归一成本地 id
  if (legacySource) await deriveLegacyLinks(table, { ...legacySource, id: localId })
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


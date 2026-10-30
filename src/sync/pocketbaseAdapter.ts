import { db } from '@/db/db'
import { storage } from '@/storage'
import type { Settings } from '@/db/types'
import { DEFAULT_SETTINGS } from '@/db/types'
import { SETTINGS_KEY } from '@/db/types'
import type { SyncAdapter } from './adapter'
import { mergeRemoteRecord, buildPendingUpsertIndex } from './mergeRemote'
import { eventBus, APP_EVENT_NAMES, type AppEvent } from '@/shared/eventBus'
import { isHealthPayload } from './connectivity'
import type { AttachmentBlobLoader, PbRecord as MergePbRecord } from './mergeRemote'

/**
 * PocketBase 同步适配器（Phase 7）—— 原生 fetch 实现，不引入 SDK 依赖
 *
 * 协议（开发计划 2.3）：
 * - push：按队列条目读取本地记录，按 table 映射 pb collection，按 id upsert（存在 PATCH / 不存在 POST），幂等
 * - pull：每表独立游标（db.meta: pb_cursor:<table>），GET ?filter=(updatedAt > cursor)&sort=updatedAt，
 *   LWW 合并：远端 updatedAt 更新才写本地（盖 rev、不入队，避免回环）；deleted 墓碑同样落库
 * - 登录：/api/collections/users/auth-with-password，token 缓存 settings.sync，401 自动重登一次
 * - 未配置 serverUrl → 本地模式：push 全部 ok（与 stub 行为一致）、pull 空结果
 *
 * id 口径：本地 id（如 `ws-main:td:abc123`，含冒号）不是合法的 PB 记录 id（PB 仅允许
 * 15 位字母数字），故采用「确定性哈希 id + localId 字段映射」：
 * - push：pbRecordId = sha256ToBase36_15(localId)（SHA-256 → base36 截取 15 位，确定性可复算），
 *   请求体不携带本地 id，改为携带 `localId` 字段；POST 时 body 带 `id: pbRecordId`
 * - pull：从远端 `localId` 字段还原本地 id（缺失则跳过该记录）
 * - upsert 判存：按 `localId` 字段过滤查询，而非按 id
 *
 * 附件：attachments.blob（Blob）不进 JSON 载荷，push 走 multipart 上传到 pb file 字段，
 * pull 时按 /api/files/ 下载还原；其余字段照常镜像。
 */

/**
 * 参与同步的业务表与集合名映射已收口 `./remoteNormalize`（agentOps 服务端化 P2：
 * 服务端 adapter 需同一套协议常量但不能拖 Dexie），此处 import 本地消费 + re-export
 * 保持既有引用不破坏。
 */
import {
  SYNC_TABLES,
  pbCollection,
  escapePbFilterValue,
  sha256ToBase36_15,
  toPayload,
  stripLocalOnlyFields,
} from './remoteNormalize'
import type { SyncTable } from './remoteNormalize'
export { SYNC_TABLES, pbCollection, escapePbFilterValue } from './remoteNormalize'
export type { SyncTable } from './remoteNormalize'

const SYNC_TABLE_SET: ReadonlySet<string> = new Set(SYNC_TABLES)

/** 附件文件上限：与 collections.json attachments.file.maxSize 保持一致 */
const ATTACHMENT_FILE_MAX_SIZE = 20 * 1024 * 1024

interface PbRecord {
  id: string
  [key: string]: unknown
}

interface SyncSettingsView {
  serverUrl: string
  username: string
  password: string
  token: string
  tokenUserId: string
}

// ─────────────────────────── settings（直读 db.settings，避免与 repositories 形成模块环） ───────────────────────────

async function readSyncSettings(): Promise<SyncSettingsView> {
  const s = (await db.settings.get(SETTINGS_KEY)) as Settings | undefined
  const sync = s?.sync
  return {
    serverUrl: (sync?.serverUrl ?? '').replace(/\/+$/, ''),
    username: sync?.username ?? '',
    password: sync?.password ?? '',
    token: sync?.token ?? '',
    tokenUserId: sync?.tokenUserId ?? '',
  }
}

async function saveToken(token: string, tokenUserId: string): Promise<void> {
  const prev = await db.settings.get(SETTINGS_KEY)
  if (!prev) return // settings 尚未初始化（无偏好写入过）：跳过 token 缓存，下次登录再取
  await db.settings.put({ ...(prev as Settings), sync: { ...prev.sync, token, tokenUserId } })
}

export function isSyncConfigured(cfg?: SyncSettingsView): boolean {
  // 2026-10-15 语义变更（P4 后·同源自动同步）：**只要求地址**。同源部署（Web 版与 PB
  // 同一台机器）时启动即自动填 serverUrl，账号留空 = 「匿名同步模式」——读写走 PB
  // 集合的公开规则（演示/自部署场景，应用本身无登录墙，数据本就公开）。
  // 有账号 = 鉴权模式（正式站/多用户），行为与之前完全一致。
  return !!cfg?.serverUrl
}

/** 是否配置了 users 账号（匿名同步模式下为 false：跳过登录、请求不带 Authorization） */
function hasCreds(cfg: SyncSettingsView): boolean {
  return !!cfg.username && !!cfg.password
}

/**
 * 当前配置的同步中心地址（未配置为空串）。
 *
 * 供顶栏连通性徽章使用。刻意返回**地址**而不是 `isSyncConfigured()` 的布尔：
 * 只填了地址、还没填账号密码时，徽章应当显示「无法连接」（地址是死的），
 * 而不是「仅本机」（那会让用户以为同步中心压根没配）。
 */
export async function getSyncServerUrl(): Promise<string> {
  return (await readSyncSettings()).serverUrl
}

// ─────────────────────────── HTTP 基座 ───────────────────────────

function baseUrl(cfg: SyncSettingsView): string {
  return cfg.serverUrl
}

/** 网络超时：弱网/坏代理下请求悬挂会长期占用同步锁，超时即视为本次失败（等待下轮重试） */
const REQUEST_TIMEOUT_MS = 10_000

async function pbFetch(cfg: SyncSettingsView, path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  if (cfg.token) headers.set('Authorization', cfg.token)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${baseUrl(cfg)}${path}`, { ...init, headers, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 带 401 自动重登一次的请求（重登凭据来自本地 settings，绝不上传到任何第三方；匿名模式无票可重登，401 原样返回） */
async function pbAuthedFetch(
  cfg: SyncSettingsView,
  path: string,
  init: RequestInit,
): Promise<Response> {
  let res = await pbFetch(cfg, path, init)
  if (res.status === 401 && hasCreds(cfg)) {
    await login(cfg)
    res = await pbFetch(cfg, path, init)
  }
  return res
}

/** 检查缓存的 token 是否仍然可用（低成本校验：带 token 请求当前用户） */
async function isTokenFresh(cfg: SyncSettingsView): Promise<boolean> {
  if (!cfg.token) return false
  try {
    const res = await pbFetch(
      cfg,
      '/api/collections/users/records/' + encodeURIComponent(cfg.tokenUserId),
      {
        method: 'GET',
      },
    )
    return res.ok
  } catch {
    return false
  }
}

async function login(cfg: SyncSettingsView): Promise<void> {
  const res = await pbFetch(cfg, '/api/collections/users/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity: cfg.username, password: cfg.password }),
  })
  if (!res.ok) {
    throw new Error(`PocketBase 登录失败（HTTP ${res.status}），请检查服务器地址与账号密码`)
  }
  const data = (await res.json()) as { token?: string; record?: { id?: string } }
  if (!data.token || !data.record?.id) throw new Error('PocketBase 登录响应缺少 token')
  cfg.token = data.token
  cfg.tokenUserId = data.record.id
  await saveToken(data.token, data.record.id)
}

// ─────────────────────────── 记录读写 ───────────────────────────


function bizTable(table: string) {
  if (!SYNC_TABLE_SET.has(table)) throw new Error(`未知的同步表：${table}`)
  return db[table as SyncTable] as unknown as {
    get(id: string): Promise<Record<string, unknown> | undefined>
    toArray(): Promise<Record<string, unknown>[]>
    put(value: Record<string, unknown>): Promise<string>
    delete(id: string): Promise<void>
  }
}


/**
 * 剥离「仅本地使用、服务端集合未定义」的业务字段（Issue #134 三轮）。
 *
 * 背景：`toPayload` 是整记录直推，本地新增的业务字段会一并进入 JSON 载荷。
 * 若目标 PocketBase 实例对**未知字段是严格拒绝**而非静默忽略，`POST/PATCH /records`
 * 会直接 400 —— 该记录永远推不成功、只能卡在队列里靠「本地未推送编辑保护」勉强保住
 * （换设备后即丢），且会反复触发失败重试。
 *
 * 现由 `pb_setup/collections.json` 同步定义 quickNotes.convertedAt / convertedVia，
 * 服务端已具备这两个字段，推送正常。这里保留兜底过滤：老部署（未导入新 collections）
 * 下也不会因未知字段被拒。字段一旦纳入 collections.json，即从此处移除。
 * （LOCAL_ONLY_FIELDS / stripLocalOnlyFields 实现已收口 `./remoteNormalize`，顶部 import 消费。）
 */

/**
 * PocketBase filter 字符串字面量转义（Issue #169 P2-B）。
 *
 * PB 的 filter 是一门小查询语言，字符串字面量用单引号包裹。此前只有 `pbUpsert` 做了
 * `replace(/'/g, "\\'")`，其余拼接点（含增量拉取的 `receivedAt` / `lastId`）直接内插 ——
 * 值本身都来自服务端生成，实际不可控注入面很窄，但属**同一件事有多个写法**的漂移形状：
 * 只要将来有一处值是用户可控的（如按标题/标签搜索），就会成为真实的 filter 注入点。
 *
 * 收口为唯一入口，全仓 filter 拼接一律走它。转义顺序很重要：
 * 先转义反斜杠再转义单引号，否则 `\'` 会被后一步改写成 `\\'`（多出一层反斜杠）。
 */
/** escapePbFilterValue 已收口 `./remoteNormalize`（本文件经顶部 import 消费） */

/**
 * pbUpsert 结果（推送侧需据此决定本地怎么收敛）：
 * - `written`：本次已写入服务端
 * - `skipped-stale`：远端有更新的**活记录**，本端是迟到的旧数据 → 跳过（交由 pull 把远端值拉回）
 * - `skipped-tombstone`：远端是**墓碑**而本端不是 → **拒绝复活**（删除优先），
 *   调用方必须把本地也落删，否则本端会永远停在 deleted=0
 */
type PbUpsertResult =
  | { outcome: 'written' }
  | { outcome: 'skipped-stale' }
  | { outcome: 'skipped-tombstone'; remoteUpdatedAt: number }

/** 幂等 upsert：按 localId 查服务端判存，存在 PATCH、不存在 POST（PocketBase REST 无原生 upsert） */
async function pbUpsert(
  cfg: SyncSettingsView,
  table: string,
  rec: Record<string, unknown>,
): Promise<PbUpsertResult> {
  const localId = String(rec.id)
  const pbRecordId = await sha256ToBase36_15(localId)
  const filter = encodeURIComponent(`localId = '${escapePbFilterValue(localId)}'`)
  // fields 附带 updatedAt（推送侧 LWW 校验，P0-2）与 deleted（删除优先：识别服务端墓碑）。
  // 搭同一次查询取回，不额外增加请求。
  let found = await pbAuthedFetch(
    cfg,
    `/api/collections/${pbCollection(table)}/records?filter=${filter}&fields=id,updatedAt,deleted,restoredAt`,
    { method: 'GET' },
  )
  // 滚动升级兼容：服务端尚未导入 restoredAt 时，PocketBase 对未知 fields 会返回 400。
  // 回退到旧字段只影响「恢复标记」的读取，普通同步不应因 Schema 未升级而整体断掉。
  if (!found.ok && found.status === 400) {
    found = await pbAuthedFetch(
      cfg,
      `/api/collections/${pbCollection(table)}/records?filter=${filter}&fields=id,updatedAt,deleted`,
      { method: 'GET' },
    )
  }
  if (!found.ok) throw new Error(`查询 ${table}/${localId} 失败（HTTP ${found.status}）`)
  const { items } = (await found.json()) as { items?: PbRecord[] }
  const exists = !!items && items.length > 0
  const remoteId = exists ? String(items![0].id) : ''
  let remoteRestoredAt = 0

  if (exists) {
    const remoteUpdatedAt = typeof items![0].updatedAt === 'number' ? items![0].updatedAt : 0
    const localUpdatedAt = typeof rec.updatedAt === 'number' ? rec.updatedAt : 0
    const remoteDeleted = items![0].deleted === 1 || items![0].deleted === true
    remoteRestoredAt =
      typeof items![0].restoredAt === 'number' ? (items![0].restoredAt as number) : 0
    const localRestoredAt =
      typeof rec.restoredAt === 'number' ? (rec.restoredAt as number) : 0

    // 删除优先（2026-09-15 拍板）：服务端已是墓碑，本地这条**活记录**的编辑不得把它复活。
    // 2026-10-23 回收站唯一例外：本地带 restoredAt 且**晚于**远端墓碑时间 → 这是显式恢复。
    //
    // 为什么必须在推送侧挡：同步引擎是**先推后拉**（engine.runSync 先 adapter.push 再 adapter.pull），
    // 而编辑走 2s 去抖、拉取走 30s 心跳 —— 对端「不知情期间」的编辑几乎总是先被推上来，
    // 这一推就会以更新的 updatedAt 把服务端墓碑覆盖成 deleted=0，之后再也无从收敛。
    // 只靠接收侧（mergeRemote 的删除优先）挡不住这条时序，故两个边界都要设防。
    if (remoteDeleted && rec.deleted !== 1 && !(localRestoredAt > remoteUpdatedAt)) {
      console.info(
        `[sync] 拒绝复活已删除记录 ${table}/${localId}（服务端为墓碑，删除优先）`,
      )
      return { outcome: 'skipped-tombstone', remoteUpdatedAt }
    }

    // 推送侧 LWW（P0-2）：服务端已有 updatedAt 更新的记录 → 本条是旧数据迟到，
    // 跳过推送（否则会以「后到覆盖」污染服务端新数据），交由 pull 的 LWW 把远端新值拉回本地。
    // 删除墓碑除外：墓碑 updatedAt 已在 softDelete 时盖章，正常总是最新；且必须推出去才能收敛删除。
    if (remoteUpdatedAt > localUpdatedAt && rec.deleted !== 1) {
      console.info(
        `[sync] 跳过旧数据推送 ${table}/${localId}（远端更新：${remoteUpdatedAt} > ${localUpdatedAt}）`,
      )
      return { outcome: 'skipped-stale' }
    }
  }

  // 载荷 = 业务字段 + localId 映射字段（不带本地 id；仅 POST 时带派生的 pbRecordId）
  const payload: Record<string, unknown> = { ...toPayload(rec), localId }
  // restoredAt 是粘性标记：活记录取本地/远端较大值，普通编辑不能把它抹掉；墓碑不携带。
  if (rec.deleted !== 1) {
    const stickyRestoredAt = Math.max(
      typeof rec.restoredAt === 'number' ? rec.restoredAt : 0,
      remoteRestoredAt,
    )
    if (stickyRestoredAt > 0) payload.restoredAt = stickyRestoredAt
  }
  stripLocalOnlyFields(table, payload)

  if (table === 'attachments' && rec.blob instanceof Blob) {
    // 附件：multipart 表单（file 字段）+ 其余元数据字段
    const form = new FormData()
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) continue
      form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
    const blob = rec.blob as Blob
    form.append(
      'file',
      new File([blob], String(rec.name ?? localId), {
        type: String(rec.mime ?? 'application/octet-stream'),
      }),
    )
    if (!exists) form.append('id', pbRecordId)
    const res = await pbAuthedFetch(
      cfg,
      exists
        ? `/api/collections/${pbCollection(table)}/records/${encodeURIComponent(remoteId)}`
        : `/api/collections/${pbCollection(table)}/records`,
      { method: exists ? 'PATCH' : 'POST', body: form },
    )
    if (!res.ok)
      throw new Error(
        `上传附件 ${localId} 失败（HTTP ${res.status}）：${(await res.text()).slice(0, 200)}`,
      )
    return { outcome: 'written' }
  }

  const body = JSON.stringify(exists ? payload : { ...payload, id: pbRecordId })
  const res = await pbAuthedFetch(
    cfg,
    exists
      ? `/api/collections/${pbCollection(table)}/records/${encodeURIComponent(remoteId)}`
      : `/api/collections/${pbCollection(table)}/records`,
    { method: exists ? 'PATCH' : 'POST', body },
  )
  if (!res.ok)
    throw new Error(
      `推送 ${table}/${localId} 失败（HTTP ${res.status}）：${(await res.text()).slice(0, 200)}`,
    )
  return { outcome: 'written' }
}

/** 服务端物理删除：按 localId 查 pb 记录 id 后 DELETE（用于墓碑收敛后的真删） */
async function pbDeleteRemote(
  cfg: SyncSettingsView,
  table: string,
  localId: string,
): Promise<void> {
  const filter = encodeURIComponent(`localId = '${escapePbFilterValue(localId)}'`)
  const found = await pbAuthedFetch(
    cfg,
    `/api/collections/${pbCollection(table)}/records?filter=${filter}&fields=id`,
    { method: 'GET' },
  )
  if (!found.ok) return // 查询失败不阻塞：墓碑记录仍在服务端，靠 LWW 墓碑兜底
  const { items } = (await found.json()) as { items?: PbRecord[] }
  if (!items || items.length === 0) return
  const res = await pbAuthedFetch(
    cfg,
    `/api/collections/${pbCollection(table)}/records/${encodeURIComponent(String(items[0].id))}`,
    { method: 'DELETE' },
  )
  if (!res.ok && res.status !== 404) {
    console.warn(`[sync] 服务端物理删除失败 ${table}/${localId}（HTTP ${res.status}）`)
  }
}

interface PbListResult {
  items: PbRecord[]
}

async function pbListAll(
  cfg: SyncSettingsView,
  table: string,
  cursor: string,
): Promise<PbRecord[]> {
  const { receivedAt, lastId } = parseCursor(cursor)
  const out: PbRecord[] = []
  for (let page = 1; page <= 500; page++) {
    // 首拉（无游标）按 updatedAt 全量；有游标按 server_received_at 增量，带 id tiebreaker 防同毫秒丢记录
    // 游标值经 escapePbFilterValue 转义（Issue #169 P2-B）：两值均服务端生成，风险低，
    // 但 filter 拼接必须只有一个写法，否则将来某处用户可控即成为注入点
    const filterExpr = receivedAt
      ? `(server_received_at > '${escapePbFilterValue(receivedAt)}' || (server_received_at = '${escapePbFilterValue(receivedAt)}' && id > '${escapePbFilterValue(lastId)}'))`
      : ''
    const params = new URLSearchParams({
      page: String(page),
      perPage: '200',
      sort: 'server_received_at,id',
    })
    if (filterExpr) params.set('filter', filterExpr)
    const res = await pbAuthedFetch(cfg, `/api/collections/${pbCollection(table)}/records?${params}`, {
      method: 'GET',
    })
    if (!res.ok) throw new Error(`拉取 ${table} 失败（HTTP ${res.status}）`)
    const data = (await res.json()) as PbListResult & { totalPages?: number }
    out.push(...(data.items ?? []))
    if (!data.totalPages || page >= data.totalPages) break
  }
  return out
}

/**
 * 拉取远端某集合的**全部记录 id**（对账用，2026-10-30）。
 *
 * 为什么不塞进 `pull()`：对账是低频运维动作，pull 是每轮心跳；把它加进 `SyncAdapter`
 * 接口会连带改 `stubAdapter` 与引擎的类型面，收益为零。
 *
 * 只取 id（`fields=id`）：对账只判「在不在」，不需要字段内容。
 * 分页终止沿用上面的 `totalPages` 口径，**刻意不用 `skipTotal`** —— 那样响应里就没有
 * `totalPages`，终止条件得另写一套，纯属给自己挖坑。
 */
export async function listRemoteIds(table: string): Promise<Set<string>> {
  const cfg = await readSyncSettings()
  const ids = new Set<string>()
  // 未配置同步 = 本地模式，没有"远端"，谈不上对账
  if (!isSyncConfigured(cfg)) return ids
  for (let page = 1; page <= 500; page++) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: '200',
      sort: 'id',
      fields: 'id',
    })
    // 401 → 自动重登一次（pbAuthedFetch 内建），匿名模式下则原样返回错误
    const res = await pbAuthedFetch(cfg, `/api/collections/${pbCollection(table)}/records?${params}`, {
      method: 'GET',
    })
    if (!res.ok) throw new Error(`对账拉取 ${table} 失败（HTTP ${res.status}）`)
    const data = (await res.json()) as { items?: Array<{ id?: string }>; totalPages?: number }
    for (const it of data.items ?? []) if (it?.id) ids.add(it.id)
    if (!data.totalPages || page >= data.totalPages) return ids
  }
  // 兜底：不静默假装拉全 —— 截断时必须留下可查的痕迹
  console.warn(`[sync] 对账拉取 ${table} 超过 500 页，结果已截断`)
  return ids
}

/** pull 附件：下载 pb file 字段还原本地 Blob（失败不阻塞该记录元数据落库） */
async function downloadAttachmentFile(
  cfg: SyncSettingsView,
  rec: PbRecord,
): Promise<Blob | undefined> {
  const filename = rec.file
  if (typeof filename !== 'string' || !filename) return undefined
  const size = typeof rec.size === 'number' ? rec.size : 0
  if (size > ATTACHMENT_FILE_MAX_SIZE) return undefined
  // 安全：token 走 Authorization 头而非 URL query（避免进入历史/日志泄露凭据）
  const url = `${baseUrl(cfg)}/api/files/attachments/${encodeURIComponent(rec.id)}/${encodeURIComponent(filename)}`
  const res = await pbFetch(cfg, url.slice(baseUrl(cfg).length), { method: 'GET' })
  if (!res.ok) return undefined
  return res.blob()
}

// ─────────────────────────── 游标（每表独立，避免跨表同毫秒批量写入丢增量） ───────────────────────────

function cursorKey(table: string): string {
  return `pb_cursor:${table}`
}

/**
 * 每表游标改用服务端接收时间 server_received_at（ISO 字符串，pb autodate 盖戳）：
 * 客户端 updatedAt 依赖本机时钟，多设备同毫秒/时钟偏差会丢增量；
 * server_received_at 单调（由服务端写入）且可排序，同毫秒冲突再以 id 作 tiebreaker。
 * cursor = `${server_received_at}#${lastRemoteId}`。
 */
async function loadCursor(table: string): Promise<string> {
  const entry = await db.meta.get(cursorKey(table))
  return typeof entry?.value === 'string' ? entry.value : ''
}

async function saveCursor(table: string, cursor: string): Promise<void> {
  await db.meta.put({ key: cursorKey(table), value: cursor })
}

/** 解析旧版数值游标（updatedAt 口径）：迁移到 server_received_at 游标时作 0 时刻处理 */
function parseCursor(cursor: string): { receivedAt: string; lastId: string } {
  if (!cursor) return { receivedAt: '', lastId: '' }
  const idx = cursor.indexOf('#')
  if (idx < 0) return { receivedAt: '', lastId: '' } // 旧数值游标：重新按时间全量对账一次
  return { receivedAt: cursor.slice(0, idx), lastId: cursor.slice(idx + 1) }
}

// ─────────────────────────── SyncAdapter 实装 ───────────────────────────

async function pushImpl(
  items: { table: string; recordId: string; op: 'upsert' | 'delete' }[],
): Promise<{ recordId: string; ok: boolean }[]> {
  const cfg = await readSyncSettings()
  if (!isSyncConfigured(cfg)) {
    // 本地模式：与 stub 行为一致（队列照常出队，离线语义不阻塞界面）
    return items.map((it) => ({ recordId: it.recordId, ok: true }))
  }
  // token 缓存优先：仅失效/缺失时才重新登录（避免每轮心跳都全量 auth-with-password）
  if (hasCreds(cfg) && !(await isTokenFresh(cfg))) await login(cfg)
  const results: { recordId: string; ok: boolean }[] = []
  for (const item of items) {
    try {
      const rec = await bizTable(item.table).get(item.recordId)
      if (!rec) {
        // 记录已不存在（如本地墓碑清理早于推送）：无可推送，直接出队
        results.push({ recordId: item.recordId, ok: true })
        continue
      }
      if (item.op === 'delete' || rec.deleted === 1) {
        // 墓碑记录：只把墓碑写进服务端，**绝不**在此处物理删除。
        //
        // 为什么不能「推完就删」（P0：删除不跨设备传播）：
        // 物理删除让服务端行在本端一推即消失，而其他设备仍持有 deleted=0 的旧副本 ——
        // 它们永远拉不到这条删除（没有行可拉），一旦之后对该记录做任何操作（updatedAt 变新），
        // 推送就会以「查不到 → POST 新建」把记录复活，并凭更新的 updatedAt 反过来覆盖本端墓碑。
        // 实测：删除后 100ms 探针从未观测到服务端出现 deleted=1，行存活 <100ms，三处全部复活。
        //
        // 正确收敛路径：服务端保留墓碑（钩子统一盖 tombstonePushed=1 + server_received_at），
        // 对端 pull 按 server_received_at 拉到墓碑并落库为本地删除；
        // 服务端墓碑由 pb_hooks cron 每日 04:00 清理超保留期（30 天）的记录，不会无限膨胀。
        //
        // 判定用「队列 op 是 delete」**或**「记录此刻已是墓碑」：删除优先下沉后，
        // 对端墓碑会被 mergeRemote 落到本端，而队列里可能还留着这条记录更早的 upsert 条目 ——
        // 若只认 op，这条墓碑会以 upsert 路径推上去（结果虽同为 deleted=1，但漏盖标记，见下）。
        await pbUpsert(cfg, item.table, rec)
        // 打「delete 已推送」标记（P0-1）：cleanupTombstones 只物理删除带此标记的墓碑，
        // 避免墓碑先被本地清理而 delete 从未送达服务端、远端数据永不删除的竞态。
        await db.meta.put({ key: tombstonePushedKey(item.table, String(rec.id)), value: 1 })
      } else {
        const upsert = await pbUpsert(cfg, item.table, rec)
        if (upsert.outcome === 'skipped-tombstone') {
          // 删除优先（2026-09-15 拍板）：服务端已是墓碑，本端这条编辑**不允许**把它复活。
          //
          // 仅「跳过推送」是不够的：本端该记录会永远停在 deleted=0 —— 该墓碑的 server_received_at
          // 早已被本表游标推过，pull 不会再拉一次，于是本端留下一条对端已删的幽灵记录，
          // 且每次编辑都会重演一次被拒。故在这里就此地收敛：把对端已发生的删除镜像到本地。
          //
          // 只做「镜像删除」，不重跑业务级联：级联删掉的其他记录由对端推送的对应条目各自到达，
          // 本端 pull 时也会逐条收敛（此处重跑级联反而会以本机时间戳制造一批新的本地变更）。
          await db.meta.put({ key: tombstonePushedKey(item.table, String(rec.id)), value: 1 })
          await bizTable(item.table).put({
            ...rec,
            deleted: 1,
            // 对端墓碑时间即这条删除的真实发生时间（本端只是镜像，不重新计时）
            deletedAt: upsert.remoteUpdatedAt || Date.now(),
            restoredAt: undefined,
            trashSnapshot: undefined,
            updatedAt: Math.max(
              typeof rec.updatedAt === 'number' ? rec.updatedAt : 0,
              upsert.remoteUpdatedAt,
            ),
          })
          console.info(`[sync] 已把服务端墓碑镜像到本地 ${item.table}/${item.recordId}（删除优先）`)
        }
      }
      results.push({ recordId: item.recordId, ok: true })
    } catch (err) {
      console.warn(`[sync] 推送失败 ${item.table}/${item.recordId}`, err)
      results.push({ recordId: item.recordId, ok: false })
    }
  }
  return results
}

async function pullImpl(cursor: number): Promise<{ cursor: number; changes: unknown[] }> {
  const cfg = await readSyncSettings()
  if (!isSyncConfigured(cfg)) return { cursor, changes: [] }
  if (hasCreds(cfg) && !(await isTokenFresh(cfg))) await login(cfg)
  const changes: unknown[] = []
  // 待推送 upsert 索引（审计 C-12）：整轮 pull 只读一次 syncQueue，供各表逐条合并时做集合查找。
  // ⚠️ 可在整轮开始时建一次即安全：mergeRemoteRecord 只写业务表 + 盖 rev，**不入队**，
  // 故这个集合在合并过程中不会变化（旧实现是逐条 filter().count()，属 O(N×M) 重复扫描）。
  const pendingIndex = await buildPendingUpsertIndex()
  for (const table of SYNC_TABLES) {
    const cur = await loadCursor(table)
    const remotes = await pbListAll(cfg, table, cur)
    let maxReceivedAt = parseCursor(cur).receivedAt
    let maxRemoteId = parseCursor(cur).lastId
    for (const remote of remotes) {
      const receivedAt =
        typeof remote.server_received_at === 'string' ? remote.server_received_at : ''
      const rid = String(remote.id)
      if (
        receivedAt &&
        (receivedAt > maxReceivedAt || (receivedAt === maxReceivedAt && rid > maxRemoteId))
      ) {
        maxReceivedAt = receivedAt
        maxRemoteId = rid
      }
      try {
        const loadAttachmentBlob: AttachmentBlobLoader = (r) =>
          downloadAttachmentFile(cfg, r as unknown as MergePbRecord)
        changes.push(await mergeRemoteRecord(table, remote, loadAttachmentBlob, pendingIndex))
      } catch (err) {
        // 单条失败不阻塞整表增量（队列断点续传同款纪律）
        console.warn(`[sync] 合并失败 ${table}/${remote.id}`, err)
      }
    }
    if (maxReceivedAt) await saveCursor(table, `${maxReceivedAt}#${maxRemoteId}`)
  }
  return { cursor, changes }
}

export const pocketBaseAdapter: SyncAdapter = {
  push: pushImpl,
  pull: pullImpl,
}

// ─────────────────────────── P4 agent_events：客户端 replay（方案 §5.4-A） ───────────────────────────

const AGENT_EVENTS_CURSOR_KEY = 'agent_events_cursor'

/**
 * 消费服务端产生的领域事件：服务端执行器写数据时，复合函数 emit 的事件经
 * PocketBaseAdapter.recordEvent 落 PB `agent_events`；各客户端在每轮同步后拉取
 * 并 replay 到本地 eventBus —— 奖杯/EXP 评估逻辑零改动，只是事件源多一个。
 *
 * 幂等性：游标（db.meta）在全部 emit 完成后才推进；中途失败下轮重拉整批 →
 * 重复 emit 由评估侧幂等兜底（奖杯条件满足即解锁、已解锁不重复）。
 * 任何失败都不抛出（事件消费不得阻塞数据同步本身）。
 */
export async function drainAgentEvents(): Promise<void> {
  const cfg = await readSyncSettings()
  if (!isSyncConfigured(cfg)) return
  if (hasCreds(cfg) && !(await isTokenFresh(cfg))) await login(cfg)
  const curEntry = await db.meta.get(AGENT_EVENTS_CURSOR_KEY)
  const since = typeof curEntry?.value === 'number' ? curEntry.value : 0
  const params = new URLSearchParams({
    filter: `occurredAt > ${since}`,
    sort: 'occurredAt',
    perPage: '200',
  })
  const base = cfg.serverUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/api/collections/agent_events/records?${params}`, {
    headers: cfg.token ? { Authorization: cfg.token } : undefined,
  })
  if (!res.ok) return
  const data = (await res.json()) as {
    items?: Array<{ type?: string; payload?: unknown; occurredAt?: number }>
  }
  let maxAt = since
  for (const ev of data.items ?? []) {
    if (typeof ev.type !== 'string' || !ev.type) continue
    if (typeof ev.occurredAt === 'number' && ev.occurredAt > maxAt) maxAt = ev.occurredAt
    // replay 白名单（T3 前置）：服务端行是任意字符串，未知名拒绝分发——此前的
    // `as keyof AppEvent` 盲转型会在事件名泛化后变成穿透分发口。跳过的行游标照常
    // 推进（maxAt 已在上方更新），不让一条脏数据卡住整条 replay 通道。
    if (!(APP_EVENT_NAMES as readonly string[]).includes(ev.type)) {
      console.warn(`[sync] agent_events replay 跳过未知事件名：${ev.type}`)
      continue
    }
    try {
      eventBus.emit(ev.type as keyof AppEvent, (ev.payload ?? {}) as never)
    } catch (err) {
      console.warn(`[sync] agent_events replay 失败 ${ev.type}`, err)
    }
  }
  if (maxAt > since) await db.meta.put({ key: AGENT_EVENTS_CURSOR_KEY, value: maxAt })
}

// ─────────────────────────── 同源自动同步（2026-10-15 用户拍板） ───────────────────────────

/**
 * Web 版与 PocketBase 同源部署（测试站 / 自托管单机）时，**打开即自动启用同步**——
 * 用户不需要知道「同步中心」的存在：服务在一台机器上，浏览器看到的就是中心的数据。
 *
 * 触发条件（三者同时满足）：
 *   1. 浏览器环境（非 Tauri 原生壳——原生端同步中心各设备各配，见多端方案）；
 *   2. 尚未配置同步（serverUrl 为空——**已配置的绝不覆盖**，含手动配置的账号）；
 *   3. 同源 `/api/health` 返回 PocketBase 健康响应（复用 isHealthPayload，防 SPA 回退假绿）。
 *
 * 满足则写入 `serverUrl = 当前站点 origin`（账号留空 = 匿名同步模式，依赖部署侧公开的
 * 集合读写规则）。返回是否实际写入了配置（供启动日志）。
 */
export async function autoConfigureSameOriginSync(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof location === 'undefined') return false
  if (window.location.protocol === 'tauri:') return false
  const cfg = await readSyncSettings()
  if (cfg.serverUrl) return false
  try {
    const res = await fetch('/api/health', { cache: 'no-store' })
    if (!res.ok || !isHealthPayload(await res.text())) return false
  } catch {
    return false
  }
  // settings 尚未建档（全新浏览器：seed 不写 settings，singleton 由首次偏好保存创建）——
  // 就地用默认偏好建档并带上 serverUrl。若仍 return false，用户将永远停在「仅本机」
  // （2026-10-16 无头浏览器复现：全新打开待办 0 条 + 徽章「仅本机」，即本 bug）。
  const prev = (await db.settings.get(SETTINGS_KEY)) as Settings | undefined
  const origin = window.location.origin
  if (!prev) {
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      key: SETTINGS_KEY,
      sync: { ...DEFAULT_SETTINGS.sync, serverUrl: origin },
    } as Settings)
    return true
  }
  if (prev.sync?.serverUrl) return false // 竞态兜底：期间被其它路径配置了
  await db.settings.put({ ...(prev as Settings), sync: { ...prev.sync, serverUrl: origin } })
  return true
}

// ─────────────────────────── 设置页辅助（连接测试 / 全量入队 / 墓碑清理） ───────────────────────────

export async function pbPing(): Promise<{ ok: boolean; message: string }> {
  const cfg = await readSyncSettings()
  if (!cfg.serverUrl) return { ok: false, message: '未配置服务器地址（当前为本地模式）' }
  if (!cfg.username || !cfg.password) return { ok: false, message: '请填写账号与密码' }
  try {
    await login(cfg)
    return { ok: true, message: '连接成功，鉴权通过' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '连接失败' }
  }
}

/**
 * 全量推送：把本地全部业务记录（含墓碑）按当前状态写入同步队列，
 * 供首次接入服务器 / 换服务器时使用。调用方负责随后触发 syncEngine.requestSync()。
 * 注意：入队前请先确认服务端为空或可覆盖（LWW 以 updatedAt 为准，早改不会覆盖晚改）。
 */
export async function enqueueAllForPush(): Promise<number> {
  const now = Date.now()
  let count = 0
  // 收口（审计 P1 补漏 · 2026-10-21）：原为 `db.transaction('rw', [db.syncQueue, ...])` 直写，
  // 经 StorageAdapter 原语等价改写 —— `tx.list` 读全表（含墓碑）、`tx.enqueue` 写同一 syncQueue 表。
  // ⚠️ 语义不变：仍在一个事务内完成「读所有表 + 逐条入队」，失败整体回滚。
  await storage.transaction(
    ['syncQueue', ...SYNC_TABLES],
    async (tx) => {
      for (const table of SYNC_TABLES) {
        const records = await tx.list<{ id: string; deleted?: 0 | 1 }>(table)
        for (const rec of records) {
          await tx.enqueue(table, String(rec.id), rec.deleted ? 'delete' : 'upsert', now)
          count++
        }
      }
    },
  )
  return count
}

/** 墓碑「delete 已推送」标记的 meta key（P0-1：只清理确认推过的墓碑，避免删除丢失） */
function tombstonePushedKey(table: string, localId: string): string {
  return `tombstone_pushed:${table}:${localId}`
}

/** 无标记墓碑是否仍「未收敛」：队列里还留着该记录的待推送条目 */
async function hasQueuedEntry(table: string, localId: string): Promise<boolean> {
  const queued = await db.syncQueue
    .filter((q) => q.table === table && q.recordId === localId && !q.sentAt)
    .count()
  return queued > 0
}

/**
 * 清理两端 30 天前的软删除墓碑（开发计划 2.3：防墓碑膨胀）。
 *
 * 保留条件（2026-09-15 方案 A 放宽，原为「必须有 tombstonePushed 标记」）：
 * **有标记 或 队列中已无该记录的待推送条目**，二者取其一即可清。
 *
 * 为什么必须放宽：无标记的墓碑有两种来源，处置相反，原条件把它们混为一谈 ——
 *   ① **本端删除、delete 尚未送达服务端**（推送失败/离线）→ 必须保留，清掉就永久丢删除；
 *   ② **pull 落库的墓碑**（`mergeRemote` 落删，不经过推送，天然无标记）→ 本端已收敛，纯属垃圾。
 * 方案 A 用「队列里还有没有待推送条目」把两者分开：① 一定有队列条目（推送成功即出队），
 * ② 一定没有。原条件只认标记，于是 ② 类墓碑永远不会被清 —— 每次远端删除都会在对端留一条，
 * 而 pull 游标已推过、永不重拉，只能靠这里才能回收。
 *
 * 时序安全性：①「对端删除 vs 本端编辑」并存时，队列里的 upsert 必须先经推送侧出队
 * （删除优先会把它拒掉并就地镜像），墓碑此刻才满足清理条件；30 天 cutoff 不变，
 * 不会清掉任何新墓碑。
 *
 * 已确认收敛的墓碑清理时对服务端做物理删除（服务端墓碑膨胀由 pb_hooks cron 兜底）。
 */
export async function cleanupTombstones(): Promise<number> {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  let removed = 0
  const cfg = await readSyncSettings()
  const syncEnabled = isSyncConfigured(cfg)
  for (const table of SYNC_TABLES) {
    const t = bizTable(table)
    /**
     * 保留期按**真实删除时间**算，不按 updatedAt。
     *
     * 为什么（2026-10-24）：墓碑的 updatedAt 会被合并反复抬高（取 `max(远端, 本地)`），
     * 用它当 cutoff 等于「每次对端合并都给墓碑续命」—— 一条 2026 年的墓碑可能永远清不掉。
     * 老墓碑没有 deletedAt → 回退 updatedAt（NaN 时 `NaN < cutoff` 为 false，即「不清理」，
     * 与旧行为一致，不会把缺字段的老数据当过期数据删掉）。
     */
    const tombstoneAt = (r: Record<string, unknown>): number =>
      typeof r.deletedAt === 'number'
        ? (r.deletedAt as number)
        : typeof r.updatedAt === 'number'
          ? (r.updatedAt as number)
          : Number.NaN
    const stale = (await t.toArray()).filter(
      (r) => r.deleted === 1 && tombstoneAt(r) < cutoff,
    )
    for (const rec of stale) {
      const localId = String(rec.id)
      const pushed = await db.meta.get(tombstonePushedKey(table, localId))
      const marked = !!pushed && pushed.value === 1
      // 无标记且队列仍留着待推送条目 → delete 尚未送达服务端，保留墓碑待重试
      if (!marked && (await hasQueuedEntry(table, localId))) continue
      if (syncEnabled) {
        await pbDeleteRemote(cfg, table, localId) // 服务端墓碑同步物理清理，防远端膨胀
      }
      await db.meta.delete(tombstonePushedKey(table, localId))
      await t.delete(localId)
      removed++
    }
  }
  return removed
}

// ─────────────────────────── 回收站永久删除的同步前置 ───────────────────────────

/**
 * 把一批**尚未确认送达**的墓碑立即推到服务端（回收站「永久删除」的前置条件）。
 *
 * ## 为什么永久删除必须先走这一步
 *
 * 永久删除是**物理删除本地行**。本地行没了以后，`pushImpl` 再也读不到它
 * （`if (!rec) → 直接出队`），这条删除就永远送不到服务端 —— 而服务端若仍是
 * `deleted=0` 的活记录，其他设备 pull 到的还是活数据；它们任何一次编辑都会
 * 以更新的 `updatedAt` 反过来把记录写回，本端则因为记录已不存在而**拉不到这个复活**。
 * 结果就是「我明明永久删了，一周后它又出现在另一台设备上，而且这台设备看不到」。
 *
 * 所以顺序不可颠倒：**先把墓碑落到服务端并确认成功，再删本地**。
 * 服务端墓碑本身不在这里清理 —— 它由 `pb_hooks` 的每日 cron 按保留期（30 天）回收，
 * 这 30 天正是其他设备（可能长期离线）拉取到该墓碑的窗口。永久删除改变的是
 * **本机立即不可见、不可恢复**，不是「服务端立即消失」。
 *
 * ## 本地模式
 * 未配置同步中心（`serverUrl` 为空）时没有任何远端副本，直接返回 `{ skipped }`，
 * 调用方可以放心物理删除。
 */
export async function pushTombstonesNow(
  entries: { table: string; recordId: string }[],
): Promise<{ pushed: number; skipped: number }> {
  const cfg = await readSyncSettings()
  if (!isSyncConfigured(cfg)) return { pushed: 0, skipped: entries.length }
  if (hasCreds(cfg) && !(await isTokenFresh(cfg))) await login(cfg)

  let pushed = 0
  let skipped = 0
  for (const { table, recordId } of entries) {
    const rec = await bizTable(table).get(recordId)
    // 记录已不在本地/已不是墓碑：无可推送（调用方随后会物理删，语义一致）
    if (!rec || rec.deleted !== 1) {
      skipped++
      continue
    }
    try {
      await pbUpsert(cfg, table, rec)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(
        `永久删除需要先把删除同步到服务器，但推送失败：${detail}。` +
          `请连接同步中心后重试；若同步地址已失效，可先在「设置 → 同步」中改为仅本机再删除。`,
      )
    }
    await db.meta.put({ key: tombstonePushedKey(table, recordId), value: 1 })
    pushed++
  }
  return { pushed, skipped }
}

/** 永久删除成功后清掉「delete 已推送」标记（记录已不存在，标记留在 meta 只是垃圾） */
export async function forgetTombstoneMarks(
  entries: { table: string; recordId: string }[],
): Promise<void> {
  for (const { table, recordId } of entries) {
    await db.meta.delete(tombstonePushedKey(table, recordId))
  }
}

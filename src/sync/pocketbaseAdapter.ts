import { db } from '@/db/db'
import type { Settings } from '@/db/types'
import { SETTINGS_KEY } from '@/db/types'
import type { SyncAdapter } from './adapter'
import { mergeRemoteRecord } from './mergeRemote'
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
 * - push：pbRecordId = pbId(localId)（SHA-256 → base36 截取 15 位，确定性可复算），
 *   请求体不携带本地 id，改为携带 `localId` 字段；POST 时 body 带 `id: pbRecordId`
 * - pull：从远端 `localId` 字段还原本地 id（缺失则跳过该记录）
 * - upsert 判存：按 `localId` 字段过滤查询，而非按 id
 *
 * 附件：attachments.blob（Blob）不进 JSON 载荷，push 走 multipart 上传到 pb file 字段，
 * pull 时按 /api/files/ 下载还原；其余字段照常镜像。
 */

/** 参与同步的业务表（与 pb_setup/collections.json 一一对应，Progress/Settings/瞬态表不同步） */
export const SYNC_TABLES = [
  'workspaces',
  'customers',
  'interactions',
  'ledgers',
  'transactions',
  'todos',
  'todoLists',
  'noteFolders',
  'projects',
  'projectMilestones',
  'notes',
  'quickNotes',
  'habits',
  'habitLogs',
  'trophies',
  'attachments',
  'moduleConfigs',
  'customerGroups',
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

const SYNC_TABLE_SET: ReadonlySet<string> = new Set(SYNC_TABLES)

/**
 * Dexie 表名 → PocketBase 集合名。
 *
 * 只在两者不一致时列明差异；未列出的表名与集合名同名直通。
 * 契约以 `pb_setup/collections.json` 为单源，并由 `src/sync/__tests__/collectionName.parity.test.ts`
 * 断言「每个 SYNC_TABLES 项经此映射后都能在服务端集合清单里找到」，防止任一端改名后静默 404。
 *
 * 历史遗留：`moduleConfigs` 早期在服务端建为下划线命名（`module_configs`），
 * 前端表名沿用驼峰 → 若不映射，该集合的拉取/推送/物理删除全部 404（Issue：功能测试 #100）。
 */
const PB_COLLECTION_NAME: Partial<Record<SyncTable, string>> = {
  moduleConfigs: 'module_configs',
}

/** 取该表对应的 PocketBase 集合名（同步请求路径一律经此，禁止直接拼 table） */
export function pbCollection(table: string): string {
  return PB_COLLECTION_NAME[table as SyncTable] ?? table
}

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
  return !!cfg?.serverUrl && !!cfg.username && !!cfg.password
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

/** 带 401 自动重登一次的请求（重登凭据来自本地 settings，绝不上传到任何第三方） */
async function pbAuthedFetch(
  cfg: SyncSettingsView,
  path: string,
  init: RequestInit,
): Promise<Response> {
  let res = await pbFetch(cfg, path, init)
  if (res.status === 401 && isSyncConfigured(cfg)) {
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

/**
 * 本地 id → 合法 PB 记录 id：SHA-256(localId) 视为大整数转 base36，取前 15 位
 * （不足左补 0）。确定性：同一 localId 永远得到同一 pbId；base36 字符集（0-9a-z）
 * 天然满足 PB 的 15 位字母数字约束。极端碰撞场景由 upsert 的 GET 判存兜底（命中
 * 已有记录走 PATCH）。
 *
 * 注意：用纯 JS SHA-256 而非 crypto.subtle —— HTTP 部署（IP 直连无 HTTPS）是非
 * 安全上下文，crypto.subtle 为 undefined，会阻断全部推送。
 */
function sha256ToBase36_15(input: string): string {
  // 纯 JS SHA-256（FIPS 180-4），输入按 UTF-8 编码
  const utf8 = new TextEncoder().encode(input)
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  const l = utf8.length
  const bitLen = l * 8
  const padded = new Uint8Array((((l + 8) >> 6) + 1) * 64)
  padded.set(utf8)
  padded[l] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 4, bitLen)
  const w = new Array<number>(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    for (let i = 0; i < 8; i++) H[i] = (H[i] + [a, b, c, d, e, f, g, h][i]) | 0
  }
  const hex = H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
  const n = BigInt('0x' + hex)
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  let s = ''
  let v = n
  while (v > 0n) {
    s = alphabet[Number(v % 36n)] + s
    v /= 36n
  }
  return s.padStart(15, '0').slice(0, 15)
}

async function pbId(localId: string): Promise<string> {
  return sha256ToBase36_15(localId)
}

function bizTable(table: string) {
  if (!SYNC_TABLE_SET.has(table)) throw new Error(`未知的同步表：${table}`)
  return db[table as SyncTable] as unknown as {
    get(id: string): Promise<Record<string, unknown> | undefined>
    toArray(): Promise<Record<string, unknown>[]>
    put(value: Record<string, unknown>): Promise<string>
    delete(id: string): Promise<void>
  }
}

/** 服务端字段镜像本地字段：剥离本地 Blob（attachments.blob）与本地 id（由 pbId 派生，不直接上传） */
function toPayload(rec: Record<string, unknown>): Record<string, unknown> {
  const { blob: _blob, id: _id, ...rest } = rec
  return rest
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
 */
const LOCAL_ONLY_FIELDS: Record<string, readonly string[]> = {
  // 暂无：quickNotes.convertedAt / convertedVia 已随 collections.json 同步升级
}

function stripLocalOnlyFields(table: string, payload: Record<string, unknown>): void {
  const keys = LOCAL_ONLY_FIELDS[table]
  if (!keys) return
  for (const k of keys) delete payload[k]
}

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
export function escapePbFilterValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

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
  const pbRecordId = await pbId(localId)
  const filter = encodeURIComponent(`localId = '${escapePbFilterValue(localId)}'`)
  // fields 附带 updatedAt（推送侧 LWW 校验，P0-2）与 deleted（删除优先：识别服务端墓碑）。
  // 搭同一次查询取回，不额外增加请求。
  const found = await pbAuthedFetch(
    cfg,
    `/api/collections/${pbCollection(table)}/records?filter=${filter}&fields=id,updatedAt,deleted`,
    { method: 'GET' },
  )
  if (!found.ok) throw new Error(`查询 ${table}/${localId} 失败（HTTP ${found.status}）`)
  const { items } = (await found.json()) as { items?: PbRecord[] }
  const exists = !!items && items.length > 0
  const remoteId = exists ? String(items![0].id) : ''

  if (exists) {
    const remoteUpdatedAt = typeof items![0].updatedAt === 'number' ? items![0].updatedAt : 0
    const localUpdatedAt = typeof rec.updatedAt === 'number' ? rec.updatedAt : 0
    const remoteDeleted = items![0].deleted === 1 || items![0].deleted === true

    // 删除优先（2026-09-15 拍板）：服务端已是墓碑，本地这条**活记录**的编辑不得把它复活。
    //
    // 为什么必须在推送侧挡：同步引擎是**先推后拉**（engine.runSync 先 adapter.push 再 adapter.pull），
    // 而编辑走 2s 去抖、拉取走 30s 心跳 —— 对端「不知情期间」的编辑几乎总是先被推上来，
    // 这一推就会以更新的 updatedAt 把服务端墓碑覆盖成 deleted=0，之后再也无从收敛。
    // 只靠接收侧（mergeRemote 的删除优先）挡不住这条时序，故两个边界都要设防。
    if (remoteDeleted && rec.deleted !== 1) {
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
  const payload = { ...toPayload(rec), localId }
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
  if (!(await isTokenFresh(cfg))) await login(cfg)
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
  if (!(await isTokenFresh(cfg))) await login(cfg)
  const changes: unknown[] = []
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
        changes.push(await mergeRemoteRecord(table, remote, loadAttachmentBlob))
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
  await db.transaction('rw', [db.syncQueue, ...SYNC_TABLES.map((t) => db[t])], async () => {
    for (const table of SYNC_TABLES) {
      const records = await bizTable(table).toArray()
      for (const rec of records) {
        await db.syncQueue.add({
          table,
          recordId: String(rec.id),
          op: rec.deleted ? 'delete' : 'upsert',
          createdAt: now,
        })
        count++
      }
    }
  })
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
    const stale = (await t.toArray()).filter(
      (r) => r.deleted === 1 && typeof r.updatedAt === 'number' && (r.updatedAt as number) < cutoff,
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

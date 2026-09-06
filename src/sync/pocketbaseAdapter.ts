import { db } from '@/db/db'
import type { Settings } from '@/db/types'
import { SETTINGS_KEY } from '@/db/types'
import type { SyncAdapter } from './adapter'

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
 * id 口径：服务端 collection 的主键 id 为 text（collections.json 定义），直接沿用本地
 * `ws-main:xxx:nanoid` 形态，两端天然同 id 对齐，无需映射表。
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
  'notes',
  'quickNotes',
  'habits',
  'habitLogs',
  'trophies',
  'attachments',
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

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
  return !!cfg?.serverUrl && !!cfg.username && !!cfg.password
}

// ─────────────────────────── HTTP 基座 ───────────────────────────

function baseUrl(cfg: SyncSettingsView): string {
  return cfg.serverUrl
}

async function pbFetch(
  cfg: SyncSettingsView,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (cfg.token) headers.set('Authorization', cfg.token)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(`${baseUrl(cfg)}${path}`, { ...init, headers })
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

async function login(cfg: SyncSettingsView): Promise<void> {
  const res = await fetch(`${baseUrl(cfg)}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

/** 服务端字段镜像本地字段，仅需剥离本地 Blob（attachments.blob），其余原样上传 */
function toPayload(rec: Record<string, unknown>): Record<string, unknown> {
  const { blob: _blob, ...rest } = rec
  return rest
}

/** 幂等 upsert：按 id 查服务端，存在 PATCH、不存在 POST（PocketBase REST 无原生 upsert） */
async function pbUpsert(
  cfg: SyncSettingsView,
  table: string,
  rec: Record<string, unknown>,
): Promise<void> {
  const id = String(rec.id)
  const filter = encodeURIComponent(`id = '${id.replace(/'/g, "\\'")}'`)
  const found = await pbAuthedFetch(
    cfg,
    `/api/collections/${table}/records?filter=${filter}&fields=id`,
    { method: 'GET' },
  )
  if (!found.ok) throw new Error(`查询 ${table}/${id} 失败（HTTP ${found.status}）`)
  const { items } = (await found.json()) as { items?: PbRecord[] }

  if (table === 'attachments' && rec.blob instanceof Blob) {
    // 附件：multipart 表单（file 字段）+ 其余元数据字段
    const form = new FormData()
    for (const [k, v] of Object.entries(toPayload(rec))) {
      if (v === undefined) continue
      form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
    const blob = rec.blob as Blob
    form.append('file', new File([blob], String(rec.name ?? id), { type: String(rec.mime ?? 'application/octet-stream') }))
    const res = await pbAuthedFetch(
      cfg,
      items && items.length > 0
        ? `/api/collections/${table}/records/${encodeURIComponent(id)}`
        : `/api/collections/${table}/records`,
      { method: items && items.length > 0 ? 'PATCH' : 'POST', body: form },
    )
    if (!res.ok) throw new Error(`上传附件 ${id} 失败（HTTP ${res.status}）`)
    return
  }

  const body = JSON.stringify(toPayload(rec))
  const res = await pbAuthedFetch(
    cfg,
    items && items.length > 0
      ? `/api/collections/${table}/records/${encodeURIComponent(id)}`
      : `/api/collections/${table}/records`,
    { method: items && items.length > 0 ? 'PATCH' : 'POST', body },
  )
  if (!res.ok) throw new Error(`推送 ${table}/${id} 失败（HTTP ${res.status}）`)
}

interface PbListResult {
  items: PbRecord[]
}

async function pbListAll(
  cfg: SyncSettingsView,
  table: string,
  filter: string,
): Promise<PbRecord[]> {
  const out: PbRecord[] = []
  for (let page = 1; page <= 500; page++) {
    const params = new URLSearchParams({
      filter: `(updatedAt > ${filter})`,
      sort: 'updatedAt,id',
      page: String(page),
      perPage: '200',
    })
    const res = await pbAuthedFetch(cfg, `/api/collections/${table}/records?${params}`, { method: 'GET' })
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
  const url = `${baseUrl(cfg)}/api/files/attachments/${encodeURIComponent(rec.id)}/${encodeURIComponent(filename)}`
  const res = await fetch(`${url}?token=${encodeURIComponent(cfg.token)}`)
  if (!res.ok) return undefined
  const size = typeof rec.size === 'number' ? rec.size : 0
  if (size > ATTACHMENT_FILE_MAX_SIZE) return undefined
  return res.blob()
}

// ─────────────────────────── 游标（每表独立，避免跨表同毫秒批量写入丢增量） ───────────────────────────

function cursorKey(table: string): string {
  return `pb_cursor:${table}`
}

async function loadCursor(table: string): Promise<number> {
  const entry = await db.meta.get(cursorKey(table))
  return typeof entry?.value === 'number' ? entry.value : 0
}

async function saveCursor(table: string, cursor: number): Promise<void> {
  await db.meta.put({ key: cursorKey(table), value: cursor })
}

// ─────────────────────────── LWW 合并（远端 → 本地，盖 rev 不入队） ───────────────────────────

async function mergeRemote(
  cfg: SyncSettingsView,
  table: string,
  remote: PbRecord,
): Promise<'written' | 'skipped'> {
  const table0 = bizTable(table)
  const local = await table0.get(String(remote.id))
  const remoteUpdatedAt = typeof remote.updatedAt === 'number' ? remote.updatedAt : 0
  const localUpdatedAt = typeof local?.updatedAt === 'number' ? local.updatedAt : 0
  // LWW：只认 updatedAt，新者胜；相等视为本端已推送的回环副本，跳过
  if (remoteUpdatedAt <= localUpdatedAt) return 'skipped'

  // 剥离 pb 系统字段（collectionId/collectionName/created/updated/server_received_at）
  const {
    collectionId: _c,
    collectionName: _n,
    created: _cr,
    updated: _u,
    server_received_at: _s,
    ...mirrored
  } = remote
  const record: Record<string, unknown> = { ...mirrored }
  record.id = String(remote.id)
  record.updatedAt = remoteUpdatedAt
  record.deleted = remote.deleted ? 1 : 0
  record.rev = Math.max(typeof local?.rev === 'number' ? local.rev : 0, typeof remote.rev === 'number' ? remote.rev : 0)

  if (table === 'attachments') {
    const blob = await downloadAttachmentFile(cfg, remote)
    if (blob) record.blob = blob
  }
  await table0.put(record)
  return 'written'
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
  await login(cfg)
  const results: { recordId: string; ok: boolean }[] = []
  for (const item of items) {
    try {
      const rec = await bizTable(item.table).get(item.recordId)
      if (!rec) {
        // 记录已不存在（如本地墓碑清理早于推送）：无可推送，直接出队
        results.push({ recordId: item.recordId, ok: true })
        continue
      }
      await pbUpsert(cfg, item.table, rec)
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
  await login(cfg)
  let maxSeen = cursor
  const changes: unknown[] = []
  for (const table of SYNC_TABLES) {
    const cur = await loadCursor(table)
    const remotes = await pbListAll(cfg, table, String(cur))
    let tableMax = cur
    for (const remote of remotes) {
      const updatedAt = typeof remote.updatedAt === 'number' ? remote.updatedAt : 0
      if (updatedAt > tableMax) tableMax = updatedAt
      try {
        changes.push(await mergeRemote(cfg, table, remote))
      } catch (err) {
        // 单条失败不阻塞整表增量（队列断点续传同款纪律）
        console.warn(`[sync] 合并失败 ${table}/${remote.id}`, err)
      }
    }
    await saveCursor(table, tableMax)
    if (tableMax > maxSeen) maxSeen = tableMax
  }
  return { cursor: maxSeen, changes }
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

/** 清理两端 30 天前的软删除墓碑（开发计划 2.3：防墓碑膨胀） */
export async function cleanupTombstones(): Promise<number> {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  let removed = 0
  for (const table of SYNC_TABLES) {
    const t = bizTable(table)
    const stale = (await t.toArray()).filter(
      (r) => r.deleted === 1 && typeof r.updatedAt === 'number' && (r.updatedAt as number) < cutoff,
    )
    for (const rec of stale) {
      await t.delete(String(rec.id))
      removed++
    }
  }
  return removed
}

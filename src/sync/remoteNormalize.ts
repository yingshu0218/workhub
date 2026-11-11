/**
 * PocketBase 远端记录的纯归一化函数（agentOps 服务端化 P2 抽出）
 *
 * 抽出动机：`pocketbaseAdapter.ts` / `mergeRemote.ts` 的协议常量与记录归一化逻辑
 * 是**纯数据变换**，但两个宿主文件都顶层 import `@/db/db`（Dexie）——服务端执行器
 * （`agent/serverReads.ts` → `storage/pocketbase.ts`）需要同一套「远端行 → 本地形状」
 * 逻辑却不能拖 Dexie。故收口到本文件（零运行时依赖），两个宿主 re-export 保持兼容。
 *
 * ⚠️ 单一事实源：集合名映射 / json 字段表在此一份，`collectionName.parity.test.ts`
 * 与 `mergeNotesJsonRevive.test.ts` 的漂移断言继续生效。
 */

/** 参与同步的业务表（与 pb_setup/collections.json 一一对应，Progress/Settings/瞬态表不同步） */
export const SYNC_TABLES = [
  'activities',
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
  // 关联层（原子化一期 · docs/关联层设计方案-20261025.md）：原子间关联的唯一真源
  'links',
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

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

/** PB filter 字符串字面量转义（反斜杠与单引号；两值均服务端生成，此为纵深防御） */
export function escapePbFilterValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

// ─────────────────────────── 远端记录归一化（自 mergeRemote.ts 抽出） ───────────────────────────

/** 是否墓碑（软删除标记）。服务端 json 字段往返后可能是数字/布尔/字符串形态，统一按真值判定 */
export function isTombstone(r: Record<string, unknown> | undefined): boolean {
  return !!r && (r.deleted === 1 || r.deleted === true || r.deleted === '1')
}

/** 剥离 pb 系统字段（collectionId/collectionName/created/updated/server_received_at）与映射字段 localId */
export function stripPbMeta(revived: Record<string, unknown>): Record<string, unknown> {
  const {
    collectionId: _c,
    collectionName: _n,
    created: _cr,
    updated: _u,
    server_received_at: _s,
    localId: _l,
    ...mirrored
  } = revived
  return mirrored
}

/**
 * 该表下「需要数组语义」的 json 字段（落库前做数组兜底，防前端 `.map`/`.join` 抛错）。
 * 与 `JSON_FIELDS_BY_TABLE` 是同一份声明，只是标出其中**必须是数组**的那些键
 * （intimacy 是对象、moduleConfigs.payload 是任意 json，不做数组兜底）。
 */
const JSON_ARRAY_FIELDS_BY_TABLE: Record<string, readonly string[]> = {
  activities: ['tags'],
  projects: ['aliases'],
  customers: ['tags', 'relations', 'aliases'],
  transactions: ['tags', 'customerIds', 'todoIds', 'projectIds'],
  todos: ['tags'],
  notes: ['tags', 'backlinks', 'mentions'],
  customerGroups: ['includeTags', 'excludeTags'],
}

/**
 * **按表声明的 json 字段表**（`pb_setup/collections.json` 里 type=json 的字段唯一对照源）。
 *
 * Issue #169 审计 P1-A 根因：revive 曾写死 `if (table !== 'customers') return`，
 * 于是 #130 在 customers 上修好的「服务端 json 字段反序列化」没有覆盖到其他表
 * （notes.tags / transactions.customerIds / customerGroups.rules …），
 * 前端 `n.tags.join(' ')` 直接抛 TypeError → 整页 ErrorBoundary。
 * 收口方式：声明式字段表（`无声明 = 该表无 json 字段`），
 * 由 `mergeNotesJsonRevive.test.ts` 的字段表 ↔ collections.json 一致性断言兜住漂移。
 */
export const JSON_FIELDS_BY_TABLE: Record<string, readonly string[]> = {
  agent_credentials: ['capabilities'],
  activities: ['tags', 'trashSnapshot'],
  customers: ['tags', 'relations', 'intimacy', 'aliases', 'trashSnapshot'],
  transactions: ['tags', 'customerIds', 'todoIds', 'projectIds', 'trashSnapshot'],
  todos: ['tags', 'trashSnapshot'],
  habits: ['trashSnapshot'],
  notes: ['tags', 'backlinks', 'mentions', 'trashSnapshot'],
  noteFolders: ['trashSnapshot'],
  todoLists: ['trashSnapshot'],
  projects: ['trashSnapshot', 'aliases'],
  customerGroups: ['includeTags', 'excludeTags', 'rules', 'trashSnapshot'],
  moduleConfigs: ['payload', 'trashSnapshot'],
  // 关联层：meta 是对象型 json（不进 JSON_ARRAY_FIELDS_BY_TABLE，只做一层反序列化）
  links: ['meta', 'trashSnapshot'],
  operations: ['result', 'plan'],
  operation_effects: ['before', 'after'],
  // ⚠️ 旧关联键（transactions 数组 / notes mentions,backlinks / customers relations）的登记
  // 刻意保留：服务端列永不删除（PATCH 不带键就不清列，老客户端还在写），pull 侧要先
  // 反序列化才能派生成 link、再剥键（mergeRemote 的 MIGRATED_LINK_TABLES 流程）。
  // 删登记 = 派生拿到 JSON 字符串解析不出 = 新设备拉到的旧关联凭空丢失。
  workspaces: ['trashSnapshot'],
  interactions: ['trashSnapshot'],
  ledgers: ['trashSnapshot'],
  quickNotes: ['trashSnapshot'],
  habitLogs: ['trashSnapshot'],
  trophies: ['trashSnapshot'],
  attachments: ['trashSnapshot'],
  projectMilestones: ['trashSnapshot'],
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
 * 故落库前统一反序列化，一次覆盖所有分支。
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

/**
 * 落库前把服务端的 json 字段反序列化回本地形态（按表声明走 `JSON_FIELDS_BY_TABLE`）。
 *
 * 数组语义字段（`tags` / `mentions` / `backlinks` …）走 `toSafeArrayField`；
 * 其余 json 字段（`intimacy` 对象、`moduleConfigs.payload` 任意 json）只做一层反序列化。
 *
 * 任何**合并分支**落库前都必须先过这里（#130 教训：只在其中一条分支归一化 = 另一条分支照样白屏）。
 */
export function reviveRemoteJsonFields(table: string, record: Record<string, unknown>): void {
  const fields = JSON_FIELDS_BY_TABLE[table]
  if (!fields) return
  const arrayFields = JSON_ARRAY_FIELDS_BY_TABLE[table] ?? []
  for (const key of fields) {
    if (!(key in record)) continue
    record[key] = arrayFields.includes(key)
      ? toSafeArrayField(record[key])
      : rawJsonFromRemote(record[key])
  }
}

// ─────────────────────────── 写路径协议（P3 自 pocketbaseAdapter.ts 抽出） ───────────────────────────

/**
 * 本地 id → 合法 PB 记录 id：SHA-256(localId) 视为大整数转 base36，取前 15 位
 * （不足左补 0）。确定性：同一 localId 永远得到同一 pbId；base36 字符集（0-9a-z）
 * 天然满足 PB 的 15 位字母数字约束。极端碰撞场景由 upsert 的 GET 判存兜底（命中
 * 已有记录走 PATCH）。
 *
 * 注意：用纯 JS SHA-256 而非 crypto.subtle —— HTTP 部署（IP 直连无 HTTPS）是非
 * 安全上下文，crypto.subtle 为 undefined，会阻断全部推送。
 */
export function sha256ToBase36_15(input: string): string {
  // 纯 JS SHA-256（FIPS 180-4），输入按 UTF-8 编码
  // PB JSVM 没有 TextEncoder/BigInt；相同字节编码与长除法保持既有 ID 逐字一致。
  const bytes: number[] = []
  for (const character of input) {
    let c = character.codePointAt(0)!
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | c >> 6, 0x80 | c & 63)
    else if (c < 0x10000) bytes.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63)
    else bytes.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63)
  }
  const utf8 = new Uint8Array(bytes)
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
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  let s = ''
  let digits = hex.split('').map(c => parseInt(c, 16))
  while (digits.length) {
    let remainder = 0
    const quotient: number[] = []
    for (const digit of digits) {
      const value = remainder * 16 + digit
      const next = Math.floor(value / 36)
      if (quotient.length || next) quotient.push(next)
      remainder = value % 36
    }
    s = alphabet[remainder] + s
    digits = quotient
  }
  return s.padStart(15, '0').slice(0, 15)
}

/** 服务端字段镜像本地字段：剥离本地 Blob（attachments.blob）与本地 id（由 pbId 派生，不直接上传） */
export function toPayload(rec: Record<string, unknown>): Record<string, unknown> {
  const { blob: _blob, id: _id, ...rest } = rec
  return rest
}

export const LOCAL_ONLY_FIELDS: Record<string, readonly string[]> = {
  // 暂无：quickNotes.convertedAt / convertedVia 已随 collections.json 同步升级
}

/** 剥离「仅本地使用、服务端集合未定义」的业务字段（Issue #134 兜底，见 LOCAL_ONLY_FIELDS 注释） */
export function stripLocalOnlyFields(table: string, payload: Record<string, unknown>): void {
  const keys = LOCAL_ONLY_FIELDS[table]
  if (!keys) return
  for (const k of keys) delete payload[k]
}

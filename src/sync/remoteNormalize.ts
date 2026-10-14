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
  customers: ['tags', 'relations'],
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
const JSON_FIELDS_BY_TABLE: Record<string, readonly string[]> = {
  customers: ['tags', 'relations', 'intimacy'],
  transactions: ['tags', 'customerIds', 'todoIds', 'projectIds'],
  todos: ['tags'],
  notes: ['tags', 'backlinks', 'mentions'],
  customerGroups: ['includeTags', 'excludeTags', 'rules'],
  moduleConfigs: ['payload'],
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

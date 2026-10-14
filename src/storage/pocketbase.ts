import type { SyncOp, StorageAdapter, TableName } from './types'
import type { SyncMeta } from '@/db/types'
import {
  escapePbFilterValue,
  isTombstone,
  pbCollection,
  reviveRemoteJsonFields,
  stripPbMeta,
} from '@/sync/remoteNormalize'

/**
 * PocketBaseAdapter —— StorageAdapter 的服务端实现（agentOps 服务端化 P2，**只读**）
 *
 * 职责：服务端执行器（relay 内置，跑在 VPS）经本适配器**直读 PocketBase 中心**，
 * 读工具（resolveEntity / list* / getCustomer / searchEntities）不再依赖某台浏览器在线。
 * 集合名映射与远端记录归一化复用 `sync/remoteNormalize`（与客户端同步引擎同一套协议，
 * 单一事实源）。
 *
 * ⚠️ P2 边界（方案 §6）：**只实现读路径**。transaction 的写原语（put/update/enqueue）
 * 一律抛可操作错误——写工具在 P3 落地（需 LWW 盖章 + 确认票据 + 事件集合），提前放行
 * 会绕过全部业务编排产出脏数据。读工具链（reads.ts / resolver.ts）只调 get/list，不受影响。
 *
 * id 口径（与 sync/pocketbaseAdapter.ts 一致）：本地业务 id（如 `ws-main:td:abc123`）
 * 存在服务端 `localId` 字段，服务端记录 id 是确定性哈希——读取按 localId 过滤/映射。
 *
 * 鉴权：users/auth-with-password（与客户端同步同端点），token 内存缓存、401 重登一次。
 * 凭据由调用方（serve.mjs env）注入，不落盘、不进日志。
 */

export interface PocketBaseAdapterOptions {
  /** PB 基址（如 http://127.0.0.1:9002，服务端执行器与 PB 同机走回环） */
  baseUrl: string
  /**
   * users 账号（**可选**）：集合 listRule/viewRule 公开（实测测试站 customers/todos 公开读）
   * 时留空走匿名——服务端执行器 env 只配 URL，零凭据；读规则收紧时才需要配置。
   */
  account?: string
  password?: string
  /** 测试注入用；缺省 globalThis.fetch（Node 18+ 原生） */
  fetchImpl?: typeof fetch
}

interface PbListResult {
  page: number
  totalPages: number
  items: Record<string, unknown>[]
}

export function createPocketBaseAdapter(opts: PocketBaseAdapterOptions): StorageAdapter {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const base = opts.baseUrl.replace(/\/$/, '')
  let token: string | null = null

  const hasCreds = !!(opts.account && opts.password)

  async function auth(): Promise<void> {
    const res = await fetchImpl(`${base}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: opts.account, password: opts.password }),
    })
    if (!res.ok) {
      throw new Error(`[pb-adapter] 鉴权失败（HTTP ${res.status}），检查服务端执行器凭据配置`)
    }
    const data = (await res.json()) as { token?: string }
    token = typeof data.token === 'string' && data.token ? data.token : null
    if (!token) throw new Error('[pb-adapter] 鉴权响应缺少 token')
  }

  async function api(path: string, retry = true): Promise<Response> {
    if (!token && hasCreds) await auth()
    const res = await fetchImpl(`${base}${path}`, {
      headers: token ? { Authorization: token } : undefined,
    })
    // 401：有凭据 → 自动重登一次重试（token 过期）；匿名 → 集合读规则未公开，给可操作错误
    if (res.status === 401 && retry) {
      if (!hasCreds) {
        throw new Error(
          `[pb-adapter] 读取被拒（HTTP 401）：集合读规则未公开且未配置服务端凭据（WORKHUB_PB_ACCOUNT/PASSWORD）`,
        )
      }
      token = null
      await auth()
      return api(path, false)
    }
    return res
  }

  /** 分页拉全表（含软删行——与 Dexie list 语义对齐，过滤 deleted 是调用方职责） */
  async function listRemote(table: TableName): Promise<Record<string, unknown>[]> {
    const collection = pbCollection(table)
    const out: Record<string, unknown>[] = []
    for (let page = 1; page <= 500; page++) {
      const params = new URLSearchParams({ page: String(page), perPage: '200' })
      const res = await api(`/api/collections/${collection}/records?${params}`)
      if (!res.ok) throw new Error(`[pb-adapter] 读取 ${table} 失败（HTTP ${res.status}）`)
      const data = (await res.json()) as PbListResult
      out.push(...(data.items ?? []))
      if (!data.totalPages || page >= data.totalPages) break
    }
    return out
  }

  /**
   * 远端行 → 本地形状：id 用 localId 还原、剥 pb 系统字段、json 字段反序列化、
   * deleted 真值统一（数字/布尔/字符串）——与客户端 pull 合并同一套归一化。
   * 缺 localId 的记录无法映射回业务 id，跳过（与客户端同步引擎同口径，不猜）。
   */
  function normalize(table: TableName, remote: Record<string, unknown>): (Record<string, unknown> & SyncMeta) | null {
    const localId = remote.localId
    if (typeof localId !== 'string' || !localId) return null
    const revived: Record<string, unknown> = { ...stripPbMeta(remote), id: localId }
    reviveRemoteJsonFields(table, revived)
    revived.deleted = isTombstone(remote) ? 1 : 0
    return revived as Record<string, unknown> & SyncMeta
  }

  async function apiList(table: TableName): Promise<(Record<string, unknown> & SyncMeta)[]> {
    const rows: (Record<string, unknown> & SyncMeta)[] = []
    for (const remote of await listRemote(table)) {
      const rec = normalize(table, remote)
      if (rec) rows.push(rec)
    }
    return rows
  }

  async function apiGet(table: TableName, id: string): Promise<(Record<string, unknown> & SyncMeta) | undefined> {
    // 按 localId 精确过滤（与 push 侧 upsert 判存同口径；业务 id 含冒号，须经 filter 转义）
    const params = new URLSearchParams({
      filter: `localId='${escapePbFilterValue(id)}'`,
      perPage: '1',
    })
    const res = await api(`/api/collections/${pbCollection(table)}/records?${params}`)
    if (!res.ok) throw new Error(`[pb-adapter] 读取 ${table}/${id} 失败（HTTP ${res.status}）`)
    const data = (await res.json()) as PbListResult
    const first = (data.items ?? [])[0]
    return first ? normalize(table, first) ?? undefined : undefined
  }

  return {
    async transaction(_tables, _fn) {
      throw new Error(
        '[pb-adapter] 服务端执行器当前为只读（P2）：写工具将在 P3 落地（LWW 盖章 + 确认票据 + 事件集合），当前请经浏览器桥执行',
      )
    },
    // 归一化产物是运行时形状（Record & SyncMeta）；调用方（reads/resolver）以各自实体
    // 泛型消费——与 DexieAdapter 的 `as never` 同款处理，运行时字段即实体字段。
    get: async (table, id) => (await apiGet(table, id)) as never,
    list: async (table) => (await apiList(table)) as never,
    requestSync() {
      // no-op：服务端直读中心，无本地同步引擎
    },
  }
}

/** 供类型引用（SyncOp 语义与 syncQueue 同源；P3 写路径启用） */
export type { SyncOp }

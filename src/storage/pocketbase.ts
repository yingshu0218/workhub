import type { SyncOp, StorageAdapter, StorageTx, TableName } from './types'
import type { SyncMeta } from '@/db/types'
import {
  escapePbFilterValue,
  isTombstone,
  pbCollection,
  reviveRemoteJsonFields,
  sha256ToBase36_15,
  stripLocalOnlyFields,
  stripPbMeta,
  toPayload,
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

  /** 统一请求出口：自动附鉴权；401 有凭据重登一次重试 / 匿名给可操作错误 */
  async function api(
    path: string,
    init?: { method?: string; body?: unknown },
    retry = true,
  ): Promise<Response> {
    if (!token && hasCreds) await auth()
    const res = await fetchImpl(`${base}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: token } : undefined),
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    if (res.status === 401 && retry) {
      if (!hasCreds) {
        throw new Error(
          `[pb-adapter] 请求被拒（HTTP 401）：集合规则未公开且未配置服务端凭据（WORKHUB_PB_ACCOUNT/PASSWORD）`,
        )
      }
      token = null
      await auth()
      return api(path, init, false)
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

  /**
   * 物理删除远端记录（按 localId 定位 PB 记录 id 后 DELETE）。
   *
   * 幂等：查不到即视为已删除，直接返回（与 `pbDeleteRemote` 同口径）。
   * 注意这是**真删**，不是写墓碑 —— 服务端脚本/执行器侧只应在回收站永久删除的
   * 收尾处调用（墓碑已由客户端先行写入并同步收敛），否则会把删除传播断掉。
   */
  async function apiDelete(table: TableName, id: string): Promise<void> {
    const collection = pbCollection(table)
    const params = new URLSearchParams({
      filter: `localId='${escapePbFilterValue(id)}'`,
      perPage: '1',
    })
    const found = await api(`/api/collections/${collection}/records?${params}`)
    if (!found.ok) throw new Error(`[pb-adapter] 删除前查询 ${table}/${id} 失败（HTTP ${found.status}）`)
    const data = (await found.json()) as PbListResult
    const first = (data.items ?? [])[0]
    if (!first) return
    const res = await api(`/api/collections/${collection}/records/${encodeURIComponent(String(first.id))}`, {
      method: 'DELETE',
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`[pb-adapter] 删除 ${table}/${id} 失败（HTTP ${res.status}）`)
    }
  }

  // ───────────────────────── 写路径（P3：服务端执行器直写 PB 中心） ─────────────────────────

  /**
   * 幂等 upsert（与客户端同步引擎 pbUpsert 同协议，**但无 LWW 拒绝**）：
   * 按 localId 判存 → 存在 PATCH / 不存在 POST（body.id = sha256ToBase36_15(localId)）。
   *
   * 为什么不做 LWW/skip：客户端推送侧的 skip 语义防的是「迟到的旧副本覆盖新数据」；
   * 服务端执行器是**当下被确认的写意图**（用户确认过/低风险直执行），若目标记录已被
   * 删除，写工具链上游的 mustExist 早已拒绝——能走到这里的 put 都是合法写入，直写。
   *
   * SyncMeta（updatedAt/rev/deleted）由调用方（repository 复合函数）盖章——层内不盖章
   * 的原则与 DexieAdapter 一致；PB hook 会另盖 server_received_at。
   */
  async function upsert(table: TableName, record: Record<string, unknown>): Promise<void> {
    const localId = String(record.id ?? '')
    if (!localId) throw new Error('[pb-adapter] put 缺少记录 id')
    const collection = pbCollection(table)
    const payload: Record<string, unknown> = {
      ...toPayload(record),
      localId,
    }
    stripLocalOnlyFields(table, payload)
    // 判存：按 localId 精确过滤（与 push 侧同口径）
    const findParams = new URLSearchParams({
      filter: `localId='${escapePbFilterValue(localId)}'`,
      perPage: '1',
    })
    const found = await api(`/api/collections/${collection}/records?${findParams}`)
    if (!found.ok) throw new Error(`[pb-adapter] 判存失败 ${table}/${localId}（HTTP ${found.status}）`)
    const foundData = (await found.json()) as PbListResult
    const existing = (foundData.items ?? [])[0]
    const base_ = `/api/collections/${collection}/records`
    if (existing) {
      const res = await api(`${base_}/${encodeURIComponent(String(existing.id))}`, {
        method: 'PATCH',
        body: payload,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`[pb-adapter] 更新 ${table}/${localId} 失败（HTTP ${res.status}）：${detail.slice(0, 200)}`)
      }
      return
    }
    const res = await api(base_, {
      method: 'POST',
      body: { ...payload, id: sha256ToBase36_15(localId) },
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`[pb-adapter] 创建 ${table}/${localId} 失败（HTTP ${res.status}）：${detail.slice(0, 200)}`)
    }
  }

  return {
    /**
     * 事务语义（P3）：PB 无跨表事务 API，这里**不伪装原子性**——tx 的 get/put/update/list
     * 逐操作即时落 PB（put 即 upsert），任一步失败即抛错交由 executor 转可操作错误。
     * 复合函数的「先读后写」一致性由「PB 写入立即可读」保证；跨表原子性本就不存在
     * （与客户端同步队列的逐条推送同量级），LWW 保证最终收敛。
     */
    async transaction(_tables, fn) {
      const tx: StorageTx = {
        async get(table, id) {
          return (await apiGet(table, id)) as never
        },
        async put(table, record) {
          await upsert(table, record as Record<string, unknown>)
        },
        async update(table, id, patch) {
          // 服务端无原地 update：get 当前值 → merge → upsert（复合函数已带新盖章）
          const cur = await apiGet(table, id)
          const merged = { ...(cur ?? { id }), ...patch, id }
          await upsert(table, merged)
        },
        async delete(table, id) {
          await apiDelete(table, id)
        },
        async enqueue() {
          // no-op：服务端写的 PB 就是同步中心本身，无本地队列
        },
        async list(table) {
          return (await apiList(table)) as never
        },
      }
      return fn(tx)
    },
    // 归一化产物是运行时形状（Record & SyncMeta）；调用方（reads/resolver）以各自实体
    // 泛型消费——与 DexieAdapter 的 `as never` 同款处理，运行时字段即实体字段。
    get: async (table, id) => (await apiGet(table, id)) as never,
    list: async (table) => (await apiList(table)) as never,
    /** 服务端直写中心：写后无需触发同步（客户端靠既有 pull 心跳收敛） */
    requestSync() {},
    /** P4 agent_events：服务端复合函数 emit 的领域事件落 PB，客户端 pull 后 replay（方案 §5.4-A） */
    recordEvent: async (event, payload, tool, occurredAt) => {
      const res = await api('/api/collections/agent_events/records', {
        method: 'POST',
        // occurredAt = emit 时刻（T3 信封 as-built：事件发生与 PB 落库之间隔着队列，
        // 落库时刻是错误的语义）；缺省回落 Date.now()（兼容旧调用方）
        body: { type: event, payload, tool, occurredAt: occurredAt ?? Date.now() },
      })
      if (!res.ok) {
        // 事件落库失败**不阻断写操作本身**（写已成功）：记错误日志，客户端评估会延迟但不丢
        // （该客户端下次任意本地事件仍会触发全量评估）。这里吞掉异常只打 stderr。
        const detail = await res.text().catch(() => '')
        console.error(`[pb-adapter] agent_events 落库失败 ${event}（HTTP ${res.status}）：${detail.slice(0, 150)}`)
      }
    },
  }
}

/** 供类型引用（SyncOp 语义与 syncQueue 同源；P3 写路径启用） */
export type { SyncOp }

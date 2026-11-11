import type { StorageAdapter, TableName } from './types'
import type { Command } from '@/commands/core'
import type { SyncMeta } from '@/db/types'
import { stagePlan, requestId, type CommandTransport, type Receipt } from './commandPlan'
import {
  escapePbFilterValue,
  isTombstone,
  pbCollection,
  reviveRemoteJsonFields,
  stripPbMeta,
} from '@/sync/remoteNormalize'

/** 服务端读取与命令传输宿主；写入只能经共享计划和 PB 事务，不逐条 HTTP 写集合。 */
export class CommandError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

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
  token?: () => string | null
  agentKey?: string
  /** 执行器部署白名单只进一步收窄写能力，不赋予凭据新能力。 */
  writeDomains?: Record<string, boolean>
}

interface PbListResult {
  page: number
  totalPages: number
  items: Record<string, unknown>[]
}

export function createPocketBaseAdapter(opts: PocketBaseAdapterOptions): StorageAdapter & { transport: CommandTransport; queryFinance(input: unknown): Promise<Record<string, unknown>>; personal(path: string, input: unknown, headers?: Record<string, string>): Promise<Record<string, unknown>> } {
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
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
    retry = true,
  ): Promise<Response> {
    if (opts.token) token = opts.token()
    if (!token && hasCreds) await auth()
    const res = await fetchImpl(`${base}${path}`, {
      signal: AbortSignal.timeout(15000),
      method: init?.method ?? 'GET',
      headers: {
        ...(init?.body !== undefined && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: token } : undefined),
        ...(opts.agentKey ? { 'X-Workhub-Agent-Key': opts.agentKey } : {}),
        ...(opts.writeDomains ? { 'X-Workhub-Write-Domains': JSON.stringify(opts.writeDomains) } : {}),
        ...init?.headers,
      },
      ...(init?.body !== undefined ? { body: init.body instanceof FormData ? init.body : JSON.stringify(init.body) } : {}),
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
      if (page === 500) throw new Error('LIMIT_EXCEEDED: 读取超限，请使用分页查询')
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

  const transport: CommandTransport = {
    async preview(command) {
      const res = await api('/api/workhub/preview', { method: 'POST', body: command })
      const body = await res.json() as Command & { error?: string }
      if (!res.ok) throw new Error(body.error || '预览保存失败')
      return body
    },
    async stageAttachment(row, blob) {
      const data = new FormData()
      data.append('file', blob, String(row.name || 'attachment'))
      const res = await api('/api/workhub/stage-attachment', { method: 'POST', body: data })
      const body = await res.json() as { stageId?: string; error?: string }
      if (!res.ok || !body.stageId) throw new Error(body.error || '附件暂存失败')
      return body.stageId
    },
    async generation() {
      const res = await api('/api/workhub/state')
      const data = await res.json() as { generation?: string; error?: string }
      if (!res.ok || !data.generation) throw new Error(data.error || '命令服务不可用，请升级服务端')
      return data.generation
    },
    async commit(command) {
      const res = await api('/api/workhub/commands', { method: 'POST', body: command })
      const data = await res.json() as Receipt & { error?: string }
      if (!res.ok) throw new CommandError(data.error || `命令失败 HTTP ${res.status}`, res.status)
      return data
    },
    async lookup(requestId, generation, intent) {
      const res = await api('/api/workhub/operations/lookup', { method: 'POST', body: { requestId, generation, intent } })
      const data = await res.json() as { committed: boolean; receipt?: Receipt; pending?: Command; error?: string }
      if (!res.ok) throw new Error(data.error || '操作状态查询失败')
      return data
    },
  }
  const source = { get: async (table: string, id: string) => await apiGet(table, id) as never, list: async (table: string) => await apiList(table) as never,
    query: async <T extends { id: string }>(table: string, scope: import('@/commands/scope').Scope): Promise<(T & SyncMeta)[]> => {
      const response = await api('/api/workhub/scoped', { method: 'POST', body: { table, scope } })
      const body = await response.json() as { items: (T & SyncMeta)[]; error?: string }
      if (!response.ok) throw new Error(body.error || '范围查询失败')
      return body.items
    },
  }
  return {
    commandMode: true,
    ...source, transport,
    async personal(path, input, headers) {
      const response = await api('/api/workhub/' + path, { method: 'POST', body: input, headers })
      const body = await response.json() as Record<string, unknown>
      if (!response.ok) throw new CommandError(String(body.error || '业务请求失败'), response.status)
      return body
    },
    async queryFinance(input) {
      const res = await api('/api/workhub/finance', { method: 'POST', body: input || {} })
      const body = await res.json() as Record<string, unknown>
      if (!res.ok) throw new Error(String(body.error || '财务查询失败'))
      return body
    },
    async transaction(_tables, fn) {
      const generation = await transport.generation()
      const plan = stagePlan(source)
      const result = await fn(plan.tx)
      if (plan.writes().length) await transport.commit(plan.command(generation, requestId()))
      return result
    },
    requestSync() {},
  }
}

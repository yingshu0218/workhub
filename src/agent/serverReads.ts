import { projectRecord, TABLE_DOMAIN } from '@/commands/personal'
import { AsyncLocalStorage } from 'node:async_hooks'
import { PERSONAL_TOOL_MAP } from './personalTools'
import { stagePlan, requestId as newRequestId } from '@/storage/commandPlan'
import type { StorageAdapter } from '@/storage/types'
import { eventBus, setEventInterceptor, type AppEvent } from '@/shared/eventBus'
import { z } from 'zod'
import { createPocketBaseAdapter } from '@/storage/pocketbase'
import { setStorageAdapter } from '@/storage'
import { dispatchAgentTool, AGENT_TOOLS } from './executor'
import { TOOL_RISK, TOOL_DOMAIN, resolveEntitySchema } from './schema'
import { toolJsonSchema } from './jsonSchema'
import { needsPreview, previewEnvelope } from './confirmFlow'
import { resolveEntity, type ResolveResult } from './resolver'
import {
  listTransactions,
  getCustomer,
  listTodos,
  listLedgers,
  listHabits,
  listLinks,
  listProjects,
  listNotes,
  listNoteFolders,
  searchEntities,
  listTransactionsSchema,
  getCustomerSchema,
  listTodosSchema,
  listLedgersSchema,
  listHabitsSchema,
  listProjectsSchema,
  listNotesSchema,
  listNoteFoldersSchema,
  listLinksSchema,
  searchEntitiesSchema,
} from './reads'

/**
 * 服务端执行器（agentOps 服务端化，方案 docs/agentOps服务端化方案.md）
 *
 * **独立打包入口**（`scripts/build-server-executor.mjs` → `dist-server/server-executor.mjs`）：
 * - P2：10 个读工具（storage/pocketbase 直读 PB 中心，浏览器桥不在线也可用）；
 * - **P3：全量 27 工具**——写工具经 executor 同一份 dispatch（repositories 复合函数语义，
 *   数据关联关系与人在界面上操作一致），写入经 PocketBaseAdapter 落 PB 中心，
 *   客户端靠既有 pull 收敛。中/高风险写工具无票时返回 preview 信封（confirmFlow 共享模块，
 *   与浏览器桥逐字段一致）；票据签发/核销仍在 relay。
 *
 * ⚠️ 服务端事件边界（方案 §5.4，P4 处理）：写工具 emit 的领域事件在服务端 bundle 里
 * 无消费者（eventBus 空转）——奖杯/EXP 评估仍由各客户端在 pull 收敛后自行触发评估，
 * 即「事件源多一个、评估逻辑不动」的推荐语义。
 *
 * 白名单：initServerExecutor 显式传入（serve.mjs 从 WORKHUB_AI_DOMAINS env 读，
 * **默认全关**，方案 §7.5 拍板）；与浏览器白名单相互独立（两把闸门各管各的执行体）。
 */

/** 执行结果信封（与 executor.AgentOpResult 同形状；独立声明避免 import 执行器顶层链） */
export interface ServerOpResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
}

type ServerTool = { schema: z.ZodTypeAny; run: (input: unknown) => Promise<ServerOpResult> }

/** 与 executor.wrapRead 同构：schema 校验 → items/count/truncated 信封 */
async function wrapRead<S extends z.ZodTypeAny>(
  schema: S,
  fn: (input: z.output<S>) => Promise<{ items: unknown[]; count: number; truncated: boolean }>,
  input: unknown,
): Promise<ServerOpResult> {
  const parsed = schema.safeParse(input ?? {})
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => i.message || `${i.path.join('.')}: 校验失败`)
    return { ok: false, error: msgs.join('；') }
  }
  const r = await fn(parsed.data)
  return { ok: true, data: { items: r.items, count: r.count, truncated: r.truncated } }
}

/** resolveEntity 的信封包装（与 executor.agent_resolveEntity 同构） */
async function agent_resolveEntity(input: unknown): Promise<ServerOpResult> {
  const parsed = resolveEntitySchema.safeParse(input)
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => i.message || `${i.path.join('.')}: 校验失败`)
    return { ok: false, error: msgs.join('；') }
  }
  const r: ResolveResult = await resolveEntity(parsed.data.query, parsed.data.type)
  return { ok: true, data: { ...r } as unknown as Record<string, unknown> }
}

/** 服务端读工具注册表（与 executor 读路径同源；写工具经 dispatchAgentTool 走 executor） */
export const SERVER_READ_TOOLS = {
  'resolveEntity': { schema: resolveEntitySchema, run: agent_resolveEntity },
  'searchEntities': { schema: searchEntitiesSchema, run: (i: unknown) => wrapRead(searchEntitiesSchema, searchEntities, i) },
  'getCustomer': { schema: getCustomerSchema, run: (i: unknown) => wrapRead(getCustomerSchema, getCustomer, i) },
  'listTransactions': { schema: listTransactionsSchema, run: (i: unknown) => wrapRead(listTransactionsSchema, listTransactions, i) },
  'listTodos': { schema: listTodosSchema, run: (i: unknown) => wrapRead(listTodosSchema, listTodos, i) },
  'listLedgers': { schema: listLedgersSchema, run: (i: unknown) => wrapRead(listLedgersSchema, listLedgers, i) },
  'listHabits': { schema: listHabitsSchema, run: (i: unknown) => wrapRead(listHabitsSchema, listHabits, i) },
  'listProjects': { schema: listProjectsSchema, run: (i: unknown) => wrapRead(listProjectsSchema, listProjects, i) },
  'listNotes': { schema: listNotesSchema, run: (i: unknown) => wrapRead(listNotesSchema, listNotes, i) },
  'listNoteFolders': { schema: listNoteFoldersSchema, run: (i: unknown) => wrapRead(listNoteFoldersSchema, listNoteFolders, i) },
  'listLinks': { schema: listLinksSchema, run: (i: unknown) => wrapRead(listLinksSchema, listLinks, i) },
} as const

export type ServerReadToolName = keyof typeof SERVER_READ_TOOLS

/** 工具描述（与浏览器桥同口径：域 + 风险级，参数细节在 schema） */
function describeTool(name: string, risk: string): string {
  return `${name}（域：${name.split('_')[0]}，风险：${risk}）—— 参数见 inputSchema；实体引用须先 resolveEntity，候选不唯一必须反问用户。写入前先用读工具取得 generation，并在公开 arguments 发送稳定 requestId 与原 generation；网络重试复用二者。具体预览返回 confirmHint，按原提示取票和提交。`
}

/** 公开参数可被普通 MCP 客户端提交；旧 _meta 仅保留兼容，不再是完成提交的前提。 */

/** 服务端工具清单（MCP tools/list 条目；risk/domain 与 schema.ts 的声明表同源） */
export function serverToolsList(domains: Record<string, boolean> = {}): Array<{
  name: string
  description: string
  risk: string
  domain: string
  inputSchema: unknown
}> {
  const read = (Object.keys(SERVER_READ_TOOLS) as ServerReadToolName[]).map((name) => ({
    name,
    description: describeTool(name, TOOL_RISK[name] ?? 'low'),
    risk: TOOL_RISK[name] ?? 'low',
    domain: TOOL_DOMAIN[name] ?? 'read',
    inputSchema: toolJsonSchema(name, SERVER_READ_TOOLS[name].schema),
  }))
  // P3 写工具必须出现在清单里：MCP 客户端只会调用 tools/list 列出的工具。
  // 只实现 handles() 而不广告 = 工具"存在但永远调不到"（2026-11-01 正式站实测踩到：
  // 白名单全开、写工具能按名字调通，但 tools/list 只有 12 个读工具，Agent 看不到）。
  const write = (Object.keys(AGENT_TOOLS) as Array<keyof typeof AGENT_TOOLS>)
    .filter((name) => {
      const domain = TOOL_DOMAIN[name as string]
    return domain ? domains[domain] === true && !Object.hasOwn(SERVER_READ_TOOLS, name) : false
    })
    .map((name) => {
      const tool = AGENT_TOOLS[name]
      return {
        name: name as string,
        description: describeTool(name as string, tool.risk ?? 'low'),
        risk: tool.risk ?? 'low',
        domain: TOOL_DOMAIN[name as string] ?? '',
        inputSchema: toolJsonSchema(name as string, tool.schema),
      }
    })
  return [...read, ...write]
}

/** 是否服务端读工具（旧导出保留：测试与文档引用；路由判定已统一到 initServerExecutor.handles） */
export function handlesServerTool(name: string): boolean {
  return Object.hasOwn(SERVER_READ_TOOLS, name)
}

/** 服务端执行一个读工具（输入不合法返回可操作错误而非抛出） */
export async function dispatchServerReadTool(name: string, input: unknown): Promise<ServerOpResult> {
  const tool = (SERVER_READ_TOOLS as unknown as Record<string, ServerTool | undefined>)[name]
  if (!tool) {
    return {
      ok: false,
      error: `未知工具：${name}（服务端执行器只承载读工具，写工具请经浏览器桥）`,
    }
  }
  try {
    return await tool.run(input)
  } catch (e) {
    // 读链路的意外异常统一转信封（PB 不可达等）；relay 侧不再包一层
    return { ok: false, error: (e as Error).message }
  }
}

export interface ServerExecutorOptions {
  /** PocketBase 连接（服务端执行器与 PB 同机走回环地址） */
  pb: {
    baseUrl: string
    /** 可选：集合规则未公开时才需要（公开读/写走匿名） */
    account?: string
    password?: string
  }
  /** 服务端域白名单（名称→开关；未列出的域视为关闭）。缺省全关 */
  domains?: Record<string, boolean>
}

/**
 * 初始化服务端执行器：注入 PocketBaseAdapter（替代浏览器 DexieAdapter）并返回 relay 接线接口。
 * 由 `scripts/serve.mjs` 在 `WORKHUB_SERVER_EXECUTOR=1` 时调用；bundle 外不经任何 storage 路径。
 *
 * 工具路由（P3 起）：
 * - 读工具：本文件自承载（schema 校验 + 信封，行为与 executor 读路径一致）；
 * - 写工具：经 executor.dispatchAgentTool（**同一份业务编排**），白名单域内才放行；
 * - 中/高风险写工具：无票先 preview（confirmFlow 共享闸门），带票（relay 已核销）才真正执行。
 */
export function initServerExecutor(opts: ServerExecutorOptions): {
  listTools: () => ReturnType<typeof serverToolsList>
  callTool: (name: string, input: unknown, meta?: { confirmToken?: string; requestId?: string; generation?: string; replayOnly?: boolean; agentKey?: string; clientId?: string; capabilities?: string[]; planFingerprint?: string }) => Promise<ServerOpResult>
  handles: (name: string) => boolean
  authenticate: (credential: {kind:'agent';token:string}|{kind:'shared-transition'}) => Promise<Record<string, unknown>>
} {
  const pbAdapter = createPocketBaseAdapter(opts.pb)
  const context = new AsyncLocalStorage<{ adapter: StorageAdapter; events: { type: keyof AppEvent; payload: unknown; occurredAt: number }[] }>()
  setStorageAdapter({
    commandMode: true,
    get: (...args) => (context.getStore()?.adapter || pbAdapter).get(...args),
    list: (...args) => (context.getStore()?.adapter || pbAdapter).list(...args),
    query: (...args) => (context.getStore()?.adapter || pbAdapter).query!(...args),
    transaction: (...args) => (context.getStore()?.adapter || pbAdapter).transaction(...args),
    requestSync() {},
  })
  setEventInterceptor((type, payload) => {
    const current = context.getStore()
    if (!current) return false
    current.events.push({ type, payload, occurredAt: Date.now() })
    return true
  })
  const domains = opts.domains ?? {}

  /** 服务端白名单闸门：域开关（与浏览器 settings.ai.domains 相互独立） */
  function domainAllowed(name: string): boolean {
    const domain = TOOL_DOMAIN[name]
    if (!domain) return false
    return domains[domain] === true
  }

  return {
    listTools: () => serverToolsList(domains),
    authenticate: async credential => pbAdapter.personal('agents/verify', credential),
    handles: (name: string) =>
      (Object.hasOwn(SERVER_READ_TOOLS, name) || Object.hasOwn(AGENT_TOOLS, name)) && domainAllowed(name),
    callTool: async (name, input, meta) => {
      let requestAdapter = meta?.agentKey ? createPocketBaseAdapter({ ...opts.pb, agentKey: meta.agentKey }) : pbAdapter
      const personal = PERSONAL_TOOL_MAP.get(name)
      if (!personal && input && typeof input === 'object') { const clean = { ...(input as Record<string,unknown>) };delete clean.requestId;delete clean.generation;delete clean.confirmToken;input=clean }
      if (personal) {
        // 旧工具已按自身业务域闸门授权其既有关联副作用；复合工具才逐项按部署域收窄。
        requestAdapter=createPocketBaseAdapter({...opts.pb,...(meta?.agentKey?{agentKey:meta.agentKey}:{}),writeDomains:domains})
        try {
          if (!domainAllowed(name)) throw new Error('FORBIDDEN: 服务端 read 域未开放')
          const d = personal.schema.parse(input) as Record<string, unknown>
          if (personal.kind === 'query') return { ok: true, data: await requestAdapter.personal('personal/query', { name, input: d }) }
          if (personal.kind === 'cancel') return {ok:true,data:await requestAdapter.personal('personal/cancel',d)}
          if (personal.kind === 'preview') {
            const data = await requestAdapter.personal('personal/preview', { ...d, kind: name.slice(8) })
            if (data.preview) {
              const commitName = 'commit_' + name.slice(8)
              const args = { requestId: d.requestId, generation: d.generation, previewId: data.previewId }
              data.confirmHint = { tool: 'confirm_preview', args: { tool: commitName, args, requestId: d.requestId, generation: d.generation, planFingerprint: data.planFingerprint }, note: '向用户转述整组影响，确认后取票，再按上述提交参数加 confirmToken 调用提交工具。' }
            }
            return { ok: true, data }
          }
          // 无票时只核对既有回执；票据失效不可创建新事实。
          if (!meta?.confirmToken || meta.replayOnly) {
            const lookup = await requestAdapter.personal('personal/query', { name: 'get_operation', input: { requestId: d.requestId, generation: d.generation } })
            const items = lookup.items as Array<Record<string, unknown>>
            if (items[0]?.status === 'committed') return { ok: true, data: items[0].receipt as Record<string, unknown> }
            throw new Error('CONFIRMATION_REQUIRED: 请按具体预览的 confirmHint 取得有效票据')
          }
          return { ok: true, data: await requestAdapter.personal('personal/commit', d, { 'X-Workhub-Plan': meta.planFingerprint || '' }) }
        } catch (e) { return { ok: false, error: (e as Error).message } }
      }
      if (!domainAllowed(name)) {
        return {
          ok: false,
          error: `工具 ${name} 不在服务端白名单内（域：${TOOL_DOMAIN[name] ?? '未知'}；服务端白名单由部署配置 WORKHUB_AI_DOMAINS 控制，与浏览器设置相互独立）`,
        }
      }
      const isRead = Object.hasOwn(SERVER_READ_TOOLS, name)
      const capabilities = meta?.capabilities || ['*']
      const readable: Record<string,string> = { getCustomer:'crm',listTransactions:'fin',listTodos:'todo',listLedgers:'fin',listHabits:'habit',listProjects:'project',listNotes:'note',listNoteFolders:'note',listLinks:'link' }
      if (isRead && !capabilities.includes('*')) {
        const domain = readable[name] || (name === 'resolveEntity' ? ({ customer:'crm',project:'project',todo:'todo',ledger:'fin',habit:'habit',note:'note',noteFolder:'note' } as Record<string,string>)[String((input as Record<string,unknown>)?.type)] : '')
        if (!domain || !capabilities.includes(domain+':read')) return {ok:false,error:'FORBIDDEN: 缺少读取能力'}
      }

      if (isRead) {
        try {
          if (name === 'resolveEntity' && ['customer','project'].includes(String((input as Record<string,unknown>)?.type))) {
            const d=resolveEntitySchema.parse(input),r=await requestAdapter.personal('personal/query',{name:d.type==='customer'?'resolve_contacts':'resolve_topics',input:{query:d.query}})
            const candidates=(r.candidates as Array<Record<string,unknown>>).map(c=>({...c,type:d.type,label:c.company?String(c.company)+' · '+String(c.name):String(c.name),sub:c.match}))
            return {ok:true,data:{...r,candidates}}
          }
          if (name === 'listTransactions') return { ok: true, data: await requestAdapter.queryFinance(listTransactionsSchema.parse(input || {})) }
          const result = await context.run({adapter:requestAdapter,events:[]},()=>dispatchServerReadTool(name, input))
          return result.ok ? { ...result, data: { ...result.data, generation: await requestAdapter.transport.generation(), protocol: 1 } } : result
        } catch (e) { return { ok: false, error: (e as Error).message } }
      }
      try {
        if (!meta?.requestId && !needsPreview(name, meta)) throw new Error('REQUEST_CONTEXT_REQUIRED: 写入必须携带稳定 requestId 和原 generation；缺少原上下文的旧请求不可自动补新标识重录，请先核对既有事实')
        if (meta?.requestId && !meta.generation) throw new Error('GENERATION_REQUIRED: 稳定请求必须携带原数据世代，恢复后禁止自动重录')
        if (meta?.confirmToken && (!meta.requestId || !meta.generation)) throw new Error('PREVIEW_REQUIRED: 确认时必须携带具体预览的 requestId 和 generation')
        const generation = meta?.generation || await requestAdapter.transport.generation()
        const id = meta?.requestId || newRequestId()
        const intent = { tool: name, input }
        // 已提交请求优先读持久回执，票据消费或进程重启都不影响安全重试。
        const prior = await requestAdapter.transport.lookup(id, generation, intent)
        const reply = (receipt: import('@/storage/commandPlan').Receipt): ServerOpResult => { const r = receipt.result as ServerOpResult; return { ...r, data: { ...r.data, requestId: id, operationId: receipt.operationId, generation, retrySafe: !!meta?.requestId } } }
        if (prior.committed && prior.receipt) return reply(prior.receipt)
        if (meta?.replayOnly) return { ok: false, error: '确认票据已失效且没有提交回执，请重新预览确认' }
        const preview = (command: import('@/commands/core').Command): ServerOpResult => ({ok:true,data:{...previewEnvelope(name,input),requestId:id,generation,confirmHint:{...previewEnvelope(name,input).confirmHint,args:{tool:name,args:input,requestId:id,generation}},targets:command.reads,changes:command.writes.map(w=>({...w,value:w.value?projectRecord({can:table=>capabilities.includes('*') || capabilities.includes((TABLE_DOMAIN[table] || table)+':read')},w.table,w.value):null}))}})
        if (prior.pending) {
          if (needsPreview(name, meta)) return preview(prior.pending)
          return reply(await requestAdapter.transport.commit(prior.pending))
        }
        const plan = stagePlan(requestAdapter)
        const events: { type: keyof AppEvent; payload: unknown; occurredAt: number }[] = []
        const adapter: StorageAdapter = {
          get: plan.tx.get, list: plan.tx.list, query: plan.tx.query,
          transaction: async (_tables, fn) => fn(plan.tx), requestSync() {},
        }
        const result = await context.run({ adapter, events }, () => dispatchAgentTool(name, input, domains))
        if (!result.ok) return result as ServerOpResult
        const command = plan.command(generation, id, intent, result)
        command.events = events
        if (needsPreview(name, meta)) return preview(await requestAdapter.transport.preview!(command))
        const receipt = await requestAdapter.transport.commit(command)
        // 真实事务结束后才向本进程观察者投递，通知记录已在同一事务持久化。
        for (const ev of events) eventBus.emit(ev.type, ev.payload as never)
        return reply(receipt)
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  }
}

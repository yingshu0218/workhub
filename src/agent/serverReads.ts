import { z } from 'zod'
import { createPocketBaseAdapter } from '@/storage/pocketbase'
import { setStorageAdapter } from '@/storage'
import {
  listTransactions,
  getCustomer,
  listTodos,
  listLedgers,
  listHabits,
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
  searchEntitiesSchema,
  type ReadResult,
} from './reads'
import { resolveEntity, type ResolveResult } from './resolver'
import { TOOL_RISK, TOOL_DOMAIN, resolveEntitySchema } from './schema'
import { zodToJsonSchema } from './jsonSchema'

/**
 * 服务端读执行器（agentOps 服务端化 P2，方案 docs/agentOps服务端化方案.md §4/§6）
 *
 * 这是**独立打包入口**（`scripts/build-server-executor.mjs` → `dist-server/server-executor.mjs`）：
 * 只含 10 个读工具，经 `storage/pocketbase.ts` 直读 VPS 上的 PB 中心——
 * 浏览器桥不在线时 `tools/list` 与读工具调用依然可用（7×24 目标的第一步）。
 *
 * ⚠️ 为什么不直接 import `agent/executor.ts`：它顶层引 `@/repositories`（eventBus /
 * syncEngine → Dexie），服务端进程无法加载；本文件与其共享 reads.ts / resolver.ts /
 * schema.ts 的**同一份实现**（单一事实源不破），只有 dispatch 信封这一小段代码形状相同
 * （与 executor.wrapRead 同构），由 serverReads.parity 测试锁定两端行为一致。
 *
 * 写工具**刻意不在本入口**：P2 只读（PocketBaseAdapter 的写原语也会拒绝），
 * 写链路的 repositories 复合函数要等 P3 的服务端化编排。
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
  fn: (input: z.output<S>) => Promise<ReadResult>,
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

/** 服务端读工具注册表（与 executor.AGENT_TOOLS 的读工具子集同源；名字不得漂移） */
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
} as const

export type ServerReadToolName = keyof typeof SERVER_READ_TOOLS

/** 工具描述（与 bridge.describeTool 同口径：域 + 风险级，参数细节在 schema） */
function describeTool(name: string, risk: string): string {
  return `${name}（域：${name.split('_')[0]}，风险：${risk}）—— 参数见 inputSchema；实体引用须先 resolveEntity，候选不唯一必须反问用户。`
}

/** 服务端工具清单（MCP tools/list 条目；risk/domain 与 schema.ts 的声明表同源） */
export function serverToolsList(): Array<{
  name: string
  description: string
  risk: string
  domain: string
  inputSchema: unknown
}> {
  return (Object.keys(SERVER_READ_TOOLS) as ServerReadToolName[]).map((name) => ({
    name,
    description: describeTool(name, TOOL_RISK[name] ?? 'low'),
    risk: TOOL_RISK[name] ?? 'low',
    domain: TOOL_DOMAIN[name] ?? 'read',
    inputSchema: zodToJsonSchema(SERVER_READ_TOOLS[name].schema),
  }))
}

/** 是否服务端可执行（relay 路由用：命中即不经浏览器） */
export function handlesServerTool(name: string): boolean {
  return Object.hasOwn(SERVER_READ_TOOLS, name)
}

/** 服务端执行一个读工具（relay 路由调用；输入不合法返回可操作错误而非抛出） */
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
    account: string
    password: string
  }
}

/**
 * 初始化服务端执行器：注入 PocketBaseAdapter（替代浏览器 DexieAdapter）并返回 relay 接线接口。
 * 由 `scripts/serve.mjs` 在 `WORKHUB_SERVER_EXECUTOR=1` 时调用；bundle 外不经任何 storage 路径。
 */
export function initServerExecutor(opts: ServerExecutorOptions): {
  listTools: () => ReturnType<typeof serverToolsList>
  callTool: (name: string, input: unknown) => Promise<ServerOpResult>
  handles: (name: string) => boolean
} {
  setStorageAdapter(createPocketBaseAdapter(opts.pb))
  return {
    listTools: serverToolsList,
    callTool: dispatchServerReadTool,
    handles: handlesServerTool,
  }
}

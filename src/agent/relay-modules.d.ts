/**
 * relay 运行时（Node .mjs）的类型声明 —— 仅供测试与类型检查引用。
 * relay 本体保持纯 JS（Node 直跑，不经 tsc 构建），此处给出最小可校验签名。
 */
declare module '@relay/ws-server.mjs' {
  import type { EventEmitter } from 'node:events'
  export function acceptKey(key: string): string
  export interface WsServerHandle {
    server: import('node:http').Server
    connections: Set<WsConnection>
    port: number
    close(): Promise<void>
  }
  export class WsConnection extends EventEmitter {
    send(text: string): void
    ping(): void
    close(): void
    closed: boolean
  }
  export function createWsServer(opts: { port: number; host?: string }): Promise<WsServerHandle>
}

declare module '@relay/mcp-relay.mjs' {
  export const MCP_PROTOCOL_VERSION: string
  export const CONFIRM_TTL_MS: number
  export function safeEqual(a: string, b: string): boolean
  export function generateToken(): string
  /**
   * 确认票据的参数指纹（sha256）：`(tool, canonical(args))`。
   * 票据绑定参数，执行时以同一函数算出的指纹核销（P0 越权路径封堵）。
   */
  export function argsFingerprint(tool: string, args?: Record<string, unknown>): string
  export class ConfirmTokenStore {
    constructor(opts?: { ttlMs?: number; now?: () => number })
    /** meta 至少含 `tool`；含 `args` 时写入参数指纹（票据绑定该组参数） */
    issue(meta: Record<string, unknown>): { confirmToken: string; expiresAt: number }
    /** 票据带指纹时，第 2 参须传「当次执行参数」的指纹且须一致 */
    redeem(token: string, fingerprint?: string): { ok: boolean; reason?: string; meta?: Record<string, unknown> }
    sweep(): void
  }
  export interface McpTool {
    name: string
    description?: string
    risk?: string
    domain?: string
    inputSchema?: Record<string, unknown>
  }
  export interface McpRouterHandle {
    handle(msg: unknown, ctx?: Record<string, unknown>): Promise<Record<string, unknown> | null>
    issueConfirm(meta: Record<string, unknown>): { confirmToken: string; expiresAt: number }
    confirmStore: ConfirmTokenStore
    token: string
  }
  export function createMcpRouter(opts: {
    token: string
    listTools: () => Promise<McpTool[]>
    callTool: (name: string, args: Record<string, unknown>, meta: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>
    confirmStore?: ConfirmTokenStore
    log?: (msg: string) => void
    /** dev 模式：预览响应自动附一次性 confirmToken（仅本地联调/自动化） */
    autoIssueConfirm?: boolean
  }): McpRouterHandle
}

declare module '@relay/server.mjs' {
  export interface RelayHandle {
    token: string
    path: string
    protocolVersion: string
    /** 把宿主的 http server 'upgrade' 事件交进来即可（同源挂载） */
    handleUpgrade(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head?: Buffer): void
    /** HTTP 传输入口（`<path>/mcp` 远程 Agent 直连、`<path>/pair*` 配对码）；true = 已处理 */
    handleHttp(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean
    /**
     * 签发一次性配对码。
     *
     * @param ttlMs 有效期（毫秒）。传 `0` = **不过期**，只给「启动引导码」用
     *   （部署完过一阵再翻日志是常态，5 分钟的码早废了，而页面此时没有 token、签不出新码 → 死锁）。
     *   省缺走 `PAIR_TTL_MS`（5 分钟）。
     */
    mintPairCode(ttlMs?: number): { code: string; expiresAt: number }
    attachStdio(input?: NodeJS.ReadStream, output?: NodeJS.WriteStream): void
    close(): void
    issueConfirm(meta: Record<string, unknown>): { confirmToken: string; expiresAt: number }
    confirmStore: import('@relay/mcp-relay.mjs').ConfirmTokenStore
    isBrowserOnline(): boolean
    handle(msg: unknown, ctx?: { authed?: boolean }): Promise<unknown>
  }
  export function createRelay(opts?: {
    token?: string
    autoIssueConfirm?: boolean
    path?: string
    log?: (msg: string) => void
    /**
     * 签发配对码的第二条鉴权通道（宿主注入）。
     * serve.mjs 用它放行「已登录的后台页面」：页面首次配对前没有 relay token，
     * 但仍需要能生成接入凭据；relay 本身不 import 业务代码，校验由宿主完成。
     */
    authorizeMint?: (
      req: import('node:http').IncomingMessage,
      url: URL,
    ) => boolean | Promise<boolean>
    issueAgentCredential?: (req: import('node:http').IncomingMessage, details: {name:string}) => Promise<{token:string}>
    serverExecutor?: {
      listTools: () => Array<{ name: string; description?: string; inputSchema?: unknown }>
      callTool: (name: string, args: unknown, meta?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>
      handles: (name: string) => boolean
      authenticate?: (credential:{kind:'agent';token:string}|{kind:'shared-transition'})=>Promise<Record<string,unknown>>
    } | null
  }): RelayHandle
}

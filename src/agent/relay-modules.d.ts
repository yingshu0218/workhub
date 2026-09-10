/**
 * relay 运行时（Node .mjs）的类型声明 —— 仅供测试与类型检查引用。
 * relay 本体保持纯 JS（Node 直跑，不经 tsc 构建），此处给出最小可校验签名。
 */
declare module '@relay/ws-server.mjs' {
  import type { EventEmitter } from 'node:events'
  export function acceptKey(key: string): string
  export interface WsConnection extends EventEmitter {
    send(text: string): void
    ping(): void
    close(): void
    closed: boolean
  }
  export interface WsServerHandle {
    server: import('node:http').Server
    connections: Set<WsConnection>
    port: number
    close(): Promise<void>
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

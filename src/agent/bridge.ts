import { settingsRepo } from '@/repositories'
import { visibleToolNames, listVisibleTools, dispatchAgentTool } from './executor'
import { AGENT_TOOLS, type AgentOpResult } from './executor'
import { TOOL_RISK } from './schema'
import { z } from 'zod'
import { zodToJsonSchema } from './jsonSchema'

/**
 * 应用内 Agent 桥（浏览器侧） —— 方案 §9.6 / §10.1（P1 第 4 步）
 *
 * 方向：**浏览器主动连出 relay**（Outbound WS）——浏览器无 `listen` 能力（§9.1），
 * 权威数据始终在页面进程内，agentOps 在此执行，桥只收发「工具调用请求 / 结果」。
 *
 * 与 4 键硬约束对齐：
 * - 只调 `dispatchAgentTool`（agentOps 唯一入口），**不 import 任何 repositories 写函数**；
 * - 复用白名单闸门：关闭的域在 `tools/list` 里直接不出现；
 * - 中风险工具经 preview：本模块负责「预览材料 + 一次性 confirmToken」的浏览器侧编排，
 *   confirmToken 由 relay 签发（relay 侧台账防重放），桥仅透传与校验风险级；
 * - 不得外发数据：仅被动接收指令，无任何主动上行业务数据通道。
 */

/** 桥运行时状态（内存，不进同步库） */
export interface BridgeStatus {
  state: 'disabled' | 'connecting' | 'connected' | 'error'
  url?: string
  error?: string
}

/** 桥客户端可配置项（首版：地址 + token 走 settings `ai` 段扩展位） */
export interface BridgeConfig {
  url: string
  token: string
}

type Listener = (s: BridgeStatus) => void

/** 浏览器侧桥单例：只连接、只转发，不持有工具实现 */
export class AgentBridge {
  private ws: WebSocket | null = null
  private status: BridgeStatus = { state: 'disabled' }
  private listeners = new Set<Listener>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private manualClose = false

  getStatus(): BridgeStatus {
    return { ...this.status }
  }

  onStatus(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.getStatus())
    return () => this.listeners.delete(fn)
  }

  private setStatus(s: BridgeStatus): void {
    this.status = s
    for (const fn of this.listeners) fn(this.getStatus())
  }

  /** 启用并连接（url 形如 ws://127.0.0.1:8787） */
  connect(cfg: BridgeConfig): void {
    this.disconnect()
    this.manualClose = false
    const url = `${cfg.url.replace(/\/$/, '')}/?role=browser&token=${encodeURIComponent(cfg.token)}`
    this.setStatus({ state: 'connecting', url: cfg.url })
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.setStatus({ state: 'error', url: cfg.url, error: (e as Error).message })
      return
    }
    this.ws = ws
    ws.onopen = () => this.setStatus({ state: 'connected', url: cfg.url })
    ws.onmessage = (ev) => void this.onMessage(String(ev.data))
    ws.onerror = () => this.setStatus({ state: 'error', url: cfg.url, error: 'WebSocket 连接错误（请确认 relay 已启动、token 与地址正确）' })
    ws.onclose = () => {
      this.ws = null
      if (this.manualClose) return
      this.setStatus({ state: 'connecting', url: cfg.url })
      this.scheduleReconnect(cfg)
    }
  }

  private scheduleReconnect(cfg: BridgeConfig): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.manualClose) this.connect(cfg)
    }, 3000)
  }

  disconnect(): void {
    this.manualClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.setStatus({ state: 'disabled' })
  }

  /** 处理 relay 下发的请求（tools/list / tools/call） */
  private async onMessage(raw: string): Promise<void> {
    let msg: { type?: string; requestId?: string; kind?: string; name?: string; args?: unknown; meta?: { confirmToken?: string } }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type !== 'agentops:call' || !msg.requestId) return
    const requestId = msg.requestId
    try {
      if (msg.kind === 'tools/list') {
        const domains = await this.loadDomains()
        // 白名单关闭的域：工具在清单里直接不出现（§四.3）
        const tools = listVisibleTools(domains).map((t) => {
          const entry = AGENT_TOOLS[t.name as keyof typeof AGENT_TOOLS]
          return {
            name: t.name,
            description: describeTool(t.name, t.risk),
            risk: t.risk,
            domain: t.domain,
            inputSchema: zodToJsonSchema(entry.schema),
          }
        })
        this.respond(requestId, true, { tools })
        return
      }
      if (msg.kind === 'tools/call') {
        const name = String(msg.name ?? '')
        const domains = await this.loadDomains()
        // 中风险 + 未携带 confirmToken：返回预览材料，要求 Agent 转述用户确认后再执行（§四.4）
        const risk = TOOL_RISK[name]
        // medium（需确认）与 high（二次确认 + 副作用清单）都必须先经 preview；
        // high 的差异在 preview 载荷里补 sideEffects 说明（§四.4 高风险语义），
        // 并在无票据时**额外强调不可逆**，防止 Agent 把「删除」当普通动作转述给用户。
        if ((risk === 'medium' || risk === 'high') && !msg.meta?.confirmToken) {
          this.respond(requestId, true, {
            preview: true,
            tool: name,
            risk,
            args: msg.args,
            // 确认票据的请求入口：Agent 拿到用户确认后调 confirm_preview 取票再重试本工具。
            // 没有这一句，preview → 确认 → execute 三步在非 --dev 下**物理上走不通**
            // （票据只能由 relay 签发，而 Agent 不知道去哪儿取），确认闸门就成了死循环。
            confirmHint: {
              tool: 'confirm_preview',
              args: { tool: name, args: msg.args },
              note: '用户确认后调用 confirm_preview 取得一次性 confirmToken，再以同一参数重试本工具。',
            },
            note:
              risk === 'high'
                ? '这是**不可逆**的高风险操作。务必先向用户逐字转述以上参数与影响（删除后数据不可恢复），取得明确确认后调用 confirm_preview 取得 confirmToken，再重试本工具。'
                : '这是中风险操作。请向用户转述以上参数并取得确认；用户确认后调用 confirm_preview 取得 confirmToken，再重试本工具。',
            ...(risk === 'high' ? { irreversible: true } : {}),
          })
          return
        }
        const result: AgentOpResult = await dispatchAgentTool(name, msg.args, domains)
        this.respond(requestId, result.ok, result.ok ? result.data : undefined, result.error)
        return
      }
      this.respond(requestId, false, undefined, `未知桥请求 kind：${String(msg.kind)}`)
    } catch (e) {
      this.respond(requestId, false, undefined, (e as Error).message)
    }
  }

  private respond(requestId: string, ok: boolean, data?: unknown, error?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type: 'agentops:result', requestId, ok, data, error }))
  }

  /** 读能力白名单（settings `ai.domains`，本地 singleton，不进同步队列） */
  private async loadDomains(): Promise<Partial<Record<string, boolean>>> {
    const settings = await settingsRepo.get()
    return settings.ai?.domains ?? {}
  }
}

/** 工具描述（首版由域前缀 + 风险级生成；skill 文档提供完整语义，§五） */
function describeTool(name: string, risk: string): string {
  return `${name}（域：${name.split('_')[0]}，风险：${risk}）—— 参数见 inputSchema；实体引用须先 resolveEntity，候选不唯一必须反问用户。`
}

/** 全局单例（App 启动时按 settings.ai.bridgeEnabled 决定是否 connect） */
export const agentBridge = new AgentBridge()

/** 供测试/工具数校验：可见工具名（与白名单同源） */
export { visibleToolNames }

/** zod → JSON Schema 的最小转换（MCP tools inputSchema 需要） */
export { zodToJsonSchema }

/** 供 UI 读取风险级 */
export const toolRisk = TOOL_RISK
export type { z }

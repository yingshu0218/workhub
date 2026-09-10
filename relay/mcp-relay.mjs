/**
 * MCP Relay 核心 —— 方案 §9.6 / §10.1（P1 第 4 步）
 *
 * 职责边界（硬约束）：
 * - **只转发，零特权**：relay 不 import 任何 repositories / agentOps，不持有数据；
 *   工具调用请求经 WS 下发给浏览器（agentOps 在页面进程内执行），结果原样回传 MCP 客户端。
 * - **标准 MCP 协议**：只实现 `initialize` / `tools/list` / `tools/call`（+ `ping`），
 *   不定义私有协议 —— 这是「换任意 Agent 零适配」的唯一保障（§10.1）。
 * - **relay 不是安全边界**：真正的防线是 agentOps 五道关。relay 只做 token 接入校验
 *   与中风险 confirmToken 的**一次性签发/核销**（防重放）；token 错一律拒绝。
 * - **双入口同进程**：stdio 与 WS 共用同一份路由（`createMcpRouter`）。
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'

/** MCP 协议版本（首版跟随 2024-11-05 稳定版） */
export const MCP_PROTOCOL_VERSION = '2024-11-05'

/** 中风险操作的 confirmToken 有效期（毫秒）；超时作废 */
export const CONFIRM_TTL_MS = 5 * 60 * 1000

/** 时间安全比较，防时序侧信道 */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** 生成接入 token（relay 启动时可打印/由环境变量注入） */
export function generateToken() {
  return randomBytes(24).toString('base64url')
}

/** JSON-RPC 结果/错误封装 */
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})

/**
 * 中风险确认令牌台账（进程内，一次性）。
 * 语义（§四.4）：preview 系工具签发 → Agent 转述用户确认 → execute 携带 confirmToken 核销。
 * 单次有效（核销即删）、超时作废、token 不匹配拒绝。
 */
export class ConfirmTokenStore {
  constructor({ ttlMs = CONFIRM_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs
    this.now = now
    this.map = new Map()
  }

  /** 签发一次性 token */
  issue(meta) {
    const token = randomBytes(18).toString('base64url')
    this.map.set(token, { ...meta, expiresAt: this.now() + this.ttlMs })
    return { confirmToken: token, expiresAt: this.now() + this.ttlMs }
  }

  /** 核销：成功即删除；失败返回原因 */
  redeem(token) {
    const rec = this.map.get(token)
    if (!rec) return { ok: false, reason: 'confirmToken 无效或已使用' }
    this.map.delete(token)
    if (this.now() > rec.expiresAt) return { ok: false, reason: 'confirmToken 已过期，请重新预览确认' }
    return { ok: true, meta: rec }
  }

  /** 清理过期项（避免长期驻留） */
  sweep() {
    const t = this.now()
    for (const [k, v] of this.map) if (t > v.expiresAt) this.map.delete(k)
  }
}

/**
 * 创建一个 MCP 路由。
 *
 * @param {object} opts
 * @param {string} opts.token  接入 token（必须匹配，否则 initialize/tools 一律拒绝）
 * @param {() => Promise<Array<{name:string, description?:string, risk?:string, domain?:string, inputSchema?:object}>>} opts.listTools
 *        tools/list 数据源（由浏览器侧回传的可见工具清单；白名单关闭的域不出现）
 * @param {(name:string, args:object, meta:object) => Promise<{ok:boolean, data?:unknown, error?:string}>} opts.callTool
 *        转发给浏览器 agentOps 执行
 * @param {ConfirmTokenStore} [opts.confirmStore]
 * @param {(msg:string)=>void} [opts.log]
 */
export function createMcpRouter({ token, listTools, callTool, confirmStore = new ConfirmTokenStore(), log = () => {} }) {
  /** 每个会话的鉴权态：initialize 时校验 token */
  function handleInitialize(params) {
    const provided = params?.accessToken ?? params?.token
    if (!safeEqual(provided ?? '', token)) {
      return { error: rpcError(null, -32001, '接入 token 无效：Agent 连接必须携带 relay 启动时生成的 token') }
    }
    return {
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'workhub-agentops-relay', version: '0.1.0' },
      },
    }
  }

  /**
   * 处理单条 JSON-RPC 消息。
   * @param {object} msg
   * @param {object} ctx 会话上下文（含 authed 标记；跨消息保持）
   * @returns {Promise<object|null>} 通知类消息返回 null
   */
  async function handle(msg, ctx = {}) {
    const { id = null, method, params } = msg || {}
    if (typeof method !== 'string') {
      return rpcError(id, -32600, 'Invalid Request：缺少 method')
    }
    // 未鉴权会话：只放行 initialize，其余一律拒绝（无 token 连接被拒，§7.4）
    if (method !== 'initialize' && !ctx.authed) {
      return rpcError(id, -32001, '未鉴权：请先 initialize 并携带有效 accessToken')
    }

    switch (method) {
      case 'initialize': {
        const r = handleInitialize(params)
        if (r.error) return { ...r.error, id }
        ctx.authed = true
        return rpcResult(id, r.result)
      }
      case 'notifications/initialized':
      case 'initialized':
        return null
      case 'ping':
        return rpcResult(id, {})
      case 'tools/list': {
        const tools = await listTools()
        return rpcResult(id, {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: t.inputSchema ?? { type: 'object' },
            // 风险级与域随工具下发：Agent 据此决定是否先 preview（§四.4 / §10.1）
            annotations: { risk: t.risk ?? 'low', domain: t.domain ?? 'unknown' },
          })),
        })
      }
      case 'tools/call': {
        const name = params?.name
        const args = params?.arguments ?? {}
        if (typeof name !== 'string' || !name) {
          return rpcResult(id, { content: [{ type: 'text', text: 'tools/call 缺少 name' }], isError: true })
        }
        // 一次性 confirmToken 核销：若 Agent 携带，则校验并消费
        const meta = { confirmToken: params?.confirmToken }
        if (meta.confirmToken) {
          const redeemed = confirmStore.redeem(meta.confirmToken)
          if (!redeemed.ok) {
            return rpcResult(id, {
              content: [{ type: 'text', text: redeemed.reason }],
              isError: true,
            })
          }
          meta.redeemed = redeemed.meta
        }
        let res
        try {
          res = await callTool(name, args, meta)
        } catch (e) {
          log(`[relay] callTool(${name}) 抛错：${e?.message ?? e}`)
          return rpcResult(id, {
            content: [{ type: 'text', text: `工具执行异常：${e?.message ?? String(e)}` }],
            isError: true,
          })
        }
        if (!res || res.ok !== true) {
          return rpcResult(id, {
            content: [{ type: 'text', text: res?.error ?? '执行失败' }],
            isError: true,
          })
        }
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(res.data ?? {}) }],
          isError: false,
        })
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`)
    }
  }

  /** 供 relay 在 preview 时签发确认令牌（中风险 execute 前置） */
  function issueConfirm(meta) {
    return confirmStore.issue(meta)
  }

  return { handle, issueConfirm, confirmStore, token }
}

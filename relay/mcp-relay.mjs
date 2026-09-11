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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

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

/**
 * 参数规范化：对象键递归排序（数组保序），消除「同语义不同键序」导致的指纹抖动。
 * 仅用于指纹计算，不改动下发给浏览器的原始 args。
 */
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k])
    return out
  }
  return v
}

/**
 * 确认票据的参数指纹（sha256）。
 *
 * 为什么必须是**强哈希且不可碰撞到近似值**：confirmToken 是「用户已确认」的唯一凭证，
 * 指纹即「用户当时确认的那组参数」。若指纹弱/可伪造，越权路径成立：
 * 预览「记 100 元」取票 → 拿同一张票执行「记 10000 元」。
 * 故用 sha256 对 `tool + canonical(args)` 取全量摘要（非截断）。
 */
export function argsFingerprint(tool, args) {
  const canonical = JSON.stringify({ tool: String(tool), args: canonicalize(args ?? {}) })
  return createHash('sha256').update(canonical).digest('hex')
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

  /**
   * 签发一次性 token。
   * @param {object} meta 至少含 `tool`；若含 `args` 则写入参数指纹（票据绑定这组参数）
   */
  issue(meta) {
    const token = randomBytes(18).toString('base64url')
    const rec = { ...meta, expiresAt: this.now() + this.ttlMs }
    // 参数指纹：票据一旦携带，redeem 时须与本次执行参数逐字节对得上（堵死越权路径）
    if (meta && meta.tool !== undefined) {
      rec.fingerprint = argsFingerprint(meta.tool, meta.args ?? {})
    }
    this.map.set(token, rec)
    return { confirmToken: token, expiresAt: rec.expiresAt }
  }

  /**
   * 核销：成功即删除；失败返回原因。
   * @param {string} token
   * @param {string} [fingerprint] 本次执行参数的指纹；票据带指纹时必传且须一致
   */
  redeem(token, fingerprint) {
    const rec = this.map.get(token)
    if (!rec) return { ok: false, reason: 'confirmToken 无效或已使用' }
    // 先删：无论校验结果如何，票据都只能被消费一次（防重放 + 防拿无效指纹反复试探）
    this.map.delete(token)
    if (this.now() > rec.expiresAt) return { ok: false, reason: 'confirmToken 已过期，请重新预览确认' }
    if (rec.fingerprint !== undefined) {
      if (!fingerprint) {
        return { ok: false, reason: 'confirmToken 必须随本次执行参数一同提交（票据已绑定参数）' }
      }
      if (!safeEqual(rec.fingerprint, fingerprint)) {
        return { ok: false, reason: 'confirmToken 与该组参数不匹配：票据只对用户确认过的那组参数有效，请重新预览并确认' }
      }
    }
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
export function createMcpRouter({
  token,
  listTools,
  callTool,
  /**
   * 浏览器桥是否在线（可选）。缺省视为「在线」，仅供宿主在浏览器离线时给出**可操作错误**，
   * 把「应用没开」与「工具执行失败」两类错误分开上报（见下 tools/call 分支）。
   */
  isBrowserOnline = () => true,
  confirmStore = new ConfirmTokenStore(),
  log = () => {},
  /**
   * dev 模式：预览类响应（浏览器回 `{preview:true, tool}`）自动附一枚一次性 confirmToken。
   * 用途仅为本地联调/自动化跑通「预览 → 确认 → 执行」三步；**生产用法是 Agent 在用户确认后
   * 自行向 relay 取票**（ConfirmTokenStore.issue），relay 不代用户确认。
   */
  autoIssueConfirm = false,
} = {}) {
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
        // 浏览器桥离线 / listTools 抛错时**必须转成 JSON-RPC 错误**，不得让异常穿出 handle()。
        //
        // 依据 §三：浏览器不在线时无权威数据，`tools/list` 只能失败——但失败必须是**返回的错误**，
        // 不是抛出的异常。WS/stdio 宿主只在 `await router.handle(...)` 外层解析 JSON，
        // 没有 try/catch：异常一旦穿出，就是**未处理的 Promise rejection → 进程退出**。
        // 真实后果（实机复现）：relay 与站点同源同进程（`npm run serve`）时，
        // Agent 一调 `tools/list` 就把**整个站点**一起打崩，且 Agent 侧只看到连接断开。
        let tools
        try {
          tools = await listTools()
        } catch (e) {
          log(`[relay] listTools 失败：${e?.message ?? e}`)
          return rpcError(id, -32001, `工具清单不可用：${e?.message ?? String(e)}`)
        }
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
        //
        // confirmToken 由本层（relay）签发 —— 页面侧桥只负责「无 token 时回预览材料」，
        // 不自己签发（桥没有「用户真的确认了」这个事实）。因此签发点有二：
        //   ① Agent 侧（如本地 CLI/IDE 插件）在用户确认后自取票据 → issueConfirm()；
        //   ② relay --dev：把「预览」与「签发」并成一步，供本地联调/自动化跑通
        //      preview → confirm → execute 全链路（非 dev 一律不签发，防被静默绕过确认）。
        const meta = { confirmToken: params?.confirmToken }
        if (meta.confirmToken) {
          // 核销时必须带上「本次执行参数」的指纹：票据绑定的是「用户确认过的那组参数」，
          // 对不上即拒 —— 否则「预览 A 拿票执行 B」的越权路径成立。
          const redeemed = confirmStore.redeem(meta.confirmToken, argsFingerprint(name, args))
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
          // dev 模式：给预览响应补一张一次性票据，让自动化能继续走 execute。
          // 非 dev 下不补 —— 否则「预览」等同于「自动确认」，把风险确认闸门架空。
          if (autoIssueConfirm && res?.ok === true && res.data && res.data.preview === true) {
            const issued = confirmStore.issue({ tool: name, args, dev: true })
            res = { ...res, data: { ...res.data, ...issued } }
          }
        } catch (e) {
          log(`[relay] callTool(${name}) 抛错：${e?.message ?? e}`)
          // 浏览器离线是**前置条件缺失**，不是工具执行异常：给出的提示必须是
          // 「去把应用打开并启用 AI 桥」，否则 Agent 会以为是自己参数错了而反复重试。
          const offline = !isBrowserOnline()
          return rpcResult(id, {
            content: [
              {
                type: 'text',
                text: offline
                  ? `应用未连接：寻鸽工作台未连接到 relay（请确保应用已打开并在「设置 → AI Agent 桥」启用）。原始错误：${e?.message ?? String(e)}`
                  : `工具执行异常：${e?.message ?? String(e)}`,
              },
            ],
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

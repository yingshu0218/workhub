#!/usr/bin/env node
/**
 * 本地 Relay 入口 —— 方案 §9.6 / §10.1（P1 第 4 步）
 *
 * 拓扑（反向连接）：浏览器主动连出 relay（浏览器无 listen 能力，§9.1）；
 * Agent 以标准 MCP 接入 relay（stdio 或 WS），二者在 relay 上配对。
 * relay 只转发「工具调用请求/结果」，不持有数据、不 import repositories。
 *
 * 用法：
 *   node relay/index.mjs                      # 启动 WS（127.0.0.1:8787），浏览器连出
 *   node relay/index.mjs --stdio              # 额外开启 stdio MCP 入口（供本地 CLI Agent）
 *   node relay/index.mjs --dev                # 预览响应自动附 confirmToken（仅本地联调/自动化，勿用于生产）
 *   WORKHUB_RELAY_PORT=9000 node relay/index.mjs
 *   WORKHUB_RELAY_TOKEN=xxx node relay/index.mjs   # 固定 token（缺省随机生成并打印）
 *   WORKHUB_RELAY_DEBUG=1 node relay/index.mjs      # 打印浏览器往返回包（排查「有回包但客户端收不到」）
 */
import { createWsServer } from './ws-server.mjs'
import { createMcpRouter, generateToken, MCP_PROTOCOL_VERSION } from './mcp-relay.mjs'

const DEFAULT_PORT = 8787
const HOST = '127.0.0.1' // §四.1：只绑本机，不暴露局域网

const args = process.argv.slice(2)
const wantStdio = args.includes('--stdio')
const wantDev = args.includes('--dev')
const port = Number(process.env.WORKHUB_RELAY_PORT || DEFAULT_PORT)
const token = process.env.WORKHUB_RELAY_TOKEN || generateToken()
const log = (m) => process.stderr.write(`${m}\n`)

/** 当前已连出的浏览器连接（首版单浏览器配对；多标签页取最近一条） */
let browserConn = null
/** 浏览器回包等待表：requestId -> resolve */
const pending = new Map()
let seq = 0

/** 浏览器不在线 → 明确失败（§三：应用在线才能操作，离线无权威数据） */
function assertBrowser() {
  if (!browserConn) throw new Error('寻鸽工作台未连接 relay（请确保应用已打开且已启用 AI 桥）')
}

/** 唤醒浏览器：下发工具调用请求并等待回包 */
function requestFromBrowser(payload) {
  assertBrowser()
  const requestId = `r${++seq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('浏览器响应超时（15s）'))
    }, 15_000)
    // track：tools/call 记录 {name,args}，供预览回包落地为 confirm_preview 的校验依据
    const track = payload.kind === 'tools/call' ? { name: payload.name, args: payload.args } : undefined
    pending.set(requestId, { resolve, reject, timer, track })
    browserConn.send(JSON.stringify({ type: 'agentops:call', requestId, ...payload }))
  })
}

/**
 * preview 材料缓存（中风险「预览 → 确认 → 执行」的绑定环节）。
 *
 * 为什么必须在 relay 侧：preview 的入参只有浏览器侧知道（工具参数由页面进程的 agentOps schema 决定），
 * relay 若不缓存，「用户确认后取票」这一步就无从校验「票据对的是同一组参数」——
 * 会出现「Agent 预览了 A，却拿着票执行了 B」的越权路径（确认闸门被架空）。
 * 缓存以 tool:argsHash 为键、TTL 5 分钟、取票时消费即删（与 confirmToken 同生命周期）。
 */
const previewStore = new Map()
const PREVIEW_TTL_MS = 5 * 60 * 1000

function argsHash(tool, args) {
  const s = `${tool}::${JSON.stringify(args ?? {})}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return `p${(h >>> 0).toString(36)}`
}

function rememberPreview(key) {
  previewStore.set(key, Date.now() + PREVIEW_TTL_MS)
  for (const [k, exp] of previewStore) if (Date.now() > exp) previewStore.delete(k)
}

function consumePreview(key) {
  const exp = previewStore.get(key)
  if (exp === undefined) return false
  previewStore.delete(key)
  return Date.now() <= exp
}

/**
 * 确认票据签发入口（MCP 工具 `confirm_preview`）。
 *
 * 非 --dev 下的**唯一取票路径**：Agent 完成「预览 → 向用户转述 → 用户确认」后调用本工具，
 * relay 校验「该 (tool,args) 组合确实被 preview 过」才签发一次性 confirmToken。
 * relay 依此在不冒充用户的前提下，把「用户确认」这一事实的可信边界交给 Agent 的转述，
 * 同时用 preview 绑定堵死「拿着确认票执行另一组参数」。
 */
const CONFIRM_TOOL = 'confirm_preview'

function confirmPreview(args) {
  const tool = String(args?.tool ?? '')
  const toolArgs = args?.args ?? {}
  if (!tool) return { ok: false, error: 'confirm_preview 缺少 tool' }
  const key = argsHash(tool, toolArgs)
  if (!consumePreview(key)) {
    return {
      ok: false,
      error: `未找到工具 ${tool} 的预览记录（须先以相同参数调用一次本工具取得预览，票据绑定该组参数且 5 分钟内有效）`,
    }
  }
  const issued = router.issueConfirm({ tool, source: 'confirm_preview' })
  return { ok: true, data: { ...issued, tool, note: '请以同一参数重试该工具，并携带 confirmToken。' } }
}

const router = createMcpRouter({
  token,
  // --dev：预览响应自动签发一次性 confirmToken，供本地联调/自动化跑通「预览→确认→执行」
  autoIssueConfirm: wantDev,
  // tools/list 由浏览器回传（白名单关闭的域不出现；relay 不认识具体工具）
  // 注意信封：requestFromBrowser 已统一 resolve {ok, data}，工具清单在 data.tools 上。
  listTools: () => {
    const fromBrowser = () =>
      requestFromBrowser({ kind: 'tools/list' }).then((r) => r.data?.tools ?? [])
    // confirm_preview 由 relay 自己实现（票据只能由 relay 签发），与浏览器工具清单**合并**下发：
    // 不合并的话，非 --dev 下 Agent 根本看不到取票入口，中风险工具永远执行不了。
    return fromBrowser().then((tools) => [
      ...tools,
      {
        name: CONFIRM_TOOL,
        description:
          '中风险操作确认取票（relay 内置）：完成「预览 → 向用户转述 → 用户确认」后，以与预览相同的参数调用本工具取得一次性 confirmToken，再重试原工具。',
        risk: 'low',
        domain: 'read',
        inputSchema: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: '要执行的中风险工具名' },
            args: { type: 'object', description: '与该次预览完全一致的入参' },
          },
          required: ['tool', 'args'],
        },
      },
    ])
  },
  callTool: (name, toolArgs, meta) => {
    if (name === CONFIRM_TOOL) {
      try {
        return Promise.resolve(confirmPreview(toolArgs))
      } catch (e) {
        return Promise.resolve({ ok: false, error: e?.message ?? String(e) })
      }
    }
    return requestFromBrowser({
      kind: 'tools/call',
      name,
      args: toolArgs,
      meta: { confirmToken: meta?.confirmToken },
    })
  },
  log,
})

/** 处理浏览器回包 */
function onBrowserMessage(raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  if (msg?.type === 'agentops:result' && msg.requestId) {
    if (process.env.WORKHUB_RELAY_DEBUG) log(`[relay] 浏览器回包：${raw.slice(0, 200)}`)
    const p = pending.get(msg.requestId)
    if (!p) return
    pending.delete(msg.requestId)
    clearTimeout(p.timer)
    if (process.env.WORKHUB_RELAY_DEBUG) log(`[relay] 匹配到 pending，准备回给 MCP 客户端：${msg.requestId}`)
    // 必须把桥的 ok/error 一起带回 —— 只 resolve(data) 会把 ok 丢掉，
    // 下游 `res.ok !== true` 恒真（data 只有业务字段，没有 ok），表现为「工具明明执行成功却回执行失败」。
    // 浏览器回了预览材料 → 记下「(tool,args) 已预览」，供 confirm_preview 校验并绑定票据。
    // p.meta 由 requestFromBrowser 调用点带上（tools/call 才有）。
    if (msg.ok && msg.data?.preview === true && p.track) {
      rememberPreview(argsHash(p.track.name, p.track.args))
    }
    if (msg.ok) p.resolve({ ok: true, data: msg.data ?? {} })
    else p.resolve({ ok: false, error: msg.error ?? '浏览器执行失败' })
  }
}

async function startWs() {
  const ws = await createWsServer({ port, host: HOST })
  log(`[relay] WebSocket 已监听 ws://${HOST}:${ws.port}`)
  log(`[relay] 接入 token：${token}`)
  log(`[relay] 浏览器侧：启用「AI 桥」并填入上述地址与 token`)

  ws.server.on('ws-connection', (conn, req) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`)
    const role = url.searchParams.get('role')
    const provided = url.searchParams.get('token')

    // 端点二选一（§10.1 双入口同进程）：?role=browser 是页面侧桥（连出），
    // 不带 role 的是 MCP Agent 端点（标准 tools/list + tools/call）。
    // **必须显式分支**：两者共用同一 upgrade 通道，若 Agent 连接落进 browser 分支，
    // 会把 browserConn 覆盖成 Agent 连接 —— 此后 relay 向「浏览器」下发的请求会打回 Agent 自己，
    // 而 Agent 只认 JSON-RPC 响应、不认 relay 内部协议，表现为「调用永久无响应」。
    if (role === 'browser') {
      if (!router.token || provided !== token) {
        log('[relay] 浏览器 WS 连接 token 无效，已拒绝')
        conn.close()
        return
      }
      browserConn = conn
      log('[relay] 浏览器已连出，桥就绪')
      conn.on('message', onBrowserMessage)
      conn.on('close', () => {
        if (browserConn === conn) {
          browserConn = null
          log('[relay] 浏览器已断开，桥离线')
        }
      })
      return
    }

    if (role === null) {
      // MCP Agent 端点：走标准 MCP 路由；鉴权在 initialize（accessToken）
      const ctx = { authed: false }
      conn.on('message', async (raw) => {
        let msg
        try {
          msg = JSON.parse(raw)
        } catch {
          conn.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
          return
        }
        const out = await router.handle(msg, ctx)
        if (out) conn.send(JSON.stringify(out))
      })
      log('[relay] MCP Agent 已连入（标准 MCP 端点），等待 initialize')
      return
    }

    log(`[relay] 拒绝未知 role 的 WS 连接（role=${role}）`)
    conn.close()
  })

  return ws
}

/** stdio MCP 入口：逐行 JSON-RPC（MCP over stdio，§10.1） */
function startStdio() {
  let buf = ''
  const ctx = { authed: false }
  log('[relay] stdio MCP 入口已开启')
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
        continue
      }
      const out = await router.handle(msg, ctx)
      if (out) process.stdout.write(JSON.stringify(out) + '\n')
    }
  })
}

async function main() {
  await startWs()
  if (wantStdio) startStdio()
  log(`[relay] MCP 协议版本：${MCP_PROTOCOL_VERSION}（标准 tools/list + tools/call）`)
  if (wantDev) log('[relay] dev 模式：预览响应会自动附带 confirmToken（仅本地联调用，勿用于生产）')
}

main().catch((e) => {
  log(`[relay] 启动失败：${e?.message ?? e}`)
  process.exit(1)
})

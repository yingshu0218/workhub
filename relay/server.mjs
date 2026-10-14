/**
 * Relay 核心（可嵌入） —— Issue #33「把 relay 整合进项目」。
 *
 * 为什么要有这一层：此前 relay 是 `relay/index.mjs` 里的**进程入口**（自建 http server + listen），
 * 于是「跑 relay」天然变成一件独立的事——独立命令（`npm run relay`）、独立端口（8787）、
 * 独立部署（Docker/Nginx/systemd）以及派生出来的 CSP 放行、混合内容（https 页面连 ws://）等一堆问题。
 * 用户诉求直白：**这些东西都应该整合进项目里，不要再分头搞。**
 *
 * 本模块把 relay 从「进程」降级为「一段可挂载的处理逻辑」：
 * 只暴露 `handleUpgrade(req, socket)`，由**宿主**决定它跑在哪个 http server 上：
 *   - dev：挂在 Vite dev server 上 → 同源 `/relay`，单条 `npm run dev` 即可，无需额外进程/端口/CSP 改动；
 *   - prod：挂在 `scripts/serve.mjs`（同进程托管 dist + relay）上 → 同源 wss，无需 Nginx/Docker。
 *
 * 边界保持不变（方案 §四.1 / §7.4）：relay 不持有数据、不 import repositories，
 * 只转发「工具调用请求 / 结果」；token 鉴权、白名单、确认票据三道闸门原样保留。
 */
import { acceptKey } from './ws-server.mjs'
import { createMcpRouter, generateToken, MCP_PROTOCOL_VERSION, argsFingerprint, safeEqual } from './mcp-relay.mjs'

/** 预览记录 TTL：中风险「预览 → 确认 → 执行」的绑定窗口 */
const PREVIEW_TTL_MS = 5 * 60 * 1000

/** 内置取票工具名（票据只能由 relay 签发） */
const CONFIRM_TOOL = 'confirm_preview'

/**
 * 把一次已校验的 upgrade 请求建成 WebSocket 连接（复用 ws-server 的握手/解帧实现）。
 * 这里不直接持有 WsConnection 类，而是通过 ws-server 导出的 createWsServer 之外的最小路径——
 * 为保持「零新增依赖 + 复用同一套帧实现」，我们复用 `acceptKey` 并内联一次 WsConnection 构造。
 */
import { WsConnection } from './ws-server.mjs'

/**
 * 创建可嵌入的 relay 实例。
 *
 * @param {object} opts
 * @param {string} [opts.token]            接入 token（缺省随机生成并打印）
 * @param {boolean} [opts.autoIssueConfirm] dev 便利：预览响应自动附一次性 confirmToken（自动联调用，勿用于生产）
 * @param {string} [opts.path]             relay 挂载路径，默认 `/relay`（同源反代/挂载用）
 * @param {(m:string)=>void} [opts.log]    日志出口
 * @param {{ listTools: ()=>Array, callTool: (name:string, args:unknown)=>Promise<{ok:boolean,data?:object,error?:string}>, handles: (name:string)=>boolean }} [opts.serverExecutor]
 *   内置服务端执行器（agentOps 服务端化 P2，只读）：命中 `handles(name)` 的工具在 relay
 *   进程内直接执行（直读 PB 中心），不经浏览器。路由规则：
 *   - tools/list = 服务端工具 ∪ 浏览器工具 ∪ confirm_preview（重名时服务端版优先并标注 executor）；
 *   - 浏览器离线时：有服务端工具就照常返回清单（不再整体 -32001），只有浏览器工具缺失这一事实
 *     由工具调用时的回落错误体现；
 *   - tools/call：服务端工具本地执行，其余回落浏览器桥（浏览器离线 → 原有可操作错误）。
 * @returns {RelayHandle}
 */
export function createRelay({ token = generateToken(), autoIssueConfirm = false, path = '/relay', log = (m) => process.stderr.write(`${m}\n`), serverExecutor = null } = {}) {
  /** 当前已连出的浏览器连接（首版单浏览器配对；多标签页取最近一条） */
  let browserConn = null
  /** 浏览器回包等待表：requestId -> {resolve, reject, timer, track} */
  const pending = new Map()
  let seq = 0
  /** 当前活着的连接集合（close 时统一断开） */
  const connections = new Set()

  /** 浏览器不在线 → 明确失败（§三：应用在线才能操作，离线无权威数据） */
  function assertBrowser() {
    if (!browserConn) throw new Error('寻鸽工作台未连接 relay（请确保应用已打开且已启用 AI 桥）')
  }

  /**
   * 浏览器桥是否在线。用于把「应用没开」与「工具真的执行失败」两类错误分开上报：
   * 前者是可操作的前置条件缺失（告诉 Agent「去把应用打开并启用 AI 桥」），
   * 后者才是工具自身的执行异常。两者混为一谈会让 Agent 反复重试一个永远不可能成功的调用。
   */
  function isBrowserOnline() {
    return browserConn !== null
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

  function argsHash(tool, args) {
    return argsFingerprint(tool, args)
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
   */
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
    const issued = router.issueConfirm({ tool, args: toolArgs, source: 'confirm_preview' })
    return { ok: true, data: { ...issued, tool, note: '请以同一参数重试该工具，并携带 confirmToken。' } }
  }

  const router = createMcpRouter({
    token,
    autoIssueConfirm,
    // 工具清单失败必须转成**返回的 JSON-RPC 错误**（mcp-relay 的 tools/list 分支捕获），
    // 不得让异常穿出 handle() —— 否则未处理的 Promise rejection 会打崩宿主进程。
    // 反例：直接返回空数组会让 Agent 误判「这个应用没有任何工具可用」，
    // 从而放弃重试、也拿不到可操作提示。
    // 浏览器离线语义（P2 起）：有服务端工具 → 清单照常返回（读工具 7×24 可用）；
    // 无服务端工具且浏览器离线 → listTools 内显式抛错转 -32001（与既有口径一致）。
    isBrowserOnline,
    listTools: async () => {
      const fromBrowser = () => requestFromBrowser({ kind: 'tools/list' }).then((r) => r.data?.tools ?? [])
      // 服务端工具（P2）：已按服务端白名单过滤；浏览器工具与之按名字去重（重名服务端版优先）
      const serverTools = serverExecutor
        ? serverExecutor.listTools().map((t) => ({ ...t, executor: 'server' }))
        : []
      const serverNames = new Set(serverTools.map((t) => t.name))
      let browserTools = []
      if (isBrowserOnline()) {
        try {
          browserTools = (await fromBrowser()).filter((t) => !serverNames.has(t.name))
        } catch {
          // 浏览器在线但清单拉取失败（超时等）：降级为只返回服务端工具，不让整次清单失败
          browserTools = []
        }
      }
      // confirm_preview 由 relay 自己实现（票据只能由 relay 签发），与工具清单合并下发。
      // 浏览器离线时：只读服务端工具依然可用（P2），不再因浏览器缺席整体失败。
      if (!isBrowserOnline() && serverTools.length === 0) {
        throw new Error('寻鸽工作台未连接 relay（请确保应用已打开且已启用 AI 桥）')
      }
      return [
        ...serverTools,
        ...browserTools,
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
      ]
    },
    callTool: (name, toolArgs, meta) => {
      if (name === CONFIRM_TOOL) {
        try {
          return Promise.resolve(confirmPreview(toolArgs))
        } catch (e) {
          return Promise.resolve({ ok: false, error: e?.message ?? String(e) })
        }
      }
      // P2/P3：服务端工具在 relay 进程内直接执行，不经浏览器；
      // 中/高风险写工具的无票回包（data.preview === true）同样记入 preview 台账——
      // 否则 Agent 转述用户确认后调 confirm_preview 会「找不到预览记录」（取票闸门死循环）
      if (serverExecutor?.handles(name)) {
        return serverExecutor
          .callTool(name, toolArgs, { confirmToken: meta?.confirmToken })
          .then((r) => {
            if (r.ok && r.data?.preview === true) rememberPreview(argsHash(name, toolArgs))
            return r
          })
          .catch((e) => ({ ok: false, error: e?.message ?? String(e) }))
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
      // 浏览器回了预览材料 → 记下「(tool,args) 已预览」，供 confirm_preview 校验并绑定票据
      if (msg.ok && msg.data?.preview === true && p.track) {
        rememberPreview(argsHash(p.track.name, p.track.args))
      }
      if (msg.ok) p.resolve({ ok: true, data: msg.data ?? {} })
      else p.resolve({ ok: false, error: msg.error ?? '浏览器执行失败' })
    }
  }

  /**
   * 协议升级：把 http server 的 upgrade 事件交进来即可。
   *
   * `head` 参数必须接住并拼进连接缓冲：Node 在 upgrade 事件触发后，客户端紧随握手
   * 发出的首帧可能与 upgrade 事件**同批到达**，这些字节会经由 head 传出 —— 若丢弃，
   * 客户端在握手后 0ms 立即发的第一帧（真实 Agent 的 initialize 常见此形态）会被静默吞掉，
   * 表现为「initialize 永远无响应」。vite 插件 / serve.mjs 宿主已传 head，独立进程入口补齐。
   */
  function handleUpgrade(req, socket, head) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    // 只接管本 relay 的挂载路径，其余路径放行给宿主（避免抢占宿主的其它 WS）
    if (url.pathname !== path && url.pathname !== `${path}/`) {
      // 宿主可能有别的 upgrade 处理者；无处理者时给出明确响应而不是挂死
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    const key = req.headers['sec-websocket-key']
    const upgrade = String(req.headers.upgrade || '').toLowerCase()
    if (upgrade !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    )
    socket.setNoDelay(true)
    const conn = new WsConnection(socket, head)
    connections.add(conn)
    conn.on('close', () => connections.delete(conn))

    const role = url.searchParams.get('role')
    const provided = url.searchParams.get('token')

    // 端点二选一（§10.1 双入口同进程）：
    // - `?role=browser` 是页面侧桥（连出）；
    // - 不带 role 的是 MCP Agent 端点（标准 tools/list + tools/call）。
    // **必须显式分支**：两者共用同一 upgrade 通道，若 Agent 连接落进 browser 分支，
    // 会把 browserConn 覆盖成 Agent 连接 —— 此后 relay 向「浏览器」下发的请求会打回 Agent 自己，
    // 而 Agent 只认 JSON-RPC 响应、不认 relay 内部协议，表现为「调用永久无响应」。
    if (role === 'browser') {
      // 与 Agent 端点（mcp-relay 的 initialize）统一用时间安全比较 safeEqual：
      // 同一进程两套 token 口径是审计 P3-2 指出的不一致，时序侧信道防线不该因入口不同而打折。
      if (!router.token || !safeEqual(provided ?? '', token)) {
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
  }

  /** stdio MCP 入口：逐行 JSON-RPC（MCP over stdio，§10.1） */
  function attachStdio(input = process.stdin, output = process.stdout) {
    let buf = ''
    const ctx = { authed: false }
    log('[relay] stdio MCP 入口已开启')
    input.setEncoding('utf8')
    input.on('data', async (chunk) => {
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(idx, idx + 1) === '\n' ? buf.slice(0, idx).trim() : ''
        buf = buf.slice(idx + 1)
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
          continue
        }
        const out = await router.handle(msg, ctx)
        if (out) output.write(JSON.stringify(out) + '\n')
      }
    })
  }

  /** 断开所有连接（进程退出 / 宿主关停时调用） */
  function close() {
    for (const c of connections) c.close()
    connections.clear()
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.reject(new Error('relay 已关闭'))
    }
    pending.clear()
    browserConn = null
  }

  return { token, path, protocolVersion: MCP_PROTOCOL_VERSION, handleUpgrade, attachStdio, close, issueConfirm: router.issueConfirm, confirmStore: router.confirmStore, isBrowserOnline, handle: router.handle }
}

/** @typedef {ReturnType<typeof createRelay>} RelayHandle */

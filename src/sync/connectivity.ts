/**
 * 同步中心的「位置判定」与「连通性探测」。
 *
 * ## 为什么需要独立一层
 * 顶栏徽章以前只读引擎的 `status`，而引擎只在两种情况下才会翻成 offline：
 *   - `navigator.onLine === false`
 *   - 某一轮同步真的抛异常
 *
 * 致命的地方在于：**没有待推送数据时根本不会发请求**。于是同步中心早就连不上了，
 * 徽章还一直显示「已同步」—— 一个典型的假绿。
 *
 * 这里把两件正交的事拆开：
 *   ① **中心在哪**：未配置 / 就在本机（回环地址）/ 在远端
 *   ② **连得上吗**：由**独立的周期性探测**决定，不再依赖「恰好有东西要同步」
 *
 * 本模块刻意不 import store / db —— 只做判定与探测，输入输出都是纯的，便于单测。
 */

/** 同步中心的位置 */
export type SyncTargetKind = 'none' | 'loopback' | 'remote'

/** 连通性：独立于「有没有待同步数据」，必须单独记录 */
export type SyncReachability = 'unknown' | 'checking' | 'online' | 'offline'

/** 探测超时。探测是「体检」不是「业务请求」，超时要更短，避免徽章长期停在「检测中」 */
export const PROBE_TIMEOUT_MS = 5_000

/**
 * 当前页面协议，作为「不带协议的地址」的补全依据（可注入，便于单测）。
 *
 * ⚠️ **为什么需要它（2026-10-10 线上实测）**：本模块原先对不带协议的地址**恒定补 `http://`**。
 * 而页面本身若是 HTTPS，浏览器会把由此产生的 HTTP 请求判定为**混合内容**并拦截 ——
 * 外在表现是地址栏标「不安全」，但证书面板里「证书有效」依然成立（两件事并不矛盾），
 * 用户完全看不出根因，只会以为站点证书出了问题（正式环境 `https://team.fpigeon.fun` 即此现象）。
 *
 * 与 `agent/bridge.ts` 的 `resolveBridgeBase` 同一手法：**协议跟随页面**。
 * 无 `location`（Node 单测）时退回 `http:`，保持既有行为。
 */
export function resolveFallbackProtocol(
  loc: Location | undefined = typeof location !== 'undefined' ? location : undefined,
): 'http:' | 'https:' {
  return loc?.protocol === 'https:' ? 'https:' : 'http:'
}

/**
 * 宽松解析服务器地址。
 *
 * 设置页允许用户填 `localhost:8090` 这类不带协议的地址，这里补全协议后再解析 ——
 * **补哪个协议跟着页面走**（HTTPS 页面补 `https://`，否则补 `http://`，见
 * `resolveFallbackProtocol`）；实在解析不出来返回 null（调用方按「远端」保守处理，
 * 照常探测，而不是假装本机而放弃探测）。
 */
export function parseServerUrl(
  raw: string,
  fallbackProtocol: 'http:' | 'https:' = resolveFallbackProtocol(),
): URL | null {
  const s = raw.trim()
  if (!s) return null
  for (const candidate of [s, `${fallbackProtocol}//${s}`]) {
    try {
      const u = new URL(candidate)
      if (u.hostname) return u
    } catch {
      /* 换下一种写法再试 */
    }
  }
  return null
}

/**
 * 主机名是否指向本机。
 *
 * 口径：`localhost`、`127.0.0.0/8` 全段、IPv6 `::1`、以及 `0.0.0.0`
 * （后者是 Docker / Windows 上常见的「本机监听」写法）。
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!h) return false
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true
  return /^127(?:\.\d{1,3}){3}$/.test(h)
}

/** 从配置的服务器地址判定同步中心位置（未配置 → `none`） */
export function classifySyncTarget(
  serverUrl: string,
  fallbackProtocol: 'http:' | 'https:' = resolveFallbackProtocol(),
): SyncTargetKind {
  if (!serverUrl.trim()) return 'none'
  const parsed = parseServerUrl(serverUrl, fallbackProtocol)
  if (!parsed) return 'remote'
  return isLoopbackHost(parsed.hostname) ? 'loopback' : 'remote'
}

/** 健康探测端点：PocketBase 内置、无需鉴权 */
export function healthUrl(
  serverUrl: string,
  fallbackProtocol: 'http:' | 'https:' = resolveFallbackProtocol(),
): string | null {
  const base = parseServerUrl(serverUrl, fallbackProtocol)
  if (!base) return null
  const prefix = base.pathname.replace(/\/+$/, '')
  return `${base.origin}${prefix}/api/health`
}

export interface SyncProbeResult {
  ok: boolean
  /** 失败原因（成功时为空串） */
  error: string
  /** 往返耗时（ms） */
  latencyMs: number
}

/**
 * 判断一个异常是否属于「**网络层面连不上**」，而不是「连上了但被拒绝」。
 *
 * 这个区分很关键：401 / 凭据错误说明**同步中心是活的**，此时徽章不该报「无法连接」——
 * 那是两个完全不同的问题（一个去查网络、一个去查密码），混在一起会把用户引向错误的排查方向。
 */
export function isNetworkFailure(err: unknown): boolean {
  // fetch 在网络层失败时抛 TypeError；我们自己的超时抛 AbortError
  if (err instanceof TypeError) return true
  if (err instanceof Error && err.name === 'AbortError') return true
  return false
}

/**
 * 判断响应体是不是 PocketBase 的健康响应。
 *
 * **为什么不能只看 HTTP 状态码**：本项目线上实测（2026-10-09，`8.153.19.221:9001`）——
 * 未知路径 `/api/definitely-not-here` 会落到 SPA 回退，返回 **`200` + `text/html`
 * 的 index.html（1704 字节）**；而真正的 `/api/health` 是 `application/json`
 * 的 `{"message":"API is healthy.","code":200,"data":{}}`。
 *
 * 也就是说：只认 2xx 的话，「同步中心地址填成了站点根」会被显示成「已连接」，
 * 而且用户会一直等一个永远不会同步成功的东西 —— 又一个假绿。
 */
export function isHealthPayload(text: string): boolean {
  try {
    const json = JSON.parse(text) as { code?: unknown; message?: unknown }
    return json?.code === 200 && typeof json.message === 'string'
  } catch {
    return false
  }
}

/**
 * 探测同步中心是否可达：`GET /api/health`。
 *
 * 为什么用健康端点而不是登录接口：
 *   - **无需鉴权** —— 凭据错/过期不该被误报成「连不上服务器」，那是两回事
 *   - **无副作用** —— 不写 token、不改数据，可以放心 30s 打一次
 *   - 语义正好就是「这台同步中心还活着吗」
 *
 * `fetchImpl` 可注入，测试里用桩替换。
 */
export async function probeSyncCenter(
  serverUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<SyncProbeResult> {
  const url = healthUrl(serverUrl)
  if (!url) return { ok: false, error: '同步中心地址无效', latencyMs: 0 }

  // HTTPS 页面探测**明文 HTTP 的远端**：浏览器必然按「混合内容」拦截，请求根本发不出去
  // （地址栏还会标「不安全」，让用户误以为证书有问题）。与其发一个注定被拦的请求、
  // 再把它报成含糊的「网络失败」，不如直接给出可操作的原因。
  // 回环地址豁免：浏览器把 localhost / 127.0.0.1 视为可信来源，不会按混合内容拦截。
  if (
    resolveFallbackProtocol() === 'https:' &&
    url.startsWith('http://') &&
    !isLoopbackHost(new URL(url).hostname)
  ) {
    return {
      ok: false,
      error: '当前页面是 HTTPS，浏览器会拦截对明文 HTTP 同步中心的探测；请把同步中心地址改成 https:// 开头',
      latencyMs: 0,
    }
  }

  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS
  const doFetch = opts.fetchImpl ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const started = Date.now()

  try {
    const res = await doFetch(url, { method: 'GET', signal: ctrl.signal, cache: 'no-store' })
    const latencyMs = Date.now() - started
    if (!res.ok) return { ok: false, error: `同步中心返回 HTTP ${res.status}`, latencyMs }

    // 只认 2xx 不够 —— 地址填成站点根时，SPA 回退会给出 200 + index.html。
    // 必须验明响应体确实是 PocketBase 的健康响应（见 isHealthPayload 的头注释）。
    const body = await res.text()
    if (!isHealthPayload(body)) {
      return {
        ok: false,
        error: '该地址没有返回 PocketBase 健康响应（地址填错了？）',
        latencyMs,
      }
    }
    return { ok: true, error: '', latencyMs }
  } catch (err) {
    const latencyMs = Date.now() - started
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      error: aborted
        ? `探测超时（${timeoutMs} ms）`
        : err instanceof Error
          ? err.message
          : '无法连接同步中心',
      latencyMs,
    }
  } finally {
    clearTimeout(timer)
  }
}

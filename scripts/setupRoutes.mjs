/**
 * 首启自助注册（2026-11-01）—— `GET /setup/status` + `POST /setup/user` 的实现。
 *
 * ## 为什么需要它
 *
 * 在此之前账号只能由容器启动时按 `WORKHUB_ADMIN_USER/PASSWORD` 写死创建（见
 * `deploy/docker/entrypoint.mjs#ensureAppUser`），用户拿到的用户名是 `admin`、
 * 初始密码是 compose 里的默认值 `password`（公开可知），登录后还得被强制改密。
 * 本模块把「第一个账号」交给用户自己设：空库时页面出初始化引导，账号密码由用户填。
 *
 * ## 三条设计约束（改动前先看）
 *
 * 1. **天然自关闭**：唯一判据是「`users` 集合 `totalItems === 0`」。建出第一个账号之后
 *    这个接口就永远回 409 —— 不需要额外的开关文件，也不存在「忘了关」的窗口。
 * 2. **必须用超管凭据**：`users.createRule` 是 Locked（禁止自助注册），且首个账号产生时
 *    还没有任何登录态。超管凭据只活在容器环境变量里（`PB_SUPERUSER` / `PB_SUPERUSER_PASSWORD`），
 *    页面拿不到也不该拿到 —— 所以创建动作只能发生在服务端。
 * 3. **失败必须回原文**：PB 的 400 里带着 `data.<字段>.message`（重复用户名、邮箱格式…），
 *    吞掉它会让用户看到「创建失败」而不知道改什么（本仓反复踩过「错误不可见」的坑）。
 *
 * ## 安全边界
 *
 * - 不需要 token（首次初始化时还没有账号），因此窗口极短：一旦有账号立刻 409；
 * - 输入校验与 PB 自身约束**同口径**（用户名 3–32 位、密码 ≥8 位），非法输入不触达 PB；
 * - 不写日志、不回显密码；错误消息里只出现 PB 的原文。
 */
import { Buffer } from 'node:buffer'

export const SETUP_STATUS_PATH = '/setup/status'
export const SETUP_USER_PATH = '/setup/user'

/** PB users 集合 username 字段的默认约束（见 PB 0.23+ 内置 auth 集合定义） */
const IDENTITY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/
const IDENTITY_MIN = 3
const IDENTITY_MAX = 32
const PASSWORD_MIN = 8
/** 请求体上限：初始化表单只该有几百字节，超大 body 直接拒（不读进内存） */
const MAX_BODY_BYTES = 4 * 1024
/** 状态查询的超时：PB 挂了不能让首屏「正在检查登录状态…」无限转 */
const STATUS_TIMEOUT_MS = 3000

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 校验初始化表单。
 *
 * 为什么不用邮箱当唯一 identity：`users.username` 是 PB 内置字段，但它的默认 pattern
 * 不接受 `@`；把带 `@` 的串写进 username 会被 PB 以「格式非法」拒掉，而用户看到的只是
 * 「创建失败」。所以这里先挡住，并明说允许哪些字符。
 */
export function parseSetupInput(body) {
  const identity = String(body?.identity ?? '').trim()
  const password = String(body?.password ?? '')
  const email = String(body?.email ?? '').trim()

  if (!identity) return { error: '请填写用户名' }
  if (identity.length < IDENTITY_MIN || identity.length > IDENTITY_MAX) {
    return { error: `用户名需 ${IDENTITY_MIN}–${IDENTITY_MAX} 位` }
  }
  if (!IDENTITY_PATTERN.test(identity)) {
    return { error: '用户名只能用字母、数字、下划线、点、横线，且不能以点或横线开头' }
  }
  if (password.length < PASSWORD_MIN) return { error: `密码至少 ${PASSWORD_MIN} 位` }
  if (email && !EMAIL_PATTERN.test(email)) return { error: '邮箱格式不正确' }

  // 没给邮箱时按容器既有约定合成一个占位邮箱：PB 的 auth 集合要求 email 必填，
  // 而登录 identity 走 username，占位邮箱只是为了让记录能落库。
  // ⚠️ 占位邮箱必须与登录端（`AuthGate.toIdentity`）用同一套小写规则：PB 0.40 不归一化
  // 邮箱大小写，否则「注册 Alice、登录 alice」会直接认证失败。username 保留用户输入（展示用）。
  return { identity, password, email: email || `${identity.toLowerCase()}@workhub.local` }
}

/** 把 PB 的 400 摊平成一句人话（保留原始 message，不吞原因） */
export function pbErrorMessage(body, fallback) {
  const parts = []
  if (body?.message) parts.push(String(body.message))
  if (body?.data && typeof body.data === 'object') {
    for (const [field, info] of Object.entries(body.data)) {
      if (info?.message) parts.push(`${field}: ${info.message}`)
    }
  }
  return parts.length ? parts.join('；') : fallback
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/**
 * 超管登录，拿一次性 token。
 *
 * 为什么不做缓存：这个模块只在「首启窗口」被调用（每次 1–2 个请求），
 * 缓存省不下什么，反而要处理 PB 的 token 过期。
 */
export async function pbSuperuserToken({
  pbBase,
  superuser = '',
  superuserPassword = '',
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = String(pbBase || '').replace(/\/+$/, '')
  if (!superuser || !superuserPassword) {
    throw new Error('未配置 PB_SUPERUSER / PB_SUPERUSER_PASSWORD，无法查询或创建账号')
  }
  const res = await fetchImpl(`${base}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: superuser, password: superuserPassword }),
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body?.token) {
    throw new Error(body?.message || `超管登录失败（HTTP ${res.status}）`)
  }
  return body.token
}

/**
 * 确保 `users` 有 `username` 字段（幂等）。
 *
 * 只补字段、**不动 `passwordAuth.identityFields`**：0.40 的文本字段没有 UNIQUE 约束，
 * 把 username 加进登录标识必被拒（validation_missing_unique_constraint）；登录始终走邮箱，
 * username 只是展示字段，因此也不需要 `unique`（该选项在 PB 文本字段上不存在，会被忽略）。
 *
 * 为什么服务端要顺手补：`users` 刻意不在 `pb_setup/collections.json` 里（见 `pb_setup/README.md` §2），
 * 没有「导入即生效」的通道。补不上时调用方会跳过 username 字段继续建号，不阻断首启。
 *
 * @returns {Promise<{changed: boolean, hasUsernameField: boolean}>}
 */
async function ensureUsersUsernameField({
  pbBase,
  superuser = '',
  superuserPassword = '',
  fetchImpl = globalThis.fetch,
  token,
} = {}) {
  const base = String(pbBase || '').replace(/\/+$/, '')
  const auth = token || (await pbSuperuserToken({ pbBase: base, superuser, superuserPassword, fetchImpl }))

  const res = await fetchImpl(`${base}/api/collections/users`, {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  const col = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(col?.message || `读取 users 集合失败（HTTP ${res.status}）`)

  const fields = Array.isArray(col?.fields) ? col.fields : []
  if (fields.some((f) => f?.name === 'username')) return { changed: false, hasUsernameField: true }

  const addField = await fetchImpl(`${base}/api/collections/users`, {
    method: 'PATCH',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      fields: [
        ...fields,
        {
          name: 'username',
          type: 'text',
          required: false,
          presentable: true,
          options: { min: IDENTITY_MIN, max: IDENTITY_MAX, pattern: '^[A-Za-z0-9_][A-Za-z0-9_.-]*$' },
        },
      ],
    }),
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  if (!addField.ok) {
    const body = await addField.json().catch(() => ({}))
    throw new Error(pbErrorMessage(body, `为 users 添加 username 字段失败（HTTP ${addField.status}）`))
  }
  return { changed: true, hasUsernameField: true }
}

/**
 * 创建初始化服务。
 *
 * @param {object} opts
 * @param {string} opts.pbBase           PocketBase 基址（容器内回环）
 * @param {string} [opts.superuser]      超管邮箱
 * @param {string} [opts.superuserPassword] 超管密码
 * @param {Function} [opts.fetchImpl]    便于测试注入
 * @param {Function} [opts.onUserCreated] 首个账号建成后的回调（serve.mjs 用它写「密码已自定义」标记）
 */
export function createSetupService({
  pbBase,
  superuser = '',
  superuserPassword = '',
  fetchImpl = globalThis.fetch,
  onUserCreated,
} = {}) {
  const base = String(pbBase || '').replace(/\/+$/, '')

  function superuserToken() {
    return pbSuperuserToken({ pbBase: base, superuser, superuserPassword, fetchImpl })
  }

  async function countUsers(token) {
    const res = await fetchImpl(`${base}/api/collections/users/records?perPage=1`, {
      headers: { authorization: token },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.message || `查询 users 失败（HTTP ${res.status}）`)
    return Number(body?.totalItems ?? 0)
  }

  /** 空库判据 —— 页面首启引导、`/setup/user` 的 409、`/relay/auth-status` 的启用判据都用它 */
  async function hasUsers() {
    const token = await superuserToken()
    return (await countUsers(token)) > 0
  }

  /** 补 username 展示字段；失败由 createUser 兜住，不阻断建号 */
  async function ensureUsernameField(token) {
    return ensureUsersUsernameField({ pbBase: base, fetchImpl, token })
  }

  async function createUser(raw) {
    const parsed = parseSetupInput(raw)
    if (parsed.error) return { status: 400, body: { error: parsed.error } }

    let token
    try {
      token = await superuserToken()
    } catch (e) {
      return { status: 503, body: { error: e?.message ?? String(e) } }
    }

    let total
    try {
      total = await countUsers(token)
    } catch (e) {
      return { status: 503, body: { error: e?.message ?? String(e) } }
    }
    // 空库判据在写入前再确认一次：并发两个请求时后到的那个必须落 409，不能建出第二个账号
    if (total > 0) return { status: 409, body: { error: '已完成初始化' } }

    // 用户名**不做** PB 的登录标识：0.40 的 text 字段无法声明 UNIQUE 约束，
    // identityFields 里加 username 必被 PB 拒（validation_missing_unique_constraint）。
    // 登录走前端映射的 `<用户名>@workhub.local` 邮箱 —— 用户无感。
    // username 只用于展示：补得上就一并写入，补不上（老库没这个字段 / PATCH 失败）就不带，
    // 绝不能因为它让首启建号失败。
    let hasUsernameField = false
    try {
      hasUsernameField = (await ensureUsernameField(token)).hasUsernameField
    } catch (e) {
      console.warn('[setup] 补 username 展示字段失败（不影响建号）：', e?.message ?? e)
    }

    const payload = {
      email: parsed.email,
      password: parsed.password,
      passwordConfirm: parsed.password,
      verified: true,
    }
    if (hasUsernameField) payload.username = parsed.identity

    const created = await fetchImpl(`${base}/api/collections/users/records`, {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!created.ok) {
      const body = await created.json().catch(() => ({}))
      return { status: 400, body: { error: pbErrorMessage(body, `创建账号失败（HTTP ${created.status}）`) } }
    }

    try {
      onUserCreated?.()
    } catch {
      /* 标记写失败不影响账号已建成这一事实 */
    }
    return { status: 200, body: { ok: true } }
  }

  /**
   * 接管 `/setup/*`。
   * @returns {boolean} 是否已处理（false 时调用方继续走 relay / 静态站）
   */
  function handleRequest(req, res) {
    const path = String(req.url || '').split('?')[0]
    if (path === SETUP_STATUS_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeJson(res, 405, { error: '只支持 GET' })
        return true
      }
      void (async () => {
        try {
          writeJson(res, 200, { needsSetup: !(await hasUsers()) })
        } catch (e) {
          // 拿不到判据时回 200 + 原因：页面据此回落到普通登录表单（fail-open），
          // 而不是把所有人挡在「正在检查」上
          writeJson(res, 200, { needsSetup: false, error: e?.message ?? String(e) })
        }
      })()
      return true
    }

    if (path === SETUP_USER_PATH) {
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: '只支持 POST' })
        return true
      }
      void (async () => {
        let body
        try {
          body = await readJsonBody(req)
        } catch (e) {
          writeJson(res, 400, { error: e?.message ?? String(e) })
          return
        }
        try {
          const result = await createUser(body)
          writeJson(res, result.status, result.body)
        } catch (e) {
          writeJson(res, 500, { error: e?.message ?? String(e) })
        }
      })()
      return true
    }

    return false
  }

  return { hasUsers, createUser, ensureUsernameField, handleRequest }
}

#!/usr/bin/env node
/**
 * 把 `users` 集合的登录 identity 扩成「邮箱或用户名」（幂等，只改这一处设置）。
 *
 * ## 为什么需要单独一个脚本
 *
 * `users` 是 PocketBase 内置认证集合，**刻意不在 `pb_setup/collections.json` 里**
 * （见 `pb_setup/README.md` §2：放进去会让每次部署把线上手工调过的登录设置冲掉）。
 * 因此「允许用户名登录」这条改动没有任何「导入即生效」的通道 ——
 * 首启空库时由 `scripts/setupRoutes.mjs` 顺手应用，**已有部署**则要跑一次本脚本
 * （或手工在管理台 Collections → users → Options → Auth 里勾上 username）。
 *
 * ## 用法
 *
 *   PB_SUPERUSER=... PB_SUPERUSER_PASSWORD=... npm run patch:users-auth
 *   npm run patch:users-auth -- --url http://127.0.0.1:8090 --identity a@b.c --password xxx
 *
 * 默认连容器内回环 `127.0.0.1:8090`（与 `scripts/serve.mjs` 同口径），不写死任何域名。
 * 重复执行安全：已是「邮箱或用户名」就直接返回，不发 PATCH。
 */
import { ensureUsersUsernameIdentity } from './setupRoutes.mjs'

function argOf(argv, key, fallback = '') {
  const i = argv.indexOf(key)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const argv = process.argv.slice(2)
const pbBase = (
  argOf(argv, '--url') ||
  process.env.WORKHUB_PB_URL ||
  `http://${process.env.PB_HTTP || '127.0.0.1:8090'}`
).replace(/\/+$/, '')
const superuser = argOf(argv, '--identity') || process.env.PB_SUPERUSER || ''
const superuserPassword = argOf(argv, '--password') || process.env.PB_SUPERUSER_PASSWORD || ''

if (!superuser || !superuserPassword) {
  process.stderr.write(
    '[patch:users-auth] 缺超管凭据：设 PB_SUPERUSER / PB_SUPERUSER_PASSWORD，或传 --identity/--password\n',
  )
  process.exit(2)
}

try {
  const result = await ensureUsersUsernameIdentity({ pbBase, superuser, superuserPassword })
  if (result.changed) {
    process.stdout.write(`[patch:users-auth] 已更新：identityFields = ${JSON.stringify(result.identityFields)}\n`)
  } else {
    process.stdout.write(`[patch:users-auth] 已是目标状态，无需改动：${JSON.stringify(result.identityFields)}\n`)
  }
} catch (e) {
  process.stderr.write(`[patch:users-auth] 失败：${e?.message ?? e}\n`)
  process.exit(1)
}

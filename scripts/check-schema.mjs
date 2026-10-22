#!/usr/bin/env node
/**
 * 集合 schema 差异检测（本地 pb_setup/collections.json ⇄ 远端 PocketBase）
 *
 * ## 为什么需要它
 *
 * 2026-10-21 排查正式站时发现：线上停在 10-10 的镜像，`agent_events` 整张表都不存在，
 * 而**没有任何地方会告诉你这件事** —— 前端照常打开、同步照常跑（推 agent_events 时静默 404），
 * 只有翻镜像 label 才发现落后 47 个提交。PocketBase 的集合定义不在代码里，
 * 它活在数据卷的 `data.db`，因此「代码是最新的」≠「线上 schema 是最新的」。
 *
 * 更麻烦的是：容器首启的自动导入策略是「集合**一个都不存在**才自动导入；部分存在则刻意不动」
 * （见 deploy/docker/entrypoint.mjs，避免覆盖 UI 上的人工改动）。所以升级时必须有人
 * 手动 `PUT /api/collections/import` —— 在那之前，先得知道**差了什么**。
 *
 * 本脚本就是那把尺子：只读、不改任何数据，把差异打成一张人可读的报告，有差异退出码 1。
 *
 * ## 用法
 *
 *   npm run check:schema                                  # 用 .deploy.env 的 DEPLOY_*（测试站）
 *   npm run check:schema -- --prod                        # 用 .deploy.env 的 PROD_*（正式站）
 *   npm run check:schema -- --url https://team.fpigeon.fun
 *   npm run check:schema -- --url http://1.2.3.4:9001 --identity a@b.c --password xxx
 *
 * 凭据优先级：命令行 > 环境变量（WORKHUB_SUPERUSER / WORKHUB_SUPERUSER_PASSWORD）> .deploy.env 的对应段
 *
 * ⚠️ **正式站与测试站的超管是两套账号**（同名不同密码），故用 `--prod` 切段，
 * 不要手工 `--password "$(ssh …)"` —— 每次现取既要连服务器，也容易取错环境。
 *
 * ## 刻意不做的事
 * - 不自动导入、不自动建表 —— 改线上 schema 必须由人确认后执行（破坏性操作的既定纪律）；
 * - 不猜口令、不留凭据到任何文件。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 远端系统集合（PB 自带，不在 collections.json 里，也不算「多出来的业务表」） */
const SYSTEM_PREFIX = '_'
const BUILTIN = new Set(['users'])

function argOf(argv, key, fallback = '') {
  const i = argv.indexOf(key)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

/** 读 .deploy.env（gitignore，不入库）；缺失时返回空对象而不是报错 */
function readDeployEnv() {
  const p = join(ROOT, '.deploy.env')
  if (!existsSync(p)) return {}
  const out = {}
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq > 0) out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim()
  }
  return out
}

function fieldsOf(coll) {
  // PB 0.23+ 用 fields[]；更老的版本用 schema[]
  const arr = coll.fields ?? coll.schema ?? []
  return new Map(arr.filter((f) => f?.name).map((f) => [f.name, f.type ?? '']))
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // 非 JSON 说明请求没进到 PocketBase（被 nginx/entrypoint 路由到了 SPA）
    throw new Error(`${url} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`)
  }
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}：${data?.message ?? text.slice(0, 120)}`)
  return data
}

/**
 * 超管登录。
 * PB 0.40 的路径是 `/api/collections/_superusers/auth-with-password`；
 * `/_superusers/...` 会被 deploy/docker/entrypoint.mjs 的路由规则挡到静态站（得到 SPA HTML）。
 */
async function login(base, identity, password) {
  const path = '/api/collections/_superusers/auth-with-password'
  const d = await postJson(base + path, { identity, password })
  if (!d.token) throw new Error('登录成功但未返回 token')
  return d.token
}

async function fetchCollections(base, token) {
  const res = await fetch(`${base}/api/collections?perPage=200`, {
    headers: { Authorization: token },
  })
  if (!res.ok) throw new Error(`拉取集合失败 HTTP ${res.status}`)
  const d = await res.json()
  return d.items ?? []
}

async function main() {
  const argv = process.argv.slice(2)
  const env = readDeployEnv()

  /**
   * `--prod` → 读 `PROD_*` 段（正式站），缺省 `DEPLOY_*`（测试站 / devtest）。
   *
   * 为什么要在脚本里区分：两个环境是**独立部署**，超管同名但密码不同
   * （正式站以服务器 `/opt/workhub/.env` 为准，24 字符；测试站 20 字符）。
   * 之前只能 `--password "$(ssh … grep …)"` 现取，每查一次要连一次服务器，
   * 而 `.deploy.env` 本就被 gitignore —— 凭据落在那儿既安全又省事。
   */
  const useProd = argv.includes('--prod')
  const P = useProd ? 'PROD' : 'DEPLOY'
  const label = useProd ? '正式站' : '测试站'

  const base = (argOf(argv, '--url', env[`${P}_PUBLIC_URL`] || '') || '').replace(/\/+$/, '')
  const identity =
    argOf(argv, '--identity') || process.env.WORKHUB_SUPERUSER || env[`${P}_SUPERUSER`] || ''
  const password =
    argOf(argv, '--password') ||
    process.env.WORKHUB_SUPERUSER_PASSWORD ||
    env[`${P}_SUPERUSER_PASSWORD`] ||
    ''

  if (!base) {
    console.error(`缺少站点地址：用 --url 指定，或在 .deploy.env 里配 ${P}_PUBLIC_URL`)
    process.exit(2)
  }
  if (!identity || !password) {
    console.error('缺少超管凭据：用 --identity/--password 指定，或配 WORKHUB_SUPERUSER(_PASSWORD)')
    process.exit(2)
  }

  const local = JSON.parse(readFileSync(join(ROOT, 'pb_setup/collections.json'), 'utf8'))
  const localMap = new Map(local.map((c) => [c.name, fieldsOf(c)]))

  console.log(`\n集合 schema 差异检测`)
  console.log(`  本地  pb_setup/collections.json（${localMap.size} 个集合）`)
  console.log(`  远端  ${base}（${label}）\n`)

  const token = await login(base, identity, password)
  const remoteRaw = await fetchCollections(base, token)
  const remoteMap = new Map(
    remoteRaw.filter((c) => !c.name.startsWith(SYSTEM_PREFIX) && !BUILTIN.has(c.name)).map((c) => [c.name, fieldsOf(c)]),
  )

  const missing = [...localMap.keys()].filter((n) => !remoteMap.has(n)).sort()
  const extra = [...remoteMap.keys()].filter((n) => !localMap.has(n)).sort()
  const fieldDiffs = []
  for (const name of [...localMap.keys()].filter((n) => remoteMap.has(n)).sort()) {
    const lf = localMap.get(name)
    const rf = remoteMap.get(name)
    // id/created/updated 由 PB 自己维护，本地 json 里本就不写全 —— 只比业务字段
    const localOnly = [...lf.keys()].filter((f) => !rf.has(f))
    const remoteOnly = [...rf.keys()].filter((f) => !lf.has(f) && !['id', 'created', 'updated'].includes(f))
    if (localOnly.length || remoteOnly.length) {
      fieldDiffs.push({ name, localOnly, remoteOnly })
    }
  }

  console.log(`远端业务集合：${remoteMap.size} 个\n`)

  if (!missing.length && !extra.length && !fieldDiffs.length) {
    console.log('✅ 完全一致：集合名与字段均与本地定义相同。')
    console.log('   （schema 已同步；若站点行为仍不对，问题不在 schema。）\n')
    return
  }

  if (missing.length) {
    console.log(`❌ 远端缺失 ${missing.length} 个集合（本地有、线上没有）：`)
    for (const n of missing) console.log(`   - ${n}`)
    console.log('   ⚠️ 缺表 = 对应功能的写入会静默失败（HTTP 404），前端通常照常打开。')
    console.log('   修复：PUT /api/collections/import 导入 collections.json 后重启 PocketBase。\n')
  }

  if (extra.length) {
    console.log(`⚠️  远端多出 ${extra.length} 个业务集合（线上有、本地没有）：`)
    for (const n of extra) console.log(`   - ${n}`)
    console.log('   可能是历史遗留或手工新建；导入 collections.json 不会删掉它们，需人工判断。\n')
  }

  if (fieldDiffs.length) {
    console.log(`❌ ${fieldDiffs.length} 个集合字段不一致：`)
    for (const d of fieldDiffs) {
      const parts = []
      if (d.localOnly.length) parts.push(`本地有而线上无 → ${d.localOnly.join(', ')}`)
      if (d.remoteOnly.length) parts.push(`线上有而本地无 → ${d.remoteOnly.join(', ')}`)
      console.log(`   - ${d.name}：${parts.join('；')}`)
    }
    console.log('')
  }

  process.exitCode = 1
}

main().catch((e) => {
  console.error(`\n检测失败：${(e).message}\n`)
  process.exit(2)
})

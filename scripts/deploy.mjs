#!/usr/bin/env node
/**
 * 寻鸽工作台 · 一键部署脚本（开发/测试环境专用）
 *
 * 流程：git pull → 判定 schema 变更 → npm build → 打包 → scp 上传 → 远程
 *       （备份 → 导入 collections → 推前端 + hooks → 重启 PocketBase → 验证）
 *
 * 用法：
 *   node scripts/deploy.mjs            # auto：schema 变则 full，否则 light（均重启服务）
 *   node scripts/deploy.mjs --full     # 强制导入配置 + 重启
 *   node scripts/deploy.mjs --light    # 跳过配置导入，仅前端+hooks+重启
 *   node scripts/deploy.mjs --force    # 无视"已是最新"继续部署
 *   node scripts/deploy.mjs --check    # 只检查待部署变更，不执行
 *
 * 配置：.deploy.env（模板见仓库 docs/部署指南.md；gitignore，不入库）
 * 状态：.deploy-state 记录上次部署 commit（gitignore）
 *
 * ⚠️ 阶段限定：本脚本仅用于当前开发/测试临时环境。正式上线换服务器时，
 *    更新 .deploy.env 即可（应用代码本身不硬编码服务器地址）。
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, '.deploy.env')
const STATE_FILE = path.join(ROOT, '.deploy-state')
const TMP = '/tmp/nexus-deploy'

const args = process.argv.slice(2)
const opt = {
  mode: 'auto', // auto | full | light
  force: false,
  check: false,
}
for (const a of args) {
  if (a === '--full') opt.mode = 'full'
  else if (a === '--light') opt.mode = 'light'
  else if (a === '--force') opt.force = true
  else if (a === '--check') opt.check = true
  else if (a === '--help' || a === '-h') {
    console.log(`用法：
  node scripts/deploy.mjs            auto（schema 变→full，否则 light；均重启）
  node scripts/deploy.mjs --full     强制导入配置 + 重启
  node scripts/deploy.mjs --light    跳过配置导入，仅前端+hooks+重启
  node scripts/deploy.mjs --force    即使已是最新也强行部署
  node scripts/deploy.mjs --check    仅显示待部署变更，不执行`)
    process.exit(0)
  } else {
    console.error(`未知参数: ${a}（--help 查看用法）`)
    process.exit(1)
  }
}

function sh(cmd, opts = {}) {
  const isSilent = opts.silent === true
  const stdout = execSync(cmd, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: isSilent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...opts,
  })
  return isSilent ? (stdout ?? '').trim() : ''
}

/* ---------- 配置 ---------- */
if (!existsSync(ENV_FILE)) {
  console.error(`缺少 ${ENV_FILE}。请参考 docs/部署指南.md 创建：
DEPLOY_SSH=devtest
DEPLOY_REMOTE_DIR=/opt/pocketbase
DEPLOY_SUPERUSER=deploy@nexus.local
DEPLOY_SUPERUSER_PASSWORD=xxx
DEPLOY_PUBLIC_URL=http://8.153.19.221:9001
`)
  process.exit(1)
}
const cfg = Object.fromEntries(
  readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/=(.*)/s).map((s) => s.trim())),
)
for (const k of ['DEPLOY_SSH', 'DEPLOY_REMOTE_DIR']) {
  if (!cfg[k]) {
    console.error(`.deploy.env 缺少 ${k}`)
    process.exit(1)
  }
}
const ssh = cfg.DEPLOY_SSH
const remoteDir = cfg.DEPLOY_REMOTE_DIR
const remoteTmp = '/tmp'
// 首次直连自动信任 host key（避免非交互卡在 yes/no 确认）；非首次仍校验指纹
// BatchMode：认证一旦需要交互（密码/passphrase）立即失败。否则 scp 步骤是静默模式
// （stdin=ignore），会在这里无限挂起而不报错——比失败更难排查。
let SSH_OPTS = '-o StrictHostKeyChecking=accept-new -o BatchMode=yes'
// 可选：显式指定私钥（沙箱/非交互环境读不到 ~/.ssh/config 别名时用 user@host + key 直连）
if (cfg.DEPLOY_SSH_KEY) {
  const keyPath = cfg.DEPLOY_SSH_KEY.replace(/^~/, os.homedir())
  SSH_OPTS += ` -i ${keyPath}`
}

/* ---------- 1. git pull ---------- */
console.log('\n== [1/10] git pull ==')
// 部署的目标是「当前 HEAD」，pull 只是尽量把本地同步到远端。
// 无上游分支 / 离线 / 有本地改动时不该阻断部署，仅告警继续。
try {
  sh('git pull --ff-only')
} catch {
  console.warn('⚠️ git pull 未成功（无上游分支 / 离线 / 冲突），按当前 HEAD 继续部署')
}
const head = sh('git rev-parse --short HEAD', { silent: true })
const headFull = sh('git rev-parse HEAD', { silent: true })

/* ---------- 2. 判定与上次部署的差异 ---------- */
const last = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')).last : null
if (last === head && !opt.force) {
  console.log(`已是最新（HEAD=${head} == 上次部署）。--force 可强行部署`)
  process.exit(0)
}
const base = last || `${head}~1`
const diffStat = sh(`git diff --stat ${base}..HEAD`, { silent: true })
console.log(`\n== [2/10] 变更对比（vs ${base}） ==`)
console.log(diffStat || '（无文件变化）')
const schemaChanged = sh(`git diff --name-only ${base}..HEAD -- pb_setup/ src/db/db.ts`)
const depsChanged = sh(`git diff --name-only ${base}..HEAD -- package.json package-lock.json`)
let mode = opt.mode
if (mode === 'auto') mode = schemaChanged ? 'full' : 'light'
console.log(`\n模式: ${mode}（schema ${schemaChanged ? '有变更' : '未变'}${opt.mode === 'auto' ? '' : `，用户指定 ${opt.mode}`}）`)

// light 模式不导入 collections，也就不该要求部署机持有超管凭据（最小权限）。
// 注意：必须在 mode 判定之后校验，否则 auto 模式判定为 full 时会漏检。
if (mode === 'full') {
  for (const k of ['DEPLOY_SUPERUSER', 'DEPLOY_SUPERUSER_PASSWORD']) {
    if (!cfg[k]) {
      console.error(`full 模式需要 .deploy.env 提供 ${k}（light 模式不需要）`)
      process.exit(1)
    }
  }
}

if (opt.check) {
  console.log('\n--check：仅检查，不执行。部署所需动作：')
  if (depsChanged) console.log('  - npm install（依赖有变更）')
  console.log('  - npm run build')
  console.log(`  - 上传 dist → 远程 ${mode === 'full' ? '导入 collections + hooks + ' : 'hooks + '}重启 PocketBase`)
  process.exit(0)
}

/* ---------- 3. 依赖 ---------- */
if (depsChanged) {
  console.log('\n== [3/10] npm install（package 有变更） ==')
  sh('npm install')
} else {
  console.log('\n== [3/10] 依赖未变，跳过 install ==')
}

/* ---------- 4. build ---------- */
console.log('\n== [4/10] npm run build ==')
sh('npm run build')

/* ---------- 5. 打包 ---------- */
console.log('\n== [5/10] 打包 ==')
sh(`mkdir -p ${TMP}`)
// macOS: COPYFILE_DISABLE=1 避免 ._* 与 xattr 警告
sh(`COPYFILE_DISABLE=1 tar czf ${TMP}/nexus-deploy.tgz -C dist .`)
sh(`COPYFILE_DISABLE=1 tar czf ${TMP}/nexus-pb.tgz -C pb_setup .`)
const distEntry = readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8').match(/src="([^"]*index-[^"]*\.js)"/)?.[1]

/* ---------- 6. 生成远程脚本 ---------- */
console.log('\n== [6/10] 生成远程脚本 ==')
const importStep = mode === 'full'
const remoteScript = `#!/bin/bash
# 寻鸽工作台一键部署远程段（由 scripts/deploy.mjs 生成）
set -e
cd ${remoteDir}
TS=$(date +%Y%m%d-%H%M%S)
echo "== [1/6] backup =="
tar czf backups/pb_public-$TS.tar.gz -C pb_public . 2>/dev/null || true
cp pb_data/data.db backups/data.db-$TS.bak 2>/dev/null || echo "!! data.db 备份失败"
echo "backup ok: $TS"

echo "== [2/6] prepare =="
rm -rf /tmp/nexus-pb && mkdir -p /tmp/nexus-pb
tar xzf ${remoteTmp}/nexus-pb.tgz -C /tmp/nexus-pb
python3 - <<'PY'
import json
src = '/tmp/nexus-pb/collections.json'
dst = '/tmp/nexus-pb/collections-import.json'
data = json.load(open(src, encoding='utf-8'))
cols = data if isinstance(data, list) else data.get('collections', data)
json.dump({"collections": cols, "deleteMissing": False}, open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('converted', len(cols), 'collections')
PY

echo "== [3/6] schema import =="
if [ "${importStep}" = "true" ]; then
  TOKEN=$(curl -s -X POST http://127.0.0.1:9002/api/collections/_superusers/auth-with-password \\
    -H "Content-Type: application/json" \\
    -d '{"identity":"${cfg.DEPLOY_SUPERUSER}","password":"${cfg.DEPLOY_SUPERUSER_PASSWORD}"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
  if [ -z "$TOKEN" ]; then echo "!!! 超管 token 获取失败"; exit 1; fi
  CODE=$(curl -s -o /tmp/import-resp.txt -w '%{http_code}' -X PUT http://127.0.0.1:9002/api/collections/import \\
    -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \\
    --data-binary @/tmp/nexus-pb/collections-import.json)
  echo "import http=$CODE"
  if [ "$CODE" != "204" ]; then cat /tmp/import-resp.txt; echo; exit 1; fi
else
  echo "light mode: skip import"
fi

echo "== [4/6] frontend + hooks =="
rm -rf pb_public/*
tar xzf ${remoteTmp}/nexus-deploy.tgz -C pb_public
find pb_public -name '._*' -delete
chmod -R a+rX pb_public
if [ -f /tmp/nexus-pb/pb_hooks/main.pb.js ]; then
  cp /tmp/nexus-pb/pb_hooks/main.pb.js pb_hooks/main.pb.js
elif [ -f /tmp/nexus-pb/main.pb.js ]; then
  cp /tmp/nexus-pb/main.pb.js pb_hooks/main.pb.js
else
  echo "!!! main.pb.js 未找到"; exit 1
fi
chmod 644 pb_hooks/main.pb.js
echo "frontend+hooks ok"

echo "== [5/6] restart =="
systemctl restart pocketbase
# ⚠️ 重启后 PocketBase 需要时间就绪，**必须轮询等待**。
# 原先是一次性探测 /api/health（单条裸 curl），埋了两个连带问题（2026-10-20 实测踩到）：
#   ① 重启瞬间必然连不上 → curl 退出码 **7**；
#   ② 本脚本有 set -e，而这是条**裸命令**（不在 if 里、也没有 || 兜底）→
#      远程段在此**当场中断**（实测：服务器上退出码就是 7）；
#   ③ 于是第 6 步验证根本没跑、.deploy-state 也没写入 —— 部署其实**已经成功**
#      （前端与 hooks 都已就位），却被记成失败、下次还会重复部署。
# ⚠️ 注意 set -e 的差别（已在服务器上逐项实测）：
#    · 裸命令失败        → 中断（退出码 7）
#    · 赋值 $(cmd) 失败  → 也中断（无兜底时）
#    · $(cmd || true)    → 继续 ✅
#    · $(grep 无匹配)    → 继续（命令替换里的失败不触发）
#    所以这里不仅要在 $() 内探测，还要 || true —— 双重保护，
#    因为不同 bash 版本对「赋值语句中命令替换失败」的处理并不一致。
# 现在：轮询到 200 才继续；真超时才失败，并把服务状态与日志打出来供排查。
HEALTH_CODE=""
for i in $(seq 1 30); do
  HEALTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9002/api/health || true)
  if [ "$HEALTH_CODE" = "200" ]; then
    echo "health=200（第 \${i} 次探测）"
    break
  fi
  sleep 1
done
if [ "$HEALTH_CODE" != "200" ]; then
  echo "!!! PocketBase 健康检查超时：30s 内未就绪（最近 code=\${HEALTH_CODE}）"
  echo "--- systemctl status pocketbase ---"
  systemctl status pocketbase --no-pager -l 2>&1 | tail -20 || true
  echo "--- 最近日志 ---"
  journalctl -u pocketbase -n 30 --no-pager 2>&1 || true
  exit 1
fi
# is-active 若不是 active 会返回非 0 —— 加 '|| true'，避免这条**裸命令**触发 set -e
#（健康检查已通过，服务状态此处仅作参考展示，不该中断部署）
systemctl is-active pocketbase || true

echo "== [6/6] verify =="
# TOKEN2 仅用于统计集合数，取不到不该中断部署。
# '|| echo ""' 兜底：curl 失败 → python3 收到空输入抛错 → 同样会让 set -e 杀掉部署。
TOKEN2=$(curl -s -X POST http://127.0.0.1:9002/api/collections/_superusers/auth-with-password \\
  -H "Content-Type: application/json" \\
  -d '{"identity":"${cfg.DEPLOY_SUPERUSER}","password":"${cfg.DEPLOY_SUPERUSER_PASSWORD}"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
echo "entry: $(grep -oE 'index-[A-Za-z0-9_-]+\\.js' pb_public/index.html | head -1)"
echo "hooks: $(md5sum pb_hooks/main.pb.js | cut -d' ' -f1)"
echo "files: $(find pb_public -type f | wc -l)"
echo "collections:"
curl -s -H "Authorization: $TOKEN2" 'http://127.0.0.1:9002/api/collections?perPage=200' | python3 -c 'import sys,json;items=json.load(sys.stdin)["items"];print(len(items))' 2>/dev/null || echo "(list failed)"
echo "== remote done =="
`
writeFileSync(path.join(TMP, 'nexus-remote.sh'), remoteScript)

/* ---------- 7. scp 上传 ---------- */
console.log('\n== [7/10] scp 上传 ==')
// 注意: scp 的 -o 选项必须放在目标前面
sh(`scp ${SSH_OPTS} ${TMP}/nexus-deploy.tgz ${TMP}/nexus-pb.tgz ${TMP}/nexus-remote.sh ${ssh}:${remoteTmp}/`, { silent: true })
console.log('upload ok')

/* ---------- 8. 远程执行 ---------- */
console.log(`\n== [8/10] 远程执行（${mode}） ==`)
sh(`ssh ${SSH_OPTS} ${ssh} 'bash ${remoteTmp}/nexus-remote.sh'`)

/* ---------- 9. 公网验证 ---------- */
// 注意转义层级：这里是**模板字符串**，`\\.` 到 shell 才是 `\.`（正则「字面点」）。
// 曾写成 `\\\\.` → shell 实收 `\\.`（字面反斜杠 + 任意字符）→ grep 永不匹配、退出码 1，
// 又因 execSync 抛错而**在写 .deploy-state 之前中断**（部署其实已成功，状态却没记）。
// 验证步骤一律不得中断部署：取不到就按「无法确认」告警，让人工核对。
console.log('\n== [9/10] 公网验证 ==')
let pubEntry = '(无法获取)'
let pubHealth = '(未取到)'
if (cfg.DEPLOY_PUBLIC_URL) {
  try {
    pubEntry = sh(
      `curl -s ${cfg.DEPLOY_PUBLIC_URL}/ | grep -oE 'src="[^"]*index-[^"]*\\.js"'`,
      { silent: true },
    ).replace(/src="|"/g, '')
    pubHealth = sh(
      `curl -s -o /dev/null -w '%{http_code}' ${cfg.DEPLOY_PUBLIC_URL}/api/health`,
      { silent: true },
    )
    console.log(`公网入口: ${pubEntry}  health=${pubHealth}`)
  } catch {
    console.warn(`⚠️ 公网验证未取到结果（${cfg.DEPLOY_PUBLIC_URL}）——请手动核对入口 JS 与 /api/health`)
  }
}
console.log(`本地 dist: ${distEntry}`)
if (pubEntry === '(无法获取)') {
  console.warn('⚠️ 未确认公网入口：无法判断「部署是否已生效」，请手动打开站点核对')
} else if (pubEntry !== distEntry) {
  console.error('⚠️ 公网入口与本地 dist 不一致！可能未生效，请检查缓存')
} else {
  console.log('✅ 公网入口与本地 dist 一致')
}

/* ---------- 10. 更新状态 ---------- */
writeFileSync(STATE_FILE, JSON.stringify({ last: head, full: headFull, mode, at: new Date().toISOString() }, null, 2))
console.log(`\n✅ 部署完成：${last || '(首次)'} → ${head}（${mode}）已记录到 .deploy-state`)
console.log('待办：如 schema 有升级，请在设置里做一次「全量推送」补旧记录字段')
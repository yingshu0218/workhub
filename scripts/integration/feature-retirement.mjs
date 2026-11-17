/** 真实 PB 0.40.2 退役写边界；只使用新建临时库及合成历史记录。 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, openSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import { pathToFileURL } from 'node:url'

const bin = process.env.PB_BIN
if (!bin) throw new Error('PB_BIN 必须指向隔离 PocketBase 0.40.2 可执行文件')
assert.match(spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout, /0\.40\.2/)
const root = resolve(process.env.WORKHUB_ROOT || '.')
const temp = mkdtempSync(join(tmpdir(), 'workhub-feature-retirement-'))
const data = join(temp, 'data'), hooks = join(root, 'pb_setup/pb_hooks'), migrations = join(root, 'pb_setup/pb_migrations')
const coreModule = { exports: {} }
runInNewContext(readFileSync(join(hooks, 'command-core.js'), 'utf8'), { module: coreModule, exports: coreModule.exports })
const { stable } = coreModule.exports
const hash = value => createHash('sha256').update(stable(value)).digest('hex')
const email = 'fixture@example.test', password = randomBytes(18).toString('hex')
const probe = createServer().listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
probe.close(); await once(probe, 'close')
const base = `http://127.0.0.1:${port}`
const pbLog = openSync(join(temp, 'pocketbase.log'), 'a')
let pb, token = '', superToken = '', generation = '', ownerId = '', seq = 0
const tests = []
async function api(path, body, auth = token, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, {
    method, headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}
async function good(path, body, auth = token) {
  const result = await api(path, body, auth)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  return result.body
}
async function rows(table) { return (await good(`/api/collections/${table}/records?perPage=500`, undefined, superToken)).items }
async function seed(table, value) {
  return good(`/api/collections/${table}/records`, {
    ...(value.localId ? { id: createHash('sha256').update(value.localId).digest('hex').slice(0, 15) } : {}),
    ...value,
  }, superToken)
}
async function test(name, run) { await run(); tests.push(name); console.log('PASS', name) }
const put = (table, value) => ({ table, id: value.id, kind: 'put', value })
const command = (writes, reads, extra = {}) => ({ protocol: 1, generation, requestId: 'retirement_request_' + (++seq), writes, reads, scans: [], ...extra })
function local(row) {
  const value = { ...row, id: row.localId }
  for (const key of ['localId', 'collectionId', 'collectionName', 'created', 'updated', 'server_received_at']) delete value[key]
  return value
}
async function historicOperation(c, status) {
  const record = await seed('operations', {
    owner: ownerId, clientId: 'owner', requestId: c.requestId, generation, status,
    fingerprint: hash(c.intent === undefined ? c : { intent: c.intent, generation }),
    planFingerprint: hash({ writes: c.writes, reads: c.reads, scans: c.scans }),
    plan: status === 'committed' ? null : c,
    result: status === 'committed' ? { operationId: 'historic-receipt', requestId: c.requestId, generation, changes: [], result: { ok: true, data: { recordedBeforeRetirement: true } } } : null,
  })
  return record
}

try {
  console.log('ISOLATED_ROOT', temp)
  const init = spawnSync(bin, ['superuser', 'upsert', email, password, '--dir', data, '--hooksDir', hooks, '--migrationsDir', migrations], { encoding: 'utf8' })
  assert.equal(init.status, 0, init.stderr + init.stdout)
  pb = spawn(bin, ['serve', '--http', `127.0.0.1:${port}`, '--dir', data, '--hooksDir', hooks, '--migrationsDir', migrations], { stdio: ['ignore', pbLog, pbLog] })
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (pb.exitCode !== null) throw new Error(readFileSync(join(temp, 'pocketbase.log'), 'utf8'))
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break } } catch {}
    await delay(50)
  }
  assert.ok(ready, 'PB 启动超时')
  superToken = (await good('/api/collections/_superusers/auth-with-password', { identity: email, password }, '')).token
  await good('/api/workhub/initialize', { email: 'owner@workhub.local', identity: 'owner', password }, superToken)
  token = (await good('/api/collections/users/auth-with-password', { identity: 'owner@workhub.local', password }, '')).token
  ownerId = (await rows('users'))[0].id
  generation = (await good('/api/workhub/state')).generation

  const history = {
    habits: { id: 'history-habit', name: '历史习惯', category: '旧资料', schedule: '每日' },
    habitLogs: { id: 'history-log', habitId: 'history-habit', date: '2026-10-01', completedAt: 1 },
    trophies: { id: 'history-trophy', name: '历史奖杯', unlockedAt: 1 },
  }
  for (const [table, value] of Object.entries(history)) {
    const { id, ...fields } = value
    history[table] = local(await seed(table, { localId: id, ...fields, createdAt: 1, updatedAt: 1, rev: 1, deleted: 0 }))
  }

  await test('三类退役记录新建/编辑/伪装恢复在 commands 与 preview 均拒绝，事务不留副作用', async () => {
    const before = Object.fromEntries(await Promise.all(['habits', 'habitLogs', 'trophies', 'operations', 'operation_effects'].map(async table => [table, await rows(table)])))
    for (const [table, value] of Object.entries(history)) {
      for (const creation of [true, false]) {
        const next = creation ? { ...value, id: value.id + '-new' } : { ...value, name: '不得修改' }
        const c = command([put(table, next)], [{ table, id: next.id, rev: creation ? null : 1 }], { kind: 'restore' })
        for (const endpoint of ['commands', 'preview']) {
          const result = await api('/api/workhub/' + endpoint, c)
          assert.equal(result.status, 400, JSON.stringify(result.body))
          assert.match(result.body.error, /FEATURE_RETIRED/)
        }
      }
    }
    for (const table of Object.keys(before)) assert.deepEqual(await rows(table), before[table])
  })

  await test('纯回收站删除/恢复保留历史字段，恢复不产生打卡通知；顺带编辑拒绝', async () => {
    const beforeEvents = await rows('agent_events')
    const soft = Object.entries(history).map(([table, row]) => put(table, { ...row, deleted: 1, deletedAt: Date.now() }))
    await good('/api/workhub/commands', command(soft, soft.map(w => ({ table: w.table, id: w.id, rev: 1 }))))
    const restores = []
    for (const table of Object.keys(history)) {
      const old = local((await rows(table))[0])
      const restored = { ...old, deleted: 0, deletedAt: null, restoredAt: Date.now(), trashSnapshot: null }
      const changed = { ...restored, [table === 'habitLogs' ? 'date' : table === 'trophies' ? 'unlockedAt' : 'name']: table === 'trophies' ? 99 : '篡改历史' }
      assert.match((await api('/api/workhub/commands', command([put(table, changed)], [{ table, id: old.id, rev: 2 }], { kind: 'restore' }))).body.error, /FEATURE_RETIRED/)
      restores.push(put(table, restored))
    }
    const receipt = await good('/api/workhub/commands', command(restores, restores.map(w => ({ table: w.table, id: w.id, rev: 2 }))))
    for (const change of receipt.changes) {
      for (const [field, value] of Object.entries(history[change.table])) {
        if (['rev', 'updatedAt', 'deleted', 'deletedAt', 'restoredAt', 'trashSnapshot', 'tombstonePushed'].includes(field)) continue
        assert.deepEqual(change.row[field], value)
      }
    }
    assert.deepEqual(await rows('agent_events'), beforeEvents)
  })

  await test('旧待确认计划不能提交，已提交回执重试保持成功，其他业务继续写入', async () => {
    const value = { ...history.habits, id: 'old-pending-habit' }
    const prior = command([put('habits', value)], [{ table: 'habits', id: value.id, rev: null }])
    await historicOperation(prior, 'awaiting_confirmation')
    for (const endpoint of ['commands', 'preview']) assert.match((await api('/api/workhub/' + endpoint, prior)).body.error, /FEATURE_RETIRED/)
    const committed = { ...prior, requestId: 'historic_committed_request' }
    await historicOperation(committed, 'committed')
    assert.equal((await good('/api/workhub/commands', committed)).operationId, 'historic-receipt')
    assert.equal((await rows('habits')).length, 1)
    const task = put('todos', { id: 'still-supported', title: '仍可创建待办', status: 'todo' })
    await good('/api/workhub/commands', command([task], [{ table: 'todos', id: task.id, rev: null }]))
    assert.equal((await rows('todos'))[0].title, '仍可创建待办')
  })

  await test('生产 Node 执行器接住旧工具并拒绝新写，只回放原已提交回执，历史清单仍可读', async () => {
    const { initServerExecutor } = await import(pathToFileURL(join(root, 'dist-server/server-executor.mjs')).href)
    const executor = initServerExecutor({ pb: { baseUrl: base, account: 'owner@workhub.local', password }, domains: { habit: true, read: true, todo: true } })
    const retired = ['habit_createHabit', 'habit_updateHabit', 'habit_checkin', 'habit_deleteHabit']
    for (const name of retired) {
      assert.equal(executor.handles(name), true)
      assert.ok(!executor.listTools().some(tool => tool.name === name))
      const result = await executor.callTool(name, { habitId: 'history-habit', name: '旧写入口' }, { requestId: 'node_retired_' + name, generation })
      assert.equal(result.ok, false)
      assert.match(result.error, /FEATURE_RETIRED/)
    }
    const input = { name: '退役前已提交' }
    const pending = command([put('habits', { ...history.habits, id: 'node-old' })], [{ table: 'habits', id: 'node-old', rev: null }], { intent: { tool: 'habit_createHabit', input } })
    await historicOperation(pending, 'awaiting_confirmation')
    assert.match((await executor.callTool('habit_createHabit', input, { requestId: pending.requestId, generation, confirmToken: 'old-ticket' })).error, /FEATURE_RETIRED/)
    const committed = { ...pending, requestId: 'node_committed_legacy' }
    await historicOperation(committed, 'committed')
    const replay = await executor.callTool('habit_createHabit', input, { requestId: committed.requestId, generation })
    assert.equal(replay.ok, true)
    assert.equal(replay.data.operationId, 'historic-receipt')
    const historic = await executor.callTool('listHabits', {})
    assert.equal(historic.ok, true, historic.error)
    assert.equal(historic.data.items[0].id, 'history-habit')
    assert.equal((await rows('habits')).length, 1)
  })

  await test('历史永久清理仍执行既有墓碑和删除登记协议', async () => {
    const log = local((await rows('habitLogs'))[0])
    await good('/api/workhub/commands', command([put('habitLogs', { ...log, deleted: 1, deletedAt: Date.now() })], [{ table: 'habitLogs', id: log.id, rev: log.rev }]))
    await good('/api/workhub/commands', command([{ table: 'habitLogs', id: log.id, kind: 'delete' }], [{ table: 'habitLogs', id: log.id, rev: log.rev + 1 }]))
    assert.equal((await rows('habitLogs')).length, 0)
    assert.ok((await rows('deletion_registry')).some(row => row.tableName === 'habitLogs' && row.recordId === log.id))
  })
  console.log(JSON.stringify({ passed: tests.length, tests, isolatedRoot: temp }))
} finally {
  if (pb && pb.exitCode === null) { pb.kill('SIGTERM'); await once(pb, 'exit') }
}

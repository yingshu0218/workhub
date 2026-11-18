/** Real PocketBase 0.40.2 owner/Agent operation cancellation boundary checks. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(process.env.WORKHUB_ROOT || '.')
const bin = process.env.PB_BIN
if (!bin) throw new Error('PB_BIN 必须指向锁定的 PocketBase 0.40.2')
const version = spawnSync(bin, ['--version'], { encoding: 'utf8' })
assert.equal(version.status, 0, version.stderr)
assert.match(version.stdout, /0\.40\.2/)

const outputRoot = resolve(process.env.WORKHUB_TEST_TMP || tmpdir())
mkdirSync(outputRoot, { recursive: true })
const temp = mkdtempSync(join(outputRoot, 'pb-cancel-boundary-'))
const data = join(temp, 'data')
const hooks = join(temp, 'hooks')
const migrations = join(root, 'pb_setup/pb_migrations')
mkdirSync(hooks)
cpSync(join(root, 'pb_setup/pb_hooks'), hooks, { recursive: true })
writeFileSync(
  join(hooks, 'fixture-expire-pending.pb.js'),
  `routerAdd('POST','/api/test/expire-pending',e=>{require(__hooks+'/personal.js').cleanupPending();return e.json(200,{ok:true})},$apis.requireSuperuserAuth())`,
)

const portProbe = createServer()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const port = portProbe.address().port
await new Promise((resolveClose) => portProbe.close(resolveClose))
const base = `http://127.0.0.1:${port}`
const logPath = join(temp, 'pb.log')
const logFd = openSync(logPath, 'a')
const email = 'synthetic-owner@example.test'
const password = randomBytes(24).toString('hex')
let pb
let superToken
let ownerToken
let ownerId
let generation
const results = []

async function stop() {
  if (pb && pb.exitCode === null) {
    const exited = once(pb, 'exit')
    pb.kill('SIGTERM')
    await exited
  }
}

async function boot() {
  pb = spawn(
    bin,
    ['serve', '--http', `127.0.0.1:${port}`, '--dir', data, '--hooksDir', hooks, '--migrationsDir', migrations],
    { stdio: ['ignore', logFd, logFd] },
  )
  for (let i = 0; i < 200; i++) {
    if (pb.exitCode !== null) throw new Error(`PB 启动失败，日志：${logPath}`)
    try {
      if ((await fetch(`${base}/api/health`)).ok) return
    } catch {}
    await delay(50)
  }
  throw new Error(`PB 启动超时，日志：${logPath}`)
}

async function api(path, body, options = {}) {
  const method = options.method || (body === undefined ? 'GET' : 'POST')
  const headers = { ...(options.auth ? { Authorization: options.auth } : {}) }
  if (options.agentKey !== undefined) headers['X-Workhub-Agent-Key'] = options.agentKey
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  Object.assign(headers, options.headers || {})
  const response = await fetch(base + path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

function requireOk(response, label) {
  assert.equal(response.status, 200, `${label}: ${JSON.stringify(response.body)}`)
  return response.body
}

async function records(table) {
  const response = requireOk(
    await api(`/api/collections/${table}/records?perPage=500`, undefined, { auth: superToken, method: 'GET' }),
    `读取 ${table}`,
  )
  return response.items
}

async function findOperation(requestId) {
  const row = (await records('operations')).find((item) => item.requestId === requestId)
  assert.ok(row, `缺少操作 ${requestId}`)
  return row
}

async function sequence() {
  const row = (await records('command_state'))[0]
  assert.ok(row)
  return Number(row.sequence)
}

async function test(name, run) {
  await run()
  results.push(name)
  console.log('PASS', name)
}

const context = (actor) => ({ auth: ownerToken, ...(actor.key ? { agentKey: actor.key } : {}) })
async function personalQuery(actor, name, input) {
  return api('/api/workhub/personal/query', { name, input }, context(actor))
}
async function preview(actor, requestId, title) {
  const response = requireOk(
    await api(
      '/api/workhub/personal/preview',
      {
        requestId,
        generation,
        kind: 'capture',
        clientId: 'forged-owner-client',
        input: {
          activities: [
            {
              key: `event-${requestId}`,
              title,
              summary: title,
              occurredAt: '2026-11-17',
              timePrecision: 'date',
            },
          ],
        },
      },
      context(actor),
    ),
    `预览 ${requestId}`,
  )
  assert.equal(response.preview, true)
  return response
}
async function cancel(actor, requestId, cancelGeneration = generation, extras = {}) {
  return api(
    '/api/workhub/personal/cancel',
    { requestId, generation: cancelGeneration, ...extras },
    context(actor),
  )
}
async function getOperation(actor, operationId) {
  return personalQuery(actor, 'get_operation', { operationId, generation })
}
async function commit(actor, previewResult) {
  return api(
    '/api/workhub/personal/commit',
    { requestId: previewResult.requestId, previewId: previewResult.previewId, generation },
    { ...context(actor), headers: { 'X-Workhub-Plan': previewResult.planFingerprint } },
  )
}
function code(response) {
  return response.body?.code || response.body?.error?.split(':')[0]
}
const newRequestId = (prefix) => `${prefix}-${randomBytes(8).toString('hex')}`
const agentCapabilities = ['activity:read', 'activity:write', 'operation:read', 'operation:write']

try {
  const upsert = spawnSync(
    bin,
    ['superuser', 'upsert', email, password, '--dir', data, '--migrationsDir', migrations],
    { encoding: 'utf8' },
  )
  assert.equal(upsert.status, 0, upsert.stderr)
  await boot()
  superToken = requireOk(
    await api('/api/collections/_superusers/auth-with-password', { identity: email, password }),
    '隔离库 superuser 登录',
  ).token
  requireOk(
    await api('/api/workhub/initialize', { email: 'owner@workhub.local', identity: 'owner', password }, { auth: superToken }),
    '初始化合成拥有者',
  )
  ownerToken = requireOk(
    await api('/api/collections/users/auth-with-password', { identity: 'owner@workhub.local', password }),
    '拥有者登录',
  ).token
  const state = requireOk(await api('/api/workhub/state', undefined, { auth: ownerToken, method: 'GET' }), '读取状态')
  generation = state.generation
  ownerId = (await records('users')).find((row) => row.email === 'owner@workhub.local')?.id
  assert.ok(ownerId)

  const issueAgent = async (name) =>
    requireOk(
      await api('/api/workhub/agents', { action: 'issue', name, capabilities: agentCapabilities }, { auth: ownerToken }),
      `签发 ${name}`,
    )
  const agentARecord = await issueAgent('synthetic Agent A')
  const agentBRecord = await issueAgent('synthetic Agent B')
  const actors = [
    { name: 'owner', clientId: 'owner' },
    { name: 'A', clientId: agentARecord.id, key: agentARecord.token },
    { name: 'B', clientId: agentBRecord.id, key: agentBRecord.token },
  ]

  await test('B1 真实拥有者/A/B 凭据的 3×3 原端撤回矩阵、列表与详情一致', async () => {
    const pending = []
    for (const actor of actors) {
      const requestId = newRequestId(`matrix-${actor.name}`)
      const previewResult = await preview(actor, requestId, `撤回矩阵 ${actor.name}`)
      const row = await findOperation(requestId)
      assert.equal(row.clientId || '', actor.clientId)
      pending.push({ actor, requestId, previewResult, row })
    }

    const ownerList = requireOk(
      await personalQuery(actors[0], 'list_operations', { generation, status: 'awaiting_confirmation', limit: 50 }),
      '拥有者待确认列表',
    )
    for (const entry of pending) {
      const listRow = ownerList.items.find((item) => item.id === entry.row.id)
      assert.ok(listRow, `列表缺少 ${entry.actor.name}`)
      assert.equal(listRow.canCancel, entry.actor.clientId === 'owner')

      const ownerDetail = requireOk(await getOperation(actors[0], entry.row.id), `拥有者详情 ${entry.actor.name}`)
      assert.equal(ownerDetail.items[0].canCancel, entry.actor.clientId === 'owner')
      const originDetail = requireOk(await getOperation(entry.actor, entry.row.id), `原端详情 ${entry.actor.name}`)
      assert.equal(originDetail.items[0].canCancel, true)
    }

    const sequenceBefore = await sequence()
    const activityCountBefore = (await records('activities')).length
    const effectsCountBefore = (await records('operation_effects')).length
    for (const entry of pending) {
      for (const actor of actors.filter((candidate) => candidate.clientId !== entry.actor.clientId)) {
        const response = await cancel(actor, entry.requestId, generation, { clientId: entry.actor.clientId })
        assert.equal(response.status, 403, `${actor.name} 越权撤回 ${entry.actor.name}: ${JSON.stringify(response.body)}`)
        assert.equal(code(response), 'FORBIDDEN')
        const unchanged = await findOperation(entry.requestId)
        assert.equal(unchanged.status, 'awaiting_confirmation')
        assert.ok(unchanged.plan)
      }
    }
    assert.equal(await sequence(), sequenceBefore)
    assert.equal((await records('activities')).length, activityCountBefore)
    assert.equal((await records('operation_effects')).length, effectsCountBefore)

    for (const entry of pending) {
      const response = await cancel(entry.actor, entry.requestId)
      requireOk(response, `原端撤回 ${entry.actor.name}`)
      assert.equal(response.body.status, 'cancelled')
      assert.equal(response.body.replayed, false)
      const after = await findOperation(entry.requestId)
      assert.equal(after.status, 'cancelled')
      assert.equal(after.plan, null)

      const beforeReplay = await sequence()
      const replay = requireOk(await cancel(entry.actor, entry.requestId), `原端幂等重试 ${entry.actor.name}`)
      assert.equal(replay.replayed, true)
      assert.equal(await sequence(), beforeReplay)
      const detail = requireOk(await getOperation(actors[0], entry.row.id), `取消后详情 ${entry.actor.name}`)
      assert.equal(detail.items[0].canCancel, false)
      assert.equal(detail.items[0].status, 'cancelled')
    }
    assert.equal((await records('activities')).length, activityCountBefore)
    assert.equal((await records('operation_effects')).length, effectsCountBefore)

    const deniedForeignDetails = await getOperation(actors[1], pending[2].row.id)
    assert.equal(deniedForeignDetails.status, 403)
    const replayPreview = await api(
      '/api/workhub/personal/preview',
      {
        requestId: pending[0].requestId,
        generation,
        kind: 'capture',
        input: {
          activities: [
            {
              key: `event-${pending[0].requestId}`,
              title: `撤回矩阵 ${pending[0].actor.name}`,
              summary: `撤回矩阵 ${pending[0].actor.name}`,
              occurredAt: '2026-11-17',
              timePrecision: 'date',
            },
          ],
        },
      },
      context(pending[0].actor),
    )
    assert.equal(code(replayPreview), 'CANCELLED')
  })

  await test('B2 无效/缺失凭据、伪造 clientId、错误世代、猜测 operationId 均拒绝', async () => {
    const requestId = newRequestId('boundary-owner')
    const p = await preview(actors[0], requestId, '边界验证待撤回')
    const beforeInvalid = await findOperation(requestId)
    const sequenceBeforeInvalid = await sequence()
    const noAuth = await api('/api/workhub/personal/cancel', { requestId, generation })
    assert.equal(noAuth.status, 401)
    const invalidAgent = await api('/api/workhub/personal/cancel', { requestId, generation }, { auth: ownerToken, agentKey: 'invalid-agent-key' })
    assert.equal(invalidAgent.status, 401)
    const afterInvalid = await findOperation(requestId)
    assert.equal(afterInvalid.status, beforeInvalid.status)
    assert.deepEqual(afterInvalid.plan, beforeInvalid.plan)
    assert.equal(await sequence(), sequenceBeforeInvalid)

    const forged = await cancel(actors[0], requestId, generation, { clientId: agentARecord.id })
    requireOk(forged, '拥有者本人预览忽略伪造 clientId')
    assert.equal(forged.body.status, 'cancelled')

    const staleRequestId = newRequestId('old-generation')
    await preview(actors[0], staleRequestId, '错误世代不可撤回')
    const sequenceBeforeStale = await sequence()
    const stale = await cancel(actors[0], staleRequestId, 'old-generation')
    assert.equal(stale.status, 409)
    assert.equal(code(stale), 'RECOVERY_REVIEW_REQUIRED')
    assert.equal((await findOperation(staleRequestId)).status, 'awaiting_confirmation')
    assert.equal(await sequence(), sequenceBeforeStale)
    requireOk(await cancel(actors[0], staleRequestId), '清理错误世代夹具')

    const guessed = await cancel(actors[0], p.previewId, generation)
    assert.equal(guessed.status, 400)
    assert.equal(code(guessed), 'NOT_FOUND')
    const missing = await cancel(actors[0], newRequestId('not-found'), generation)
    assert.equal(missing.status, 400)
    assert.equal(code(missing), 'NOT_FOUND')
  })

  await test('B3 缺失 clientId 历史映射为不可撤回，拥有者仍可查看但不能猜作原端', async () => {
    const requestId = newRequestId('legacy-no-client')
    const seeded = requireOk(
      await api(
        '/api/collections/operations/records',
        {
          owner: ownerId,
          requestId,
          generation,
          status: 'awaiting_confirmation',
          kind: 'capture',
          updatedAt: Date.now(),
          plan: { synthetic: true },
        },
        { auth: superToken },
      ),
      '创建缺失 clientId 的隔离历史行',
    )
    const detail = requireOk(await getOperation(actors[0], seeded.id), '拥有者读取未绑定发起端的历史')
    assert.equal(detail.items[0].canCancel, false)
    const result = await cancel(actors[0], requestId)
    assert.equal(result.status, 403)
    assert.equal(code(result), 'FORBIDDEN')
    assert.equal((await findOperation(requestId)).status, 'awaiting_confirmation')
  })

  await test('B4 撤销 Agent 凭据后，其待确认预览不能被 Agent 或拥有者代撤回', async () => {
    const requestId = newRequestId('revoked-agent')
    await preview(actors[1], requestId, '撤销凭据后保留待确认状态')
    requireOk(
      await api('/api/workhub/agents', { action: 'revoke', id: agentARecord.id }, { auth: ownerToken }),
      '撤销 Agent A',
    )
    const revoked = await cancel(actors[1], requestId)
    assert.equal(revoked.status, 401)
    assert.equal((await findOperation(requestId)).status, 'awaiting_confirmation')
    const ownerAttempt = await cancel(actors[0], requestId, generation, { clientId: agentARecord.id })
    assert.equal(ownerAttempt.status, 403)
    assert.equal((await findOperation(requestId)).status, 'awaiting_confirmation')
  })

  await test('B5 已过期操作返回明确状态，已提交操作拒绝伪装撤回并保留原回执', async () => {
    const expiredRequestId = newRequestId('expired')
    const expiredSeed = requireOk(
      await api(
        '/api/collections/operations/records',
        {
          owner: ownerId,
          clientId: agentBRecord.id,
          requestId: expiredRequestId,
          generation,
          status: 'awaiting_confirmation',
          kind: 'capture',
          updatedAt: Date.now() - 8 * 86400000,
          plan: { synthetic: true },
        },
        { auth: superToken },
      ),
      '创建待过期操作',
    )
    requireOk(await api('/api/test/expire-pending', {}, { auth: superToken }), '运行隔离库过期清理')
    const expiredStored = await findOperation(expiredRequestId)
    assert.equal(expiredStored.status, 'cancelled')
    assert.equal(expiredStored.plan, null)
    const expiredView = requireOk(await getOperation(actors[0], expiredSeed.id), '读取过期详情')
    assert.equal(expiredView.items[0].status, 'expired')
    assert.equal(expiredView.items[0].canCancel, false)
    const expiredList = requireOk(
      await personalQuery(actors[0], 'list_operations', { generation, status: 'expired', limit: 50 }),
      '读取过期操作列表',
    )
    assert.ok(expiredList.items.some((item) => item.id === expiredSeed.id && item.status === 'expired' && !item.canCancel))
    const sequenceBeforeExpiredRetry = await sequence()
    const expiredRetry = await cancel(actors[2], expiredRequestId)
    assert.equal(expiredRetry.status, 409)
    assert.equal(code(expiredRetry), 'PREVIEW_EXPIRED')
    assert.equal(await sequence(), sequenceBeforeExpiredRetry)

    const committedRequestId = newRequestId('already-committed')
    const committedPreview = await preview(actors[0], committedRequestId, '不可被 cancel 的已提交记录')
    const committedReceipt = requireOk(await commit(actors[0], committedPreview), '提交待验证操作')
    const sequenceBeforeCommittedCancel = await sequence()
    const cancelCommitted = await cancel(actors[0], committedRequestId)
    assert.equal(cancelCommitted.status, 400)
    assert.equal(code(cancelCommitted), 'ALREADY_COMMITTED')
    assert.equal(await sequence(), sequenceBeforeCommittedCancel)
    const committedRow = await findOperation(committedRequestId)
    assert.equal(committedRow.status, 'committed')
    const receiptBeforeRetry = JSON.stringify(committedRow.result)
    const effectsBeforeRetry = (await records('operation_effects')).filter((row) => row.operationId === committedRow.id).length
    assert.equal(effectsBeforeRetry, 1)
    const retry = requireOk(await commit(actors[0], committedPreview), '提交回执幂等重试')
    assert.equal(retry.operationId, committedReceipt.operationId)
    assert.equal(JSON.stringify((await findOperation(committedRequestId)).result), receiptBeforeRetry)
    assert.equal((await records('operation_effects')).filter((row) => row.operationId === committedRow.id).length, effectsBeforeRetry)
    const committedDetail = requireOk(await getOperation(actors[0], committedRow.id), '读取已提交回执')
    assert.equal(committedDetail.items[0].status, 'committed')
    assert.equal(committedDetail.items[0].canCancel, false)
    assert.equal(committedDetail.items[0].receipt.operationId, committedRow.id)
  })

  await test('B6 cancel/commit 并发只有一个终态，effects、业务记录与回执同终态', async () => {
    const observed = { cancelled: 0, committed: 0 }
    for (let i = 0; i < 6; i++) {
      const requestId = newRequestId(`race-${i}`)
      const title = `并发撤回与提交 ${i}`
      const p = await preview(actors[0], requestId, title)
      const requests =
        i % 2 === 0
          ? [cancel(actors[0], requestId), commit(actors[0], p)]
          : [commit(actors[0], p), cancel(actors[0], requestId)]
      const replies = await Promise.all(requests)
      const [cancelResult, commitResult] = i % 2 === 0 ? replies : [replies[1], replies[0]]
      const row = await findOperation(requestId)
      const effects = (await records('operation_effects')).filter((effect) => effect.operationId === row.id)
      const activity = (await records('activities')).find((item) => item.title === title)
      if (row.status === 'cancelled') {
        observed.cancelled++
        assert.equal(cancelResult.status, 200)
        assert.equal(cancelResult.body.replayed, false)
        assert.equal(commitResult.status, 400)
        assert.equal(code(commitResult), 'CANCELLED')
        assert.equal(row.plan, null)
        assert.equal(effects.length, 0)
        assert.equal(activity, undefined)
        const sequenceBeforeRetry = await sequence()
        const retry = await commit(actors[0], p)
        assert.equal(retry.status, 400)
        assert.equal(code(retry), 'CANCELLED')
        assert.equal(await sequence(), sequenceBeforeRetry)
      } else {
        observed.committed++
        assert.equal(row.status, 'committed')
        assert.equal(commitResult.status, 200)
        assert.equal(commitResult.body.operationId, row.id)
        assert.equal(cancelResult.status, 400)
        assert.equal(code(cancelResult), 'ALREADY_COMMITTED')
        assert.equal(effects.length, 1)
        assert.equal(activity?.title, title)
        const retry = requireOk(await commit(actors[0], p), '并发提交回执重试')
        assert.equal(retry.operationId, row.id)
        assert.equal((await records('operation_effects')).filter((effect) => effect.operationId === row.id).length, 1)
      }
      const detail = requireOk(await getOperation(actors[0], row.id), `并发最终详情 ${i}`)
      assert.equal(detail.items[0].status, row.status)
      assert.equal(detail.items[0].canCancel, false)
    }
    assert.equal(observed.cancelled + observed.committed, 6)
    assert.ok(observed.cancelled > 0)
    assert.ok(observed.committed > 0)
    console.log('RACE_OUTCOMES', JSON.stringify(observed))
  })

  console.log(JSON.stringify({ pocketbase: version.stdout.trim(), passed: results.length, tests: results, temp, logPath }, null, 2))
} finally {
  await stop()
}

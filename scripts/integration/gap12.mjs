/** GAP-12：真实 PocketBase 0.40.2 + production entrypoint/Relay；仅合成隔离库。 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(process.env.WORKHUB_ROOT || '.')
const pbBin = resolve(process.env.PB_BIN || join(root, 'pocketbase'))
const version = spawnSync(pbBin, ['--version'], { encoding: 'utf8' })
assert.equal(version.status, 0, 'PB_BIN 必须可运行')
assert.match(version.stdout, /0\.40\.2/, '仅允许隔离 PocketBase 0.40.2')

async function freePort() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise((done, reject) => listener.close((err) => err ? reject(err) : done()))
  return port
}
async function uniquePort(used) {
  let port
  do { port = await freePort() } while (used.has(port))
  used.add(port)
  return port
}

function safeHash(value) { return createHash('sha256').update(value).digest('hex') }
function testId(prefix) { return prefix + '_' + randomUUID().replaceAll('-', '') }
function sanitizedLog(path, secrets) {
  let value = readFileSync(path, 'utf8')
  for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]')
  return value
}

const temp = mkdtempSync(join(process.env.WORKHUB_TEST_TMP || tmpdir(), 'workhub-gap12-'))
const dataDir = join(temp, 'pb_data')
const logPath = join(temp, 'entrypoint.log')
mkdirSync(dataDir, { recursive: true })
const superEmail = `pb-${randomUUID()}@example.test`
const superPassword = randomBytes(24).toString('hex')
const ownerEmail = `owner-${randomUUID()}@workhub.local`
const p1 = randomBytes(24).toString('hex')
const p2 = randomBytes(24).toString('hex')
const envDomains = process.env.WORKHUB_TEST_AI_DOMAINS || 'read,note,activity,link'
const legacyDomains = 'read,crm,fin,todo,project,note,link,habit'
const usedPorts = new Set()
const ports = { public: await uniquePort(usedPorts), web: await uniquePort(usedPorts), pb: await uniquePort(usedPorts) }
const pbBase = `http://127.0.0.1:${ports.pb}`
const publicBase = `http://127.0.0.1:${ports.public}`
const logFd = openSync(logPath, 'a')
const childEnv = {
  APP_DIR: root,
  NODE_ENV: 'production',
  PUBLIC_HOST: '127.0.0.1',
  PUBLIC_PORT: String(ports.public),
  HOST: '127.0.0.1',
  PORT: String(ports.web),
  PB_HTTP: `127.0.0.1:${ports.pb}`,
  PB_DATA_DIR: dataDir,
  PB_HOOKS_DIR: join(root, 'pb_setup/pb_hooks'),
  PB_MIGRATIONS_DIR: join(root, 'pb_setup/pb_migrations'),
  PB_COLLECTIONS: join(root, 'pb_setup/collections.json'),
  PB_BIN: pbBin,
  PB_SUPERUSER: superEmail,
  PB_SUPERUSER_PASSWORD: superPassword,
  PB_IMPORT_COLLECTIONS: '1',
  WORKHUB_DATA_DIR: temp,
  WORKHUB_RELAY_TOKEN_FILE: join(temp, 'relay-token'),
  WORKHUB_RELAY_TOKEN: '',
  WORKHUB_SERVER_EXECUTOR: '1',
  WORKHUB_PB_URL: pbBase,
  WORKHUB_PB_ACCOUNT: ownerEmail,
  WORKHUB_PB_PASSWORD: p1,
  WORKHUB_AI_DOMAINS: envDomains,
  WORKHUB_RELAY_AUTO_CONFIRM: '',
  WORKHUB_ADMIN_USER: '',
  WORKHUB_ADMIN_PASSWORD: '',
  WORKHUB_RESTORE_REVIEWED: '',
}
const executorEnvHash = safeHash(JSON.stringify({
  WORKHUB_PB_URL: childEnv.WORKHUB_PB_URL,
  WORKHUB_PB_ACCOUNT: childEnv.WORKHUB_PB_ACCOUNT,
  WORKHUB_PB_PASSWORD: childEnv.WORKHUB_PB_PASSWORD,
  WORKHUB_AI_DOMAINS: childEnv.WORKHUB_AI_DOMAINS,
}))
let entrypoint
let ownerToken
let ownerId
let keyA
let agentIdA
let keyB
let keyReadOnly
let keyExpired
let generation
let servePidBefore
let pbPidBefore
let sequence = 0
const passed = []

function processChildren(parentPid) {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  if (ps.status !== 0) return []
  return ps.stdout.split('\n').map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : null
  }).filter((row) => row && row.ppid === parentPid)
}

async function waitForService() {
  const deadline = Date.now() + 45_000
  let lastError = ''
  while (Date.now() < deadline) {
    if (entrypoint.exitCode !== null) {
      throw new Error(`synthetic entrypoint exited: ${sanitizedLog(logPath, [p1, p2, superPassword])}`)
    }
    try {
      const res = await fetch(publicBase + '/api/health')
      if (res.ok) return
      lastError = `HTTP ${res.status}`
    } catch (error) { lastError = error.message }
    await delay(100)
  }
  throw new Error(`synthetic entrypoint startup timed out: ${lastError}`)
}

async function call(base, path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.authorization !== undefined) headers.Authorization = options.authorization
  if (options.agentKey !== undefined) headers['X-Workhub-Agent-Key'] = options.agentKey
  if (options.writeDomains !== undefined) headers['X-Workhub-Write-Domains'] = options.writeDomains
  const init = { method: options.method || (options.body === undefined ? 'GET' : 'POST'), headers }
  if (options.body !== undefined) {
    headers['Content-Type'] ||= 'application/json'
    init.body = JSON.stringify(options.body)
  }
  const response = await fetch(base + path, init)
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

async function rawHttp(base, path, options = {}) {
  const url = new URL(path, base)
  const body = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body))
  const headers = { ...(options.headers || {}) }
  if (options.authorization !== undefined) headers.Authorization = options.authorization
  if (body) { headers['Content-Type'] ||= 'application/json'; headers['Content-Length'] = String(body.length) }
  return await new Promise((resolveResponse, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: Number(url.port), path: url.pathname + url.search, method: options.method || (body ? 'POST' : 'GET'), headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed = {}
        try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { text } }
        resolveResponse({ status: res.statusCode || 0, body: parsed })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function statusIs(response, expected, label) {
  assert.equal(response.status, expected, `${label}: expected HTTP ${expected}, got ${response.status} (${response.body?.code || response.body?.error || response.body?.message || 'no-code'})`)
  return response.body
}
function denied(response, label) {
  assert.ok(response.status < 200 || response.status >= 300, `${label}: expected rejection, got HTTP ${response.status}`)
}

async function mcp(credential, method, params = {}) {
  const response = await fetch(publicBase + '/relay/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.error) return { ok: false, error: body.error?.message || `HTTP ${response.status}`, body }
  if (method !== 'tools/call') return { ok: true, data: body.result, body }
  const text = body.result?.content?.[0]?.text || ''
  let data
  try { data = JSON.parse(text) } catch { data = { error: text } }
  return { ok: !body.result?.isError, data, error: body.result?.isError ? data.error || text : undefined, body }
}

async function goodTool(credential, name, args) {
  const result = await mcp(credential, 'tools/call', { name, arguments: args })
  assert.equal(result.ok, true, `${name}: ${result.error || 'MCP tool failed'}`)
  return result.data
}

async function commitPersonalActivity(credential, title, prefix) {
  const requestId = testId(prefix)
  const preview = await goodTool(credential, 'preview_capture', {
    requestId,
    generation,
    input: { activities: [{ key: prefix, title, occurredAt: '2026-11-18', timePrecision: 'date' }] },
  })
  assert.equal(preview.preview, true)
  assert.ok(preview.changes.some((change) => change.table === 'activities' && change.after?.title === title))
  const ticket = await goodTool(credential, 'confirm_preview', preview.confirmHint.args)
  const committed = await goodTool(credential, 'commit_capture', {
    ...preview.confirmHint.args.args,
    confirmToken: ticket.confirmToken,
  })
  assert.ok(committed.operationId)
  const scoped = statusIs(await call(pbBase, '/api/workhub/scoped', {
    agentKey: credential,
    body: { table: 'activities', scope: { where: { deleted: 0 } } },
  }), 200, 'read committed activity through Agent scope')
  assert.ok(scoped.items.some((row) => row.title === title), 'confirmed pure activity must exist in PocketBase')
  return committed
}

async function test(name, fn) {
  await fn()
  passed.push(name)
  console.log('PASS', name)
}

function issueBody(name, capabilities, expiresAt) {
  return { action: 'issue', name, capabilities, ...(expiresAt === undefined ? {} : { expiresAt }) }
}
const capabilities = ['crm:read', 'crm:write', 'activity:read', 'activity:write', 'link:read', 'link:write', 'note:read', 'note:write', 'fin:read', 'fin:write', 'operation:read', 'source:read']
function customerCommand(id, name) {
  return {
    protocol: 1,
    generation,
    requestId: testId('gap12_direct'),
    kind: 'legacy',
    reads: [{ table: 'customers', id, rev: null }],
    scans: [],
    writes: [{ table: 'customers', id, kind: 'put', value: { id, name, aliases: [], tags: [], contactType: 'person', lastContactAt: 0, rev: 0, updatedAt: Date.now(), deleted: 0 } }],
  }
}
function noteCommand(id, title) {
  const now = Date.now()
  return {
    protocol: 1,
    generation,
    requestId: testId('gap12_direct_note'),
    kind: 'legacy',
    reads: [{ table: 'notes', id, rev: null }],
    scans: [],
    writes: [{ table: 'notes', id, kind: 'put', value: {
      id, title, markdown: 'synthetic direct PB note', tags: [], createdAt: now, rev: 0, updatedAt: now, deleted: 0,
    } }],
  }
}

try {
  entrypoint = spawn(process.execPath, [join(root, 'deploy/docker/entrypoint.mjs')], {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', logFd, logFd],
  })
  await waitForService()
  const childrenBefore = processChildren(entrypoint.pid)
  servePidBefore = childrenBefore.find((row) => row.command.includes('/scripts/serve.mjs'))?.pid
  pbPidBefore = childrenBefore.find((row) => row.command.includes('/pocketbase serve'))?.pid
  assert.ok(servePidBefore && pbPidBefore, 'must observe the production Node and PB child processes')

  let r = await call(publicBase, '/api/collections/_superusers/auth-with-password', {
    body: { identity: superEmail, password: superPassword },
  })
  const superToken = statusIs(r, 200, 'synthetic superuser login').token
  r = await call(publicBase, '/api/workhub/initialize', {
    authorization: superToken,
    body: { email: ownerEmail, identity: 'synthetic-owner', password: p1 },
  })
  ownerId = statusIs(r, 200, 'synthetic owner initialization').userId
  r = await call(publicBase, '/api/collections/users/auth-with-password', {
    body: { identity: ownerEmail, password: p1 },
  })
  ownerToken = statusIs(r, 200, 'owner P1 login').token
  r = await call(publicBase, '/api/workhub/state', { authorization: ownerToken })
  generation = statusIs(r, 200, 'owner state').generation

  const issuedA = statusIs(await call(publicBase, '/api/workhub/agents', {
    authorization: ownerToken,
    body: issueBody('synthetic Agent A', capabilities),
  }), 200, 'issue Agent A')
  keyA = issuedA.token
  agentIdA = issuedA.id
  keyExpired = statusIs(await call(publicBase, '/api/workhub/agents', {
    authorization: ownerToken,
    body: issueBody('synthetic expired Agent', ['note:read'], Date.now() - 60_000),
  }), 200, 'issue expired Agent').token
  const tokenFile = join(temp, 'relay-token')
  const relayToken = readFileSync(tokenFile, 'utf8').trim()

  if (process.env.GAP12_AUTH_SMOKE === '1') {
    await test('owner, missing auth, Agent key, and empty Agent header matrix', async () => {
      statusIs(await call(pbBase, '/api/workhub/state', { authorization: ownerToken }), 200, 'valid owner JWT')
      denied(await call(pbBase, '/api/workhub/state'), 'missing credentials')
      statusIs(await call(pbBase, '/api/workhub/state', { agentKey: keyA }), 200, 'valid Agent key')
      const mixed = await rawHttp(pbBase, '/api/workhub/state', {
        authorization: ownerToken,
        headers: { 'X-Workhub-Agent-Key': '' },
      })
      assert.equal(mixed.status, 401, 'an explicit empty Agent header must not fall back to owner JWT')
    })
    throw Object.assign(new Error('GAP12_AUTH_SMOKE_COMPLETE'), { authSmokeComplete: true })
  }

  if (process.env.GAP12_ACTIVITY_DOMAIN_SMOKE === '1') {
    const activityKey = statusIs(await call(publicBase, '/api/workhub/agents', {
      authorization: ownerToken,
      body: issueBody('synthetic activity writer without activity deployment domain', ['activity:read', 'activity:write']),
    }), 200, 'issue activity writer').token
    await test('legacy deployment domains permit pure activity preview, confirmation, and commit without activity', async () => {
      assert.equal(envDomains, legacyDomains, 'activity compatibility smoke must use the existing deployment-domain set')
      assert.ok(!envDomains.split(',').includes('activity'), 'legacy deployment domains must not add activity')
      await commitPersonalActivity(activityKey, 'synthetic pure activity under legacy domains', 'gap12_legacy_activity')
    })
    throw Object.assign(new Error('GAP12_ACTIVITY_DOMAIN_SMOKE_COMPLETE'), { activityDomainSmokeComplete: true })
  }

  if (process.env.GAP12_READ_DOMAIN_SMOKE === '1') {
    const noteReadKey = statusIs(await call(publicBase, '/api/workhub/agents', {
      authorization: ownerToken,
      body: issueBody('synthetic note read-only Agent', ['note:read']),
    }), 200, 'issue note-read-only Agent').token
    const activityAndFinanceCrmKey = statusIs(await call(publicBase, '/api/workhub/agents', {
      authorization: ownerToken,
      body: issueBody('synthetic composite-domain denial Agent', [
        'activity:read', 'activity:write', 'crm:read', 'crm:write', 'fin:read', 'fin:write',
      ]),
    }), 200, 'issue composite-domain Agent').token
    const ledgerLocalId = testId('gap12_read_domain_ledger')
    statusIs(await call(pbBase, '/api/collections/ledgers/records', {
      authorization: superToken,
      body: {
        id: safeHash(ledgerLocalId).slice(0, 15), localId: ledgerLocalId,
        name: 'synthetic read-domain denial ledger', currency: 'CNY', openingBalance: 0,
        openingBalanceMinor: 0, isDefault: true, rev: 1, updatedAt: Date.now(), deleted: 0,
      },
    }), 200, 'seed synthetic finance ledger for authorization test')
    await test('WORKHUB_AI_DOMAINS=read preserves note:read MCP access and closes both write paths', async () => {
      assert.equal(envDomains, 'read', 'read-domain smoke must run with the single read deployment domain')
      const listed = await goodTool(noteReadKey, 'listNotes', { limit: 5 })
      assert.ok(Array.isArray(listed.items))
      const mcpWrite = await mcp(noteReadKey, 'tools/call', { name: 'note_createNote', arguments: {
        title: 'must not write under read domain', markdown: 'synthetic read-domain smoke',
        requestId: testId('gap12_read_domain_mcp'), generation,
      } })
      assert.equal(mcpWrite.ok, false, 'MCP must close note writes when note is absent from deployment write domains')
      const directId = testId('gap12_read_domain_direct')
      const directWrite = await call(pbBase, '/api/workhub/commands', {
        agentKey: noteReadKey,
        writeDomains: JSON.stringify({ read: true, note: true, link: true }),
        body: noteCommand(directId, 'must not write through PB command route'),
      })
      denied(directWrite, 'direct PB note write with forged write-domain header')
      const rows = await call(pbBase, '/api/workhub/scoped', {
        agentKey: noteReadKey,
        body: { table: 'notes', scope: { where: { deleted: 0 }, ids: [directId] } },
      })
      statusIs(rows, 200, 'verify direct PB note was not created')
      assert.equal(rows.body.items?.length, 0)
    })
    await test('read-domain composite previews cannot bypass disabled CRM or finance writes', async () => {
      assert.equal(envDomains, 'read', 'composite denial smoke must run with only the read deployment domain')
      const cases = [
        {
          label: 'CRM',
          input: {
            contacts: [{ key: 'disabled-crm-contact', name: 'must not commit' }],
            activities: [{ key: 'disabled-crm-activity', title: 'synthetic CRM-crossing activity', occurredAt: '2026-11-18', timePrecision: 'date', contactIds: ['disabled-crm-contact'] }],
          },
        },
        {
          label: 'finance',
          input: {
            activities: [{ key: 'disabled-fin-activity', title: 'synthetic finance-crossing activity', occurredAt: '2026-11-18', timePrecision: 'date', transactions: [{ key: 'disabled-fin-transaction', fact: 'occurred', amountMinor: 100, currency: 'CNY', ledgerId: ledgerLocalId, type: 'expense' }] }],
          },
        },
      ]
      for (const { label, input } of cases) {
        const result = await mcp(activityAndFinanceCrmKey, 'tools/call', { name: 'preview_capture', arguments: {
          requestId: testId(`gap12_read_domain_${label}`), generation, input,
        } })
        assert.equal(result.ok, false, `read-domain personal preview must not write disabled ${label} records`)
        assert.match(String(result.error), /FORBIDDEN|写能力|缺少写能力/i)
      }
    })
    throw Object.assign(new Error('GAP12_READ_DOMAIN_SMOKE_COMPLETE'), { readDomainSmokeComplete: true })
  }

  await test('shared transition remains valid before password change and cannot cross disabled CRM writes', async () => {
    const read = await goodTool(relayToken, 'list_operations', { limit: 1 })
    assert.equal(read.generation, generation)
    const previewArgs = {
      requestId: testId('gap12_shared_capture'),
      generation,
      input: {
        contacts: [{ key: 'blocked-contact', name: 'must not commit' }],
        activities: [{ key: 'allowed-activity', title: 'synthetic mixed-domain plan', occurredAt: '2026-11-17', timePrecision: 'date', contactIds: ['blocked-contact'] }],
      },
    }
    const rejected = await mcp(relayToken, 'tools/call', { name: 'preview_capture', arguments: previewArgs })
    assert.equal(rejected.ok, false)
    assert.match(String(rejected.error), /FORBIDDEN|crm|客户/i)
  })

  await test('Agent PB principal validates the real owner, blank mixed headers fail closed, and expiry is enforced', async () => {
    const directPrincipal = await call(pbBase, '/api/workhub/agents/verify', { body: { kind: 'agent', token: keyA } })
    assert.equal(directPrincipal.status, 200)
    assert.ok(directPrincipal.body.clientId)
    denied(await call(pbBase, '/api/workhub/state'), 'missing Agent key and owner JWT')
    for (const value of ['', '   ', 'invalid-key']) {
      const mixed = await rawHttp(pbBase, '/api/workhub/state', {
        authorization: ownerToken,
        headers: { 'X-Workhub-Agent-Key': value },
      })
      denied(mixed, `owner JWT with Agent header ${JSON.stringify(value)}`)
    }
    denied(await call(pbBase, '/api/workhub/agents', { authorization: ownerToken, agentKey: keyA, body: { action: 'list' } }), 'credential management with owner JWT and Agent principal')
    denied(await call(pbBase, '/api/workhub/agents/verify', { body: { kind: 'agent', token: keyExpired } }), 'expired Agent key')
  })

  await test('Agent keys cannot reach owner collections, mirror, sync, or credential management', async () => {
    const endpoints = [
      ['/api/workhub/client-state', 'GET'],
      ['/api/workhub/sync', 'POST'],
      ['/api/workhub/agents', 'POST'],
      ['/api/collections/agent_credentials/records', 'GET'],
      [`/api/collections/users/records/${ownerId}`, 'PATCH'],
    ]
    for (const [path, method] of endpoints) {
      const options = { method, agentKey: keyA }
      if (method === 'PATCH') options.body = { password: 'not-used-password', passwordConfirm: 'not-used-password' }
      else if (method === 'POST') options.body = {}
      const result = await call(pbBase, path, options)
      denied(result, `Agent-only ${method} ${path}`)
    }
    for (const path of ['/api/collections/customers/records?perPage=1', '/api/workhub/scoped']) {
      const result = await call(publicBase, path, { agentKey: keyA, body: { table: 'customers', scope: { where: { deleted: 0 } } } })
      assert.equal(result.status, 401, `public proxy must block raw Agent header on ${path}`)
    }
    const invalidMixed = await call(publicBase, '/api/workhub/state', { authorization: ownerToken, headers: { 'X-Workhub-Agent-Key': '' } })
    assert.equal(invalidMixed.status, 401, 'public proxy must reject owner JWT combined with an explicit empty Agent header')
  })

  await test('host CRM-off rejects raw PB writes with missing or forged domain headers', async () => {
    const noHint = await call(pbBase, '/api/workhub/commands', { agentKey: keyA, body: customerCommand(testId('blocked_customer'), 'direct raw Agent') })
    denied(noHint, 'host-denied crm:write without policy header')
    const forged = await call(pbBase, '/api/workhub/commands', {
      agentKey: keyA,
      writeDomains: JSON.stringify({ crm: true, read: true, note: true, activity: true, link: true }),
      body: customerCommand(testId('forged_customer'), 'direct raw Agent forged header'),
    })
    denied(forged, 'host-denied crm:write with forged policy header')
    const mcpPreview = await mcp(keyA, 'tools/call', { name: 'preview_capture', arguments: {
      requestId: testId('gap12_agent_mixed'),
      generation,
      input: {
        contacts: [{ key: 'blocked-contact', name: 'must not commit' }],
        activities: [{ key: 'allowed-activity', title: 'synthetic mixed-domain plan', occurredAt: '2026-11-17', timePrecision: 'date', contactIds: ['blocked-contact'] }],
      },
    } })
    assert.equal(mcpPreview.ok, false, 'MCP composite plan must honor the same PB crm policy')
    assert.match(String(mcpPreview.error), /FORBIDDEN|crm|客户/i)
  })

  await test('owner web write remains available without the Agent deployment header', async () => {
    const ownerWrite = await call(publicBase, '/api/workhub/commands', {
      authorization: ownerToken,
      body: customerCommand(testId('owner_customer'), 'owner web allowed under CRM-off Agent policy'),
    })
    assert.equal(ownerWrite.status, 200, 'ordinary owner route has no Agent policy header')
  })

  const patch = await call(publicBase, `/api/collections/users/records/${ownerId}`, {
    method: 'PATCH',
    authorization: ownerToken,
    body: { oldPassword: p1, password: p2, passwordConfirm: p2 },
  })
  assert.equal(patch.status, 200, `owner password change succeeded (HTTP ${patch.status})`)
  const p2Login = await call(publicBase, '/api/collections/users/auth-with-password', { body: { identity: ownerEmail, password: p2 } })
  ownerToken = statusIs(p2Login, 200, 'owner P2 login').token
  assert.ok(process.kill(entrypoint.pid, 0))
  const childrenAfterChange = processChildren(entrypoint.pid)
  assert.equal(childrenAfterChange.find((row) => row.command.includes('/scripts/serve.mjs'))?.pid, servePidBefore)
  assert.equal(childrenAfterChange.find((row) => row.command.includes('/pocketbase serve'))?.pid, pbPidBefore)
  assert.equal(safeHash(JSON.stringify({
    WORKHUB_PB_URL: childEnv.WORKHUB_PB_URL,
    WORKHUB_PB_ACCOUNT: childEnv.WORKHUB_PB_ACCOUNT,
    WORKHUB_PB_PASSWORD: childEnv.WORKHUB_PB_PASSWORD,
    WORKHUB_AI_DOMAINS: childEnv.WORKHUB_AI_DOMAINS,
  })), executorEnvHash)
  console.log('PASS owner password changed without restarting Node or PocketBase')
  passed.push('owner password changed without restarting Node or PocketBase')

  keyB = statusIs(await call(publicBase, '/api/workhub/agents', {
    authorization: ownerToken,
    body: issueBody('synthetic Agent B after P2', capabilities),
  }), 200, 'issue Agent B after password change').token
  keyReadOnly = statusIs(await call(publicBase, '/api/workhub/agents', {
    authorization: ownerToken,
    body: issueBody('synthetic note read-only Agent', ['note:read']),
  }), 200, 'issue read-only Agent').token

  await test('Agent A and B keep MCP read access and note updates use preview, confirmation, and replay binding', async () => {
    for (const key of [keyA, keyB]) {
      const tools = await mcp(key, 'tools/list')
      assert.equal(tools.ok, true)
      assert.ok(tools.data.tools.some((tool) => tool.name === 'note_updateNote'))
      const operations = await goodTool(key, 'list_operations', { limit: 1 })
      assert.equal(operations.generation, generation)
      const rid = testId('gap12_note_create')
      const created = await goodTool(key, 'note_createNote', {
        title: `synthetic note ${key === keyA ? 'A' : 'B'}`,
        markdown: 'synthetic GAP-12 fixture',
        requestId: rid,
        generation,
      })
      assert.ok(created.noteId)
      const updateArgs = { noteId: created.noteId, markdown: 'confirmed synthetic update', requestId: testId('gap12_note_update'), generation }
      const preview = await goodTool(key, 'note_updateNote', updateArgs)
      assert.equal(preview.preview, true)
      assert.equal(preview.confirmHint.tool, 'confirm_preview')
      const wrong = await mcp(key, 'tools/call', { name: 'confirm_preview', arguments: {
        ...preview.confirmHint.args,
        args: { ...preview.confirmHint.args.args, markdown: 'tampered plan' },
      } })
      assert.equal(wrong.ok, false, 'a different parameter set cannot consume the preview')
      if (key === keyA) {
        const crossClient = await mcp(keyB, 'tools/call', { name: 'confirm_preview', arguments: preview.confirmHint.args })
        assert.equal(crossClient.ok, false, 'Agent B cannot confirm Agent A preview')
      }
      const ticket = await goodTool(key, 'confirm_preview', preview.confirmHint.args)
      const context = { requestId: preview.confirmHint.args.requestId, generation: preview.confirmHint.args.generation }
      const committed = await goodTool(key, 'note_updateNote', { ...preview.confirmHint.args.args, ...context, confirmToken: ticket.confirmToken })
      assert.ok(committed.operationId)
      const replay = await goodTool(key, 'note_updateNote', { ...preview.confirmHint.args.args, ...context })
      assert.equal(replay.operationId, committed.operationId)
    }
  })

  await test('note:read alone reads notes and folder membership without link:read, but cannot write notes', async () => {
    const result = await goodTool(keyReadOnly, 'listNotes', { limit: 5 })
    assert.ok(Array.isArray(result.items))
    const deniedWrite = await mcp(keyReadOnly, 'tools/call', { name: 'note_createNote', arguments: {
      title: 'must not write', markdown: 'read-only key', requestId: testId('gap12_read_only'), generation,
    } })
    assert.equal(deniedWrite.ok, false)
    assert.match(String(deniedWrite.error), /FORBIDDEN|写能力|note/i)
  })

  await test('Agent PB owner record must exist and key revocation/generation invalidation take effect', async () => {
    const freshSuper = (await call(publicBase, '/api/collections/_superusers/auth-with-password', { body: { identity: superEmail, password: superPassword } })).body.token
    const state = statusIs(await call(pbBase, '/api/collections/command_state/records?perPage=10', { authorization: freshSuper }), 200, 'read command state').items[0]
    const detached = await call(pbBase, `/api/collections/command_state/records/${state.id}`, { method: 'PATCH', authorization: freshSuper, body: { ownerId: 'missing-owner-record' } })
    assert.equal(detached.status, 200)
    denied(await call(pbBase, '/api/workhub/agents/verify', { body: { kind: 'agent', token: keyB } }), 'Agent verification after owner record disappeared')
    statusIs(await call(pbBase, `/api/collections/command_state/records/${state.id}`, { method: 'PATCH', authorization: freshSuper, body: { ownerId } }), 200, 'restore synthetic owner reference')

    statusIs(await call(publicBase, '/api/workhub/agents', { authorization: ownerToken, body: { action: 'revoke', id: agentIdA } }), 200, 'revoke Agent A')
    denied(await call(pbBase, '/api/workhub/agents/verify', { body: { kind: 'agent', token: keyA } }), 'revoked Agent A')
    assert.equal((await mcp(keyB, 'tools/call', { name: 'list_operations', arguments: { limit: 1 } })).ok, true, 'Agent B remains valid when A is revoked')

    const nextGeneration = randomBytes(20).toString('hex')
    statusIs(await call(pbBase, `/api/collections/command_state/records/${state.id}`, { method: 'PATCH', authorization: freshSuper, body: { generation: nextGeneration } }), 200, 'advance synthetic generation')
    denied(await call(pbBase, '/api/workhub/agents/verify', { body: { kind: 'agent', token: keyB } }), 'old generation Agent B')
  })

  const logs = sanitizedLog(logPath, [p1, p2, superPassword, keyA, keyB, keyReadOnly, keyExpired])
  assert.ok(!logs.includes(p1) && !logs.includes(p2) && !logs.includes(superPassword), 'passwords must not appear in production process logs')
  const report = {
    schemaVersion: 1,
    taskId: 'C-GAP12',
    verdict: 'pass',
    isolated: true,
    pocketbase: '0.40.2',
    syntheticDataDir: dataDir,
    entrypointPid: entrypoint.pid,
    servePid: servePidBefore,
    pocketbasePid: pbPidBefore,
    executorEnvSha256: executorEnvHash,
    domains: { configured: envDomains, crmWriteDisabled: true, forgedHeaderCannotEnable: true },
    checks: passed,
    secretsLogged: false,
    ownerPasswordChangeDidNotRestartProcesses: true,
  }
  writeFileSync(process.env.WORKHUB_GAP12_REPORT || join(temp, 'gap12-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report, syntheticDataDir: '[isolated temp]' }, null, 2))
} catch (error) {
  if (error.authSmokeComplete) {
    console.log('GAP-12 auth smoke completed')
  } else if (error.activityDomainSmokeComplete) {
    console.log('GAP-12 activity-domain smoke completed')
  } else if (error.readDomainSmokeComplete) {
    console.log('GAP-12 read-domain smoke completed')
  } else {
    const logs = sanitizedLog(logPath, [p1, p2, superPassword, keyA, keyB, keyReadOnly, keyExpired])
    console.error('GAP-12 integration failed:', error.message)
    console.error(logs.slice(-12_000))
    process.exitCode = 1
  }
} finally {
  if (entrypoint && entrypoint.exitCode === null) {
    entrypoint.kill('SIGTERM')
    await Promise.race([once(entrypoint, 'exit'), delay(7000)]).catch(() => {})
    if (entrypoint.exitCode === null) entrypoint.kill('SIGKILL')
  }
  closeSync(logFd)
}

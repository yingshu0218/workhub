/**
 * 线上复验（默认跳过）：P0「删除不跨设备传播」修复的真实链路核验
 *
 * 与同目录 `deleteTombstonePropagation.test.ts` 的分工：
 * - 那个是**离线单元回归**（fetch 桩），钉住「不物理删除」「更新的墓碑生效」两条不变式，随 npm test 常跑；
 * - 这个是**真链路复验**，用真实适配器代码打真实 PocketBase，证明修复后服务端墓碑**确实留存**，
 *   即修复前实测到的「行存活 <100ms」已不复现。
 *
 * 为什么不进默认套件：需要外网与测试环境凭据。
 * 凭据走环境变量，**严禁**写进本文件（AGENTS.md §9：密码 / 服务器地址不入库）。
 *
 * 运行：
 *   NEXUS_LIVE_URL=https://dev.fpigeon.fun \
 *   NEXUS_LIVE_USER=demo@nexus.local \
 *   NEXUS_LIVE_PASSWORD='***' \
 *   npx vitest run src/sync/__tests__/deletePropagation.live.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { DEFAULT_SETTINGS } from '@/db/types'
import { pocketBaseAdapter } from '../pocketbaseAdapter'

const URL_BASE = (process.env.NEXUS_LIVE_URL ?? '').replace(/\/+$/, '')
const USER = process.env.NEXUS_LIVE_USER ?? ''
const PASS = process.env.NEXUS_LIVE_PASSWORD ?? ''
const LIVE = !!URL_BASE && !!USER && !!PASS

/** 本次复验用的记录 id（带时间戳，便于在服务端一眼认出并清理） */
const LOCAL_ID = `p0-verify:${Date.now()}`

let token = ''
/** 该行在「推送/删除」发生前，服务端最新 server_received_at —— 对端游标的等价物 */
let cursorBefore = 0

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: token, ...(init.headers ?? {}) },
  })
}

/** 按 localId 读服务端行（只读探针） */
async function probe(): Promise<{ deleted: number; at: string } | null> {
  const filter = encodeURIComponent(`localId = '${LOCAL_ID}'`)
  const res = await api(
    `/api/collections/customers/records?filter=${filter}&fields=id,deleted,server_received_at`,
  )
  if (!res.ok) throw new Error(`探针失败 HTTP ${res.status}`)
  const { items } = (await res.json()) as { items?: { deleted?: number; server_received_at?: string }[] }
  if (!items?.length) return null
  return { deleted: Number(items[0].deleted ?? 0), at: String(items[0].server_received_at ?? '') }
}

/** 按 localId 物理删除服务端行（收尾清理，避免留验证垃圾） */
async function hardDeleteRemote(): Promise<void> {
  const filter = encodeURIComponent(`localId = '${LOCAL_ID}'`)
  const res = await api(`/api/collections/customers/records?filter=${filter}&fields=id`)
  if (!res.ok) return
  const { items } = (await res.json()) as { items?: { id: string }[] }
  if (!items?.length) return
  await api(`/api/collections/customers/records/${items[0].id}`, { method: 'DELETE' })
}

function localCustomer(over: Record<string, unknown>) {
  return {
    id: LOCAL_ID,
    name: 'P0复验-删除传播（可删）',
    company: '本地验证',
    title: '',
    decisionLevel: '',
    tier: 'C',
    tags: [],
    relations: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: 0,
    rev: 1,
    ...over,
  }
}

beforeAll(async () => {
  if (!LIVE) return
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.settings.put({
    ...DEFAULT_SETTINGS,
    sync: { serverUrl: URL_BASE, username: USER, password: PASS, token: '', tokenUserId: '' },
  })
  // 登录拿 raw token 供只读探针使用
  const res = await fetch(`${URL_BASE}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: USER, password: PASS }),
  })
  if (!res.ok) throw new Error(`登录失败 HTTP ${res.status}`)
  token = String(((await res.json()) as { token?: string }).token ?? '')
  expect(token, '应拿到鉴权 token').not.toBe('')
})

afterAll(async () => {
  if (!LIVE) return
  await hardDeleteRemote()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe.skipIf(!LIVE)('线上复验：删除后服务端墓碑必须留存（P0）', () => {
  it('推 upsert → 本地软删 → 推 delete：服务端行仍在且 deleted=1，且可被增量拉取看到', async () => {
    // ── 1. 首推：记录建立 ──
    await db.customers.put(localCustomer({}) as never)
    const up = await pocketBaseAdapter.push([
      { table: 'customers', recordId: LOCAL_ID, op: 'upsert' },
    ])
    expect(up).toEqual([{ recordId: LOCAL_ID, ok: true }])

    const created = await probe()
    expect(created, '首推后服务端应存在该行').not.toBeNull()
    expect(created!.deleted).toBe(0)

    // 记录「删除前」的接收时间：作为对端游标的等价起点
    cursorBefore = Date.parse(created!.at.replace(' ', 'T'))
    expect(Number.isNaN(cursorBefore)).toBe(false)

    // ── 2. 本地软删并推 delete（修复前：这一步会让服务端行瞬间消失）──
    await db.customers.put(
      localCustomer({ deleted: 1, updatedAt: Date.now() + 1000, rev: 2 }) as never,
    )
    const del = await pocketBaseAdapter.push([
      { table: 'customers', recordId: LOCAL_ID, op: 'delete' },
    ])
    expect(del).toEqual([{ recordId: LOCAL_ID, ok: true }])

    // ── 3. 立刻探针：行必须还在，且是墓碑 ──
    const rightAfter = await probe()
    expect(rightAfter, '删除推送后服务端行不得消失（修复前此处为 null）').not.toBeNull()
    expect(rightAfter!.deleted).toBe(1)

    // ── 4. 持续观察 5s：墓碑不得被任何后续动作清掉 ──
    // 修复前实测「行存活 <100ms」，100ms 粒度探针从未观测到 deleted=1；
    // 这里取 5s 是刻意放宽 —— 只要墓碑在保留期内稳定存在，对端就一定有窗口拉到它。
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const p = await probe()
      expect(p, `第 ${i + 1} 秒：墓碑仍应在服务端`).not.toBeNull()
      expect(p!.deleted).toBe(1)
    }

    // ── 5. 对端视角：按 server_received_at 增量的 pull 查询必须能查到这条墓碑 ──
    const iso = new Date(cursorBefore).toISOString().replace('T', ' ')
    const filter = encodeURIComponent(
      `server_received_at > '${iso}' && localId = '${LOCAL_ID}'`,
    )
    const pulled = await api(
      `/api/collections/customers/records?filter=${filter}&fields=id,localId,deleted,server_received_at`,
    )
    expect(pulled.ok).toBe(true)
    const { items } = (await pulled.json()) as { items?: { localId?: string; deleted?: number }[] }
    expect(items?.length, '增量 pull 必须能看到这条删除（删除得以传播的前提）').toBe(1)
    expect(items![0].localId).toBe(LOCAL_ID)
    expect(Number(items![0].deleted)).toBe(1)
  }, 60_000)
})

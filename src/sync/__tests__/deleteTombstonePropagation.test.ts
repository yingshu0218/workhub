/**
 * P0 回归：删除必须跨设备传播（2026-09-15 双端同步实测暴露）
 *
 * 现场：A 端删除客户 → 服务端该行「直接消失」，100ms 探针从未观测到 deleted=1（行存活 <100ms）
 * → B 端仍持有 deleted=0 的副本 → B 端对该记录做一次操作（updatedAt 变新）→ 推送按
 * 「localId 查不到」走 POST 新建 → 记录复活，并凭更新的 updatedAt 反向覆盖 A 端墓碑。
 *
 * 根因有两条，缺一条都仍会复活，故两处各自用例钉住：
 * 1. 推送侧：delete 推完墓碑后紧接着对服务端物理删除（`pbDeleteRemote`）——
 *    墓碑在服务端不落存留，对端根本没有删除可拉。
 * 2. 接收侧：mergeRemote 的「本地未推送编辑保护」分支会把 deleted 写回本地值
 *    （`local.deleted ?? 0`），把更新的远端墓碑静默吃掉，本端滞留幽灵记录。
 *
 * 不变式：**墓碑一旦进服务端就必须留在服务端**，直到服务端 cron 的 30 天保留期到期。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { DEFAULT_SETTINGS } from '@/db/types'
import { mergeRemoteRecord as mergeRemote } from '../mergeRemote'
import { pocketBaseAdapter } from '../pocketbaseAdapter'

const PB_ID = 'pbcust00000001x'

/** 抓取到的一次 HTTP 调用（用于断言「有没有发生物理删除」这类协议级事实） */
interface HttpCall {
  method: string
  url: string
  body: string
}

let calls: HttpCall[] = []

/** 配置成「已接入服务器」并缓存可用 token（避免用例里再走一次登录） */
async function configureSync(): Promise<void> {
  await db.settings.put({
    ...DEFAULT_SETTINGS,
    sync: {
      serverUrl: 'https://sync.test',
      username: 'u@test.local',
      password: 'p',
      token: 'tok',
      tokenUserId: 'u1',
    },
  })
}

/** 装一个确定性 fetch 桩：remoteExists 决定服务端是否已存在该 localId 的记录 */
function installFetch(opts: { remoteExists: boolean; remoteUpdatedAt?: number }): void {
  calls = []
  const remoteUpdatedAt = opts.remoteUpdatedAt ?? 100
  vi.stubGlobal('fetch', async (input: unknown, init: RequestInit = {}) => {
    const url = String(input)
    const method = String(init.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: typeof init.body === 'string' ? init.body : '' })

    // isTokenFresh / login 的探针：一律 200
    if (url.includes('/api/collections/users/')) {
      return new Response(JSON.stringify({ id: 'u1' }), { status: 200 })
    }
    if (method === 'GET' && url.includes('/api/collections/customers/records?')) {
      const items = opts.remoteExists ? [{ id: PB_ID, updatedAt: remoteUpdatedAt }] : []
      return new Response(JSON.stringify({ items, totalPages: 1 }), { status: 200 })
    }
    if (method === 'PATCH' || method === 'POST') {
      return new Response(JSON.stringify({ id: PB_ID }), { status: 200 })
    }
    if (method === 'DELETE') {
      // 204 属 null body status：构造时必须传 null，传空串会让 Response 构造函数直接抛错
      return new Response(null, { status: 204 })
    }
    return new Response('', { status: 404 })
  })
}

function customer(over: Record<string, unknown>) {
  return {
    id: 'c1',
    name: '严伟强',
    company: '深蓝科技',
    title: '',
    decisionLevel: '',
    tier: 'S',
    tags: [],
    phone: '',
    wechat: '',
    email: '',
    address: '',
    lastContactAt: 1,
    createdAt: 1,
    updatedAt: 100,
    deleted: 0 as const,
    rev: 1,
    ...over,
  }
}

/** 服务端墓碑形态（钩子已盖 server_received_at / tombstonePushed） */
function remoteTombstone(updatedAt: number) {
  return {
    id: PB_ID,
    localId: 'c1',
    name: '严伟强',
    updatedAt,
    deleted: 1,
    rev: 2,
    server_received_at: '2026-09-15 06:00:00.000Z',
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('P0 删除跨设备传播：推送侧', () => {
  it('delete 只写墓碑，绝不物理删除服务端行（对端才拉得到这条删除）', async () => {
    await configureSync()
    await db.customers.put(customer({ deleted: 1, updatedAt: 900, rev: 2 }) as never)
    installFetch({ remoteExists: true, remoteUpdatedAt: 100 })

    const res = await pocketBaseAdapter.push([
      { table: 'customers', recordId: 'c1', op: 'delete' },
    ])

    expect(res).toEqual([{ recordId: 'c1', ok: true }])
    // 核心断言：整轮推送没有任何 DELETE（修复前这里会先 PATCH 墓碑、再 DELETE 抹掉）
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([])
    // 墓碑确实上行，且 deleted=1
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch, '应有一次 PATCH 写墓碑').toBeTruthy()
    expect(JSON.parse(patch!.body).deleted).toBe(1)
    // 「delete 已推送」标记照旧盖章（cleanupTombstones 依赖它）
    const marker = await db.meta.get('tombstone_pushed:customers:c1')
    expect(marker?.value).toBe(1)
  })

  it('服务端已有更新墓碑时，本端旧副本的 upsert 被推送侧 LWW 跳过（不复活）', async () => {
    await configureSync()
    // B 端：仍持 deleted=0 的旧副本（updatedAt=100）
    await db.customers.put(customer({ updatedAt: 100 }) as never)
    // 服务端：A 端已写入墓碑，updatedAt 更新（900）
    installFetch({ remoteExists: true, remoteUpdatedAt: 900 })

    const res = await pocketBaseAdapter.push([
      { table: 'customers', recordId: 'c1', op: 'upsert' },
    ])

    expect(res).toEqual([{ recordId: 'c1', ok: true }])
    // 不得发出任何写入请求 —— 一旦 POST 新建，记录就被复活
    expect(calls.filter((c) => c.method === 'PATCH' || c.method === 'POST')).toEqual([])
  })
})

describe('P0 删除跨设备传播：接收侧', () => {
  it('本端有未推送编辑时，更新的远端墓碑仍然生效（不被「编辑保护」吃掉）', async () => {
    // 本端：刚编辑过（updatedAt=100）且有未推送的 upsert 队列条目
    await db.customers.put(customer({ updatedAt: 100, deleted: 0 }) as never)
    await db.syncQueue.add({ table: 'customers', recordId: 'c1', op: 'upsert', createdAt: 100 })

    // 对端删除更晚发生（墓碑 updatedAt=200）
    const res = await mergeRemote('customers', remoteTombstone(200) as never)

    expect(res).toBe('write')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(1)
    expect(after.updatedAt).toBe(200)
  })

  it('远端墓碑比本地编辑更旧时不生效（编辑胜，LWW 口径边界不变）', async () => {
    await db.customers.put(customer({ updatedAt: 300, deleted: 0 }) as never)
    await db.syncQueue.add({ table: 'customers', recordId: 'c1', op: 'upsert', createdAt: 300 })

    // 墓碑 updatedAt=200 < 本地 300 → 短路在 LWW，本地编辑保留（属「删除 vs 编辑优先级」策略项，此处仅钉边界）
    const res = await mergeRemote('customers', remoteTombstone(200) as never)

    expect(res).toBe('skip')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(0)
    expect(after.updatedAt).toBe(300)
  })

  it('无待推送编辑时，远端墓碑照常落库为本地删除', async () => {
    await db.customers.put(customer({ updatedAt: 100 }) as never)

    const res = await mergeRemote('customers', remoteTombstone(200) as never)

    expect(res).toBe('write')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(1)
  })
})

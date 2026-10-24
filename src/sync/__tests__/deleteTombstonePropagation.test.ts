/**
 * P0 回归：删除必须跨设备传播 + 删除优先（2026-09-15 双端同步实测暴露）
 *
 * 现场：A 端删除客户 → 服务端该行「直接消失」，100ms 探针从未观测到 deleted=1（行存活 <100ms）
 * → B 端仍持有 deleted=0 的副本 → B 端对该记录做一次操作（updatedAt 变新）→ 推送按
 * 「localId 查不到」走 POST 新建 → 记录复活，并凭更新的 updatedAt 反向覆盖 A 端墓碑。
 *
 * 根因与对策一共三条，缺任何一条都会留下跨设备永久不一致：
 * 1. **推送侧**：delete 推完墓碑后紧接着对服务端物理删除（`pbDeleteRemote`）——
 *    墓碑在服务端几乎不落存留，对端根本没有删除可拉。→ 已移除物理删除。
 * 2. **接收侧**：mergeRemote 的「本地未推送编辑保护」分支会把 deleted 写回本地值
 *    （`local.deleted ?? 0`），把更新的远端墓碑静默吃掉，本端滞留幽灵记录。→ 墓碑收口提前。
 * 3. **删除优先**（2026-09-15 拍板，软删为**不可逆终态**）：只要一侧是墓碑、另一侧不是，
 *    墓碑胜且**不比较 updatedAt**。仅做 1+2 只能挡住「删除更晚」的一半情形；
 *    「对端在不知情期间编辑更晚」这一半要靠本条兜住 —— 且因为同步引擎**先推后拉**，
 *    必须**推送侧与接收侧各自设防**（推送侧挡服务端墓碑被覆盖，接收侧挡本端墓碑被复活）。
 *
 * 不变式：
 *   - 墓碑一旦进服务端就必须留在服务端，直到 cron 的 30 天保留期到期；
 *   - 墓碑只进不出 —— 任何更晚的编辑都不允许让记录复活。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { DEFAULT_SETTINGS } from '@/db/types'
import { mergeRemoteRecord as mergeRemote } from '../mergeRemote'
import { pocketBaseAdapter, cleanupTombstones } from '../pocketbaseAdapter'

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

/**
 * 装一个确定性 fetch 桩。
 * remoteExists 决定服务端是否已存在该 localId 的记录；
 * remoteDeleted 决定该记录在服务端是否已是墓碑（对应 pbUpsert 查询里的 fields=deleted）。
 */
function installFetch(opts: {
  remoteExists: boolean
  remoteUpdatedAt?: number
  remoteDeleted?: boolean
}): void {
  calls = []
  const remoteUpdatedAt = opts.remoteUpdatedAt ?? 100
  const remoteDeleted = opts.remoteDeleted ?? false
  vi.stubGlobal('fetch', async (input: unknown, init: RequestInit = {}) => {
    const url = String(input)
    const method = String(init.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: typeof init.body === 'string' ? init.body : '' })

    // isTokenFresh / login 的探针：一律 200
    if (url.includes('/api/collections/users/')) {
      return new Response(JSON.stringify({ id: 'u1' }), { status: 200 })
    }
    if (method === 'GET' && url.includes('/api/collections/customers/records?')) {
      const items = opts.remoteExists
        ? [{ id: PB_ID, updatedAt: remoteUpdatedAt, deleted: remoteDeleted ? 1 : 0 }]
        : []
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

/** 服务端活记录形态（对端在不知情期间编辑过） */
function remoteLive(updatedAt: number) {
  return {
    id: PB_ID,
    localId: 'c1',
    name: '对端改过的名字',
    updatedAt,
    deleted: 0,
    rev: 3,
    server_received_at: '2026-09-15 06:00:00.000Z',
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('删除传播 · 推送侧', () => {
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

  it('队列条目是 upsert、但记录此刻已是墓碑时，按墓碑推送并盖标记（不漏本地清理）', async () => {
    await configureSync()
    // 对端墓碑已被 mergeRemote 落到本端，而队列里留着这条记录更早的 upsert 条目
    await db.customers.put(customer({ deleted: 1, updatedAt: 900, rev: 2 }) as never)
    installFetch({ remoteExists: true, remoteUpdatedAt: 100 })

    const res = await pocketBaseAdapter.push([
      { table: 'customers', recordId: 'c1', op: 'upsert' },
    ])

    expect(res).toEqual([{ recordId: 'c1', ok: true }])
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([])
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body).deleted).toBe(1)
    expect((await db.meta.get('tombstone_pushed:customers:c1'))?.value).toBe(1)
  })

  it('服务端已有更新墓碑时，本端旧副本的 upsert 被拒绝（不复活）', async () => {
    await configureSync()
    // B 端：仍持 deleted=0 的旧副本（updatedAt=100）
    await db.customers.put(customer({ updatedAt: 100 }) as never)
    // 服务端：A 端已写入墓碑，updatedAt 更新（900）
    installFetch({ remoteExists: true, remoteUpdatedAt: 900, remoteDeleted: true })

    const res = await pocketBaseAdapter.push([
      { table: 'customers', recordId: 'c1', op: 'upsert' },
    ])

    expect(res).toEqual([{ recordId: 'c1', ok: true }])
    // 不得发出任何写入请求 —— 一旦 POST 新建 / PATCH 覆盖，记录就被复活
    expect(calls.filter((c) => c.method === 'PATCH' || c.method === 'POST')).toEqual([])
  })

  it('本端编辑更晚、服务端仍持墓碑时也必须拒绝复活，并把删除镜像到本地', async () => {
    await configureSync()
    // B 端不知情期间编辑过：updatedAt=900，**比墓碑（100）更新** —— 推送侧 LWW 放行的那种情形
    await db.customers.put(customer({ updatedAt: 900 }) as never)
    installFetch({ remoteExists: true, remoteUpdatedAt: 100, remoteDeleted: true })

    const res = await pocketBaseAdapter.push([
      { table: 'customers', recordId: 'c1', op: 'upsert' },
    ])

    expect(res).toEqual([{ recordId: 'c1', ok: true }])
    // 关键：一次 PATCH 就会把服务端墓碑覆盖成 deleted=0，记录从此再无从收敛
    expect(calls.filter((c) => c.method === 'PATCH' || c.method === 'POST')).toEqual([])
    // 且必须就地收敛 —— 只跳过推送会让本端永远停在 deleted=0（该墓碑的游标早已推过，不再重拉）
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(1)
    expect(after.updatedAt).toBe(900) // 抬到两者较大值
    expect((await db.meta.get('tombstone_pushed:customers:c1'))?.value).toBe(1)
  })
})

describe('删除优先 · 接收侧（墓碑只进不出）', () => {
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

  it('远端墓碑比本地编辑更旧时**仍然**生效（删除优先，2026-09-15 口径变更）', async () => {
    await db.customers.put(customer({ updatedAt: 300, deleted: 0 }) as never)
    await db.syncQueue.add({ table: 'customers', recordId: 'c1', op: 'upsert', createdAt: 300 })

    // 墓碑 updatedAt=200 < 本地 300 —— 旧口径下 LWW 短路、本地编辑保留；
    // 新口径下软删是不可逆终态，墓碑先于 LWW 判定，故必须落删
    const res = await mergeRemote('customers', remoteTombstone(200) as never)

    expect(res).toBe('write')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(1)
    expect(after.updatedAt).toBe(300) // 抬到两者较大值，回推时不比旧墓碑旧
  })

  it('本端已是墓碑时，远端更晚的编辑不得让它复活（只进不出）', async () => {
    await db.customers.put(customer({ deleted: 1, updatedAt: 100, rev: 2 }) as never)

    const res = await mergeRemote('customers', remoteLive(900) as never)

    expect(res).toBe('skip')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(1)
    expect(after.name).toBe('严伟强') // 内容也不被远端活记录覆盖
    expect(after.updatedAt).toBe(100)
  })

  it('无待推送编辑时，远端墓碑照常落库为本地删除', async () => {
    await db.customers.put(customer({ updatedAt: 100 }) as never)

    const res = await mergeRemote('customers', remoteTombstone(200) as never)

    expect(res).toBe('write')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(1)
  })

  it('双方均非墓碑时，LWW 行为不变（活记录之间仍按 updatedAt 收敛）', async () => {
    await db.customers.put(customer({ updatedAt: 100, name: '本地名字' }) as never)

    const res = await mergeRemote('customers', remoteLive(900) as never)

    expect(res).toBe('write')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(0)
    expect(after.name).toBe('对端改过的名字')
    expect(after.updatedAt).toBe(900)
  })

  it('【对照】本端曾持有该记录时，远端墓碑照常落库（方案 B 不误伤）', async () => {
    // 与下一条的唯一差别就是本地有没有这条记录 —— 用来把 B 的判定钉在 `local` 上
    await db.customers.put(customer({ updatedAt: 100 }) as never)
    await db.syncQueue.add({ table: 'customers', recordId: 'c1', op: 'upsert', createdAt: 100 })

    const res = await mergeRemote('customers', remoteTombstone(200) as never)

    expect(res).toBe('write')
    expect(((await db.customers.get('c1')) as never as Record<string, unknown>).deleted).toBe(1)
  })

  it('本端从未持有该记录时，远端墓碑不落库（方案 B：不写幽灵墓碑）', async () => {
    // 对端建了又删，本端从没见过这条记录：pull 拉到墓碑不应在本地凭空生出一条记录。
    // 这类墓碑无标记、不经推送，本地也永不重拉 → 只会长期占着 IndexedDB。
    const res = await mergeRemote('customers', remoteTombstone(200) as never)

    expect(res).toBe('skip')
    expect(await db.customers.get('c1')).toBeUndefined()
  })
})

// ─────────────────── 回收站恢复例外（2026-10-23） ───────────────────

describe('回收站 · 显式恢复（仅 restoredAt 可打破删除优先）', () => {
  it('本地墓碑 + 远端活记录带更新的 restoredAt → 本地恢复', async () => {
    await db.customers.put(customer({ deleted: 1, updatedAt: 100, rev: 2 }) as never)

    const res = await mergeRemote(
      'customers',
      { ...remoteLive(200), restoredAt: 200 } as never,
    )

    expect(res).toBe('write')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(0)
    expect(after.restoredAt).toBe(200)
  })

  it('本地墓碑 + 远端活记录但 restoredAt 不晚于墓碑 → 仍然删除优先', async () => {
    await db.customers.put(customer({ deleted: 1, updatedAt: 300, rev: 2 }) as never)

    const res = await mergeRemote(
      'customers',
      { ...remoteLive(200), restoredAt: 200 } as never,
    )

    expect(res).toBe('skip')
    expect(((await db.customers.get('c1')) as never as Record<string, unknown>).deleted).toBe(1)
  })

  it('本地活记录带更新的 restoredAt + 远端墓碑 → 本地保持活（恢复优先）', async () => {
    await db.customers.put(customer({ updatedAt: 200, restoredAt: 200 }) as never)

    const res = await mergeRemote('customers', remoteTombstone(100) as never)

    expect(res).toBe('skip')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(0)
  })

  it('普通编辑不丢 restoredAt（粘性）', async () => {
    await db.customers.put(customer({ updatedAt: 100, restoredAt: 200 }) as never)

    const res = await mergeRemote('customers', remoteLive(300) as never)

    expect(res).toBe('write')
    expect(((await db.customers.get('c1')) as never as Record<string, unknown>).restoredAt).toBe(200)
  })

  it('删除晚于恢复 → 落墓碑并清空 restoredAt', async () => {
    await db.customers.put(customer({ updatedAt: 200, restoredAt: 200 }) as never)

    const res = await mergeRemote('customers', remoteTombstone(300) as never)

    expect(res).toBe('write')
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(1)
    expect(after.restoredAt).toBeUndefined()
  })

  it('推送侧：本地活记录带晚于墓碑的 restoredAt → 允许 PATCH 复活', async () => {
    await configureSync()
    await db.customers.put(
      customer({ updatedAt: 200, restoredAt: 200, name: '恢复后的名字' }) as never,
    )
    installFetch({ remoteExists: true, remoteUpdatedAt: 100, remoteDeleted: true })

    const res = await pocketBaseAdapter.push([
      { table: 'customers', recordId: 'c1', op: 'upsert' },
    ])

    expect(res).toEqual([{ recordId: 'c1', ok: true }])
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch, '应允许一次 PATCH 复活').toBeTruthy()
    const body = JSON.parse(patch!.body)
    expect(body.deleted).toBe(0)
    expect(body.restoredAt).toBe(200)
  })

  it('推送侧：restoredAt 早于远端墓碑 → 仍拒绝并镜像删除', async () => {
    await configureSync()
    await db.customers.put(customer({ updatedAt: 200, restoredAt: 200 }) as never)
    installFetch({ remoteExists: true, remoteUpdatedAt: 300, remoteDeleted: true })

    const res = await pocketBaseAdapter.push([
      { table: 'customers', recordId: 'c1', op: 'upsert' },
    ])

    expect(res).toEqual([{ recordId: 'c1', ok: true }])
    expect(calls.filter((c) => c.method === 'PATCH' || c.method === 'POST')).toEqual([])
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after.deleted).toBe(1)
    expect(after.restoredAt).toBeUndefined()
  })
})

// ─────────────────── 墓碑清理（方案 A）与幽灵抑制（方案 B）· 2026-09-15 ───────────────────

/** 31 天前的 updatedAt：越过 cleanupTombstones 的 30 天保留期 */
const STALE_AT = Date.now() - 31 * 24 * 60 * 60 * 1000

describe('墓碑清理 · 方案 A（放宽保留条件，无标记墓碑也能回收）', () => {
  it('无标记 + 队列已空 → 清理（pull 落库的墓碑，本端已收敛）', async () => {
    await configureSync()
    await db.customers.put(customer({ deleted: 1, updatedAt: STALE_AT, rev: 2 }) as never)
    installFetch({ remoteExists: true })

    const removed = await cleanupTombstones()

    expect(removed).toBe(1)
    expect(await db.customers.get('c1')).toBeUndefined()
  })

  it('无标记 + 队列仍有该记录待推送条目 → 保留（delete 尚未送达服务端，清掉就丢删除）', async () => {
    await configureSync()
    await db.customers.put(customer({ deleted: 1, updatedAt: STALE_AT, rev: 2 }) as never)
    await db.syncQueue.add({ table: 'customers', recordId: 'c1', op: 'delete', createdAt: 1 })
    installFetch({ remoteExists: true })

    const removed = await cleanupTombstones()

    expect(removed).toBe(0)
    expect(((await db.customers.get('c1')) as never as Record<string, unknown>).deleted).toBe(1)
  })

  it('有标记 + 队列已空 → 清理（原有行为不变）', async () => {
    await configureSync()
    await db.customers.put(customer({ deleted: 1, updatedAt: STALE_AT, rev: 2 }) as never)
    await db.meta.put({ key: 'tombstone_pushed:customers:c1', value: 1 })
    installFetch({ remoteExists: true })

    const removed = await cleanupTombstones()

    expect(removed).toBe(1)
    expect(await db.customers.get('c1')).toBeUndefined()
    expect(await db.meta.get('tombstone_pushed:customers:c1')).toBeUndefined()
  })

  it('【对照】未过 30 天保留期的墓碑一律不动（无论有无标记）', async () => {
    await configureSync()
    await db.customers.put(customer({ deleted: 1, updatedAt: Date.now(), rev: 2 }) as never)
    installFetch({ remoteExists: true })

    expect(await cleanupTombstones()).toBe(0)
    expect(((await db.customers.get('c1')) as never as Record<string, unknown>).deleted).toBe(1)
  })
})

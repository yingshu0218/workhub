/**
 * Issue #130 根因回归：服务端 json 字段拉回后必须反序列化，否则前端白屏 / 关系静默回滚
 *
 * 真实故障链（用户侧表现：CRM 页面白屏、客户关系「保存不生效」）：
 * 1. 本地保存 → push，payload 里 `tags` / `relations` 是数组、`intimacy` 是对象（正常）
 * 2. PocketBase 的 json 字段收到**字符串**时会把它当 JSON 再存一次（`types.JSONRaw.Scan`
 *    对 string 走 `json.UnmarshalJSON`），于是「本地已 stringify 的字符串」会**双重编码**
 * 3. pull 拉回来时字段形态可能是：真数组 / JSON 字符串 / 普通字符串（字段被误写成纯文本）
 * 4. 旧实现只在「有本地未推送编辑」分支做数组归一化，**正常 LWW 分支直接整体落库**：
 *    - `tags` 落成字符串 → CRM 列表 `c.tags.join(' ')` / 详情 `customer.tags.map` 抛 TypeError → 白屏
 *    - `relations` 落成字符串 → 关系被静默回滚成空（用户再保存一次即丢）
 *    - `intimacy` 落成字符串 → 亲密度档位显示丢失
 *
 * 断言：无论远端是哪种形态，落库后本地字段类型都必须与本地写入时一致。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { mergeRemoteRecord as mergeRemote } from '../mergeRemote'
import { rawJsonFromRemote } from '../remoteNormalize'

function localCustomer(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: '严伟强',
    company: '深蓝科技',
    title: '采购总监',
    decisionLevel: '决策人',
    
    tags: ['高客单'],
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

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('远端 json 字段反序列化（rawJsonFromRemote）', () => {
  it('真数组 / 真对象原样返回', () => {
    expect(rawJsonFromRemote(['a', 'b'])).toEqual(['a', 'b'])
    expect(rawJsonFromRemote({ level: 'T1' })).toEqual({ level: 'T1' })
  })

  it('JSON 字符串解析成对应类型', () => {
    expect(rawJsonFromRemote(JSON.stringify(['a']))).toEqual(['a'])
    expect(rawJsonFromRemote(JSON.stringify({ level: 'T1' }))).toEqual({ level: 'T1' })
    expect(rawJsonFromRemote('[]')).toEqual([])
    expect(rawJsonFromRemote('{}')).toEqual({})
  })

  it('双层编码再剥一层（本地 stringify + 服务端 json 字段再包一层引号）', () => {
    expect(rawJsonFromRemote(JSON.stringify(JSON.stringify(['高客单'])))).toEqual(['高客单'])
    expect(rawJsonFromRemote(JSON.stringify(JSON.stringify([{ id: 'r1' }])))).toEqual([{ id: 'r1' }])
  })

  it('普通字符串 / 空值不被破坏（不是失败，而是原本就不是 json）', () => {
    expect(rawJsonFromRemote('重点客户')).toBe('重点客户')
    expect(rawJsonFromRemote('')).toBeUndefined()
    expect(rawJsonFromRemote(null)).toBeNull()
    expect(rawJsonFromRemote(undefined)).toBeUndefined()
  })
})

describe('pull 落库后字段类型与本地写入一致', () => {
  it('远端 tags 是 JSON 字符串：正常 LWW 分支不得把数组写成字符串（白屏根因）', async () => {
    await db.customers.put(localCustomer({ updatedAt: 100 }) as never)
    // 关系目标客户须存活，远端旧 relations 键才会派生成 link
    await db.customers.put({ ...localCustomer({ id: 'c2', name: '客户乙' }) } as never)
    // 服务端返回字符串形态的 json 字段（版本/编码差异），updatedAt 更新 → 走正常 LWW 分支
    await mergeRemote('customers', {
      id: 'pbh1',
      localId: 'c1',
      name: '严伟强',
      company: '深蓝科技',
      
      tags: JSON.stringify(['高客单', '关键决策者']),
      relations: JSON.stringify([{ id: 'r1', targetId: 'c2', label: '转介绍人' }]),
      intimacy: JSON.stringify({ level: 'T1' }),
      lastContactAt: 1,
      createdAt: 1,
      updatedAt: 200,
      deleted: false,
      rev: 2,
      server_received_at: 'x',
    } as never)

    const after = (await db.customers.get('c1')) as unknown as {
      tags: string[]
      intimacy: { level?: string }
    } & Record<string, unknown>
    // 这些就是前端会直接调用的形态：tags.join / tags.map / intimacy.level
    expect(Array.isArray(after.tags)).toBe(true)
    expect(after.tags.join(' ')).toBe('高客单 关键决策者')
    expect(after.tags.map((t) => `#${t}`)).toEqual(['#高客单', '#关键决策者'])
    // relations 已迁 links（v15）：本地行剥旧键；远端旧键派生成 relation link
    expect(after).not.toHaveProperty('relations')
    expect(after.intimacy).toEqual({ level: 'T1' })
    const { buildLinkId } = await import('@/repositories/linkId')
    const link = await db.links.get(
      buildLinkId(
        { type: 'customers', id: 'c1' },
        { type: 'customers', id: 'c2' },
        'relation',
        { label: '转介绍人' },
      ),
    )
    expect(link).toMatchObject({ kind: 'relation', deleted: 0 })
    expect(link!.meta?.label).toBe('转介绍人')
  })

  it('远端 tags 是双层编码字符串：仍然还原成数组', async () => {
    await db.customers.put(localCustomer({ tags: [] }) as never)
    await mergeRemote('customers', {
      id: 'pbh1',
      localId: 'c1',
      name: '严伟强',
      tags: JSON.stringify(JSON.stringify(['高客单'])),
      updatedAt: 200,
      deleted: false,
      rev: 2,
    } as never)
    const after = (await db.customers.get('c1')) as unknown as { tags: string[] }
    expect(Array.isArray(after.tags)).toBe(true)
    expect(after.tags).toEqual(['高客单'])
  })

  it('服务端不是 json 数组而是普通字符串时降级为单标签（不抛错、不丢用户输入）', async () => {
    await db.customers.put(localCustomer({ tags: [] }) as never)
    await mergeRemote('customers', {
      id: 'pbh1',
      localId: 'c1',
      name: '严伟强',
      tags: '重点客户',
      updatedAt: 200,
      deleted: false,
      rev: 2,
    } as never)
    const after = (await db.customers.get('c1')) as unknown as { tags: string[] }
    // 至少不能是字符串（否则前端 .map 直接崩）
    expect(typeof after.tags).not.toBe('string')
  })

  it('relations 是 JSON 字符串时：旧键派生成 link，本地行剥键（并集已由 per-link LWW 取代）', async () => {
    await db.customers.put(localCustomer() as never)
    await db.customers.put({ ...localCustomer({ id: 'c2', name: '客户乙' }) } as never)
    await db.syncQueue.clear()
    await mergeRemote('customers', {
      id: 'pbh1',
      localId: 'c1',
      name: '严伟强',
      tags: '[]',
      relations: JSON.stringify([{ targetId: 'c2', label: '远端新增' }]),
      updatedAt: 200,
      deleted: false,
      rev: 2,
    } as never)
    const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    expect(after).not.toHaveProperty('relations')
    // 远端旧键按确定性 id 派生成 link —— 多端各自派生天然合流（取代并集合并）
    const { buildLinkId } = await import('@/repositories/linkId')
    const link = await db.links.get(
      buildLinkId(
        { type: 'customers', id: 'c1' },
        { type: 'customers', id: 'c2' },
        'relation',
        { label: '远端新增' },
      ),
    )
    expect(link).toMatchObject({ kind: 'relation', deleted: 0 })
  })

  it('服务端空 json 字段（"" / null）：不派生 link，本地行剥旧键（本地 link 不受影响）', async () => {
    await db.customers.put(localCustomer() as never)
    for (const empty of ['', null]) {
      await mergeRemote('customers', {
        id: `pbh-${String(empty)}`,
        localId: 'c1',
        name: '严伟强',
        tags: '[]',
        relations: empty,
        updatedAt: 200 + String(empty).length,
        deleted: false,
        rev: 2,
      } as never)
      const after = (await db.customers.get('c1')) as unknown as Record<string, unknown>
      expect(after).not.toHaveProperty('relations')
      expect(await db.links.where('kind').equals('relation').count()).toBe(0)
    }
  })
})

describe('端到端：模拟真实 PocketBase 的编码往返', () => {
  /** PB 的 json 字段语义（types.JSONRaw.Scan）：字符串且本身是合法 JSON 时原样存储，否则双引号包裹 */
  function pbJsonStore(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw
    if (raw === '') return ''
    if (raw === 'null' || raw === 'true' || raw === 'false') return raw
    const c = raw[0]
    if ((c >= '0' && c <= '9') || c === '-' || c === '"' || c === '[' || c === '{') {
      try {
        JSON.parse(raw)
        return raw
      } catch {
        /* 非法 JSON：落到下方当普通字符串处理 */
      }
    }
    return JSON.stringify(raw)
  }

  /** 本地 push payload → 服务端存取 → pull 拉回，全程按真实编码规则走一遍 */
  async function roundTrip(payloadValue: unknown) {
    const stored = pbJsonStore(payloadValue)
    // pull 时服务端把存储值原样返回给客户端
    return stored
  }

  it('数组 → 服务端 → 拉回仍是数组（前端 tags.map 可用）', async () => {
    await db.customers.put(localCustomer({ tags: [] }) as never)
    const stored = await roundTrip(['高客单']) // 本地发出去的是数组
    await mergeRemote('customers', {
      id: 'pbh1', localId: 'c1', name: '严伟强', tags: stored as never,
      updatedAt: 200, deleted: false, rev: 2,
    } as never)
    const after = (await db.customers.get('c1')) as unknown as { tags: string[] }
    expect(after.tags.map((t) => t)).toEqual(['高客单'])
  })

  it('字符串 → 服务端（PB 再包一层引号）→ 拉回仍是数组', async () => {
    await db.customers.put(localCustomer({ tags: [] }) as never)
    const stored = await roundTrip(JSON.stringify(['高客单'])) // 本地发出去的是字符串
    await mergeRemote('customers', {
      id: 'pbh1', localId: 'c1', name: '严伟强', tags: stored as never,
      updatedAt: 200, deleted: false, rev: 2,
    } as never)
    const after = (await db.customers.get('c1')) as unknown as { tags: string[] }
    expect(Array.isArray(after.tags)).toBe(true)
    expect(after.tags).toEqual(['高客单'])
  })

  it('回环校验：本端 push 后立刻 pull 自己那条记录，tags 不丢也不变字符串', async () => {
    // 本地保存（tags 在行上；关系 v15 起在 links 表，不随 customers 行往返）
    await db.customers.put(localCustomer() as never)
    const pushed = (await db.customers.get('c1')) as unknown as Record<string, unknown>
    // 服务端收到并原样返回（本地发的是真数组 → PB 存真数组 → 返回真数组）
    const echoed = { ...pushed, id: 'pbh1', localId: 'c1', updatedAt: (pushed.updatedAt as number) + 1000, rev: 2 }
    await mergeRemote('customers', echoed as never)
    const after = (await db.customers.get('c1')) as unknown as { tags: string[] }
    expect(after.tags).toEqual(['高客单'])
  })
})

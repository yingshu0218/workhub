/**
 * Issue #169 审计 P1-A 回归：`notes` 表的 json 字段拉回后未反序列化 → 笔记模块白屏
 *
 * 真实故障链（用户侧表现：打开笔记列表整页进 ErrorBoundary「模块出错了」）：
 * 1. `pb_setup/collections.json` 的 `notes` 定义了 `tags` / `backlinks` / `mentions` 三个 json 字段
 * 2. PocketBase 的 json 字段收到**字符串**时会当 JSON 再存一次（`types.JSONRaw.Scan`；本地
 *    `JSON.stringify` 后再被 PB 包一层引号），pull 回来可能是：真数组 / JSON 字符串 / 普通字符串
 * 3. `mergeRemoteRecord` 的 `reviveRemoteJsonFields` 此前**写死 `if (table !== 'customers') return`**
 *    （#130 只修了 customers 一张表），正常 LWW 分支于是把字符串整体落库
 * 4. 前端 `NotesPage` 的 `n.tags.join(' ')` / `n.mentions.map(...)` 直接抛 `TypeError` → 整页白屏
 *
 * 断言（三条）：
 *   ① 远端 `notes.tags/backlinks/mentions` 为 JSON 字符串时，落库后必须是数组（前端 `.map`/`.join` 可用）
 *   ② 普通字符串（字段被误写成纯文本）降级为单元素数组，而不是把字符串原样留下
 *   ③ **字段表 ↔ `pb_setup/collections.json` 一致性**：仓库声明覆盖服务端实际定义的 json 字段
 *      —— 这条是防漂移锁：将来给某表新加 json 字段而忘了登记，CI 立刻变红
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { db } from '@/db/db'
import { mergeRemoteRecord as mergeRemote } from '../mergeRemote'

const noteBase = {
  title: '会议纪要',
  markdown: '# 正文',
  tags: [] as string[],
  backlinks: [] as string[],
  mentions: [] as unknown[],
  createdAt: 1,
  updatedAt: 100,
  deleted: 0 as const,
  rev: 1,
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('notes 表远端 json 字段反序列化（P1-A）', () => {
  it('tags / mentions / backlinks 是 JSON 字符串时落库为数组，前端 .join/.map 不抛错', async () => {
    await db.notes.put({ id: 'n1', ...noteBase } as never)
    await mergeRemote('notes', {
      id: 'pb1',
      localId: 'n1',
      title: '会议纪要',
      markdown: '# 正文',
      // 服务端返回字符串形态的 json 字段（集合版本 / 编码差异）
      tags: JSON.stringify(['客户', '周会']),
      backlinks: JSON.stringify(['复盘文档']),
      mentions: JSON.stringify([{ type: 'customer', id: 'c1', label: '严伟强' }]),
      updatedAt: 200,
      deleted: false,
      rev: 2,
    } as never)

    const after = (await db.notes.get('n1')) as unknown as {
      tags: string[]
      backlinks: string[]
      mentions: { type: string; id: string; label: string }[]
    }
    // 这三条正是 NotesPage 直接调用的形态（:61/:83/:315/:329）
    expect(Array.isArray(after.tags)).toBe(true)
    expect(after.tags.join(' ')).toBe('客户 周会')
    expect(after.tags.slice(0, 3).map((t) => t)).toEqual(['客户', '周会'])
    expect(Array.isArray(after.mentions)).toBe(true)
    expect(after.mentions.map((m) => m.label)).toEqual(['严伟强'])
    expect(Array.isArray(after.backlinks)).toBe(true)
    expect(after.backlinks).toEqual(['复盘文档'])
  })

  it('双层编码（本地 stringify + PB 再包一层引号）仍还原成数组', async () => {
    await db.notes.put({ id: 'n1', ...noteBase } as never)
    await mergeRemote('notes', {
      id: 'pb1',
      localId: 'n1',
      title: '会议纪要',
      tags: JSON.stringify(JSON.stringify(['客户'])),
      mentions: JSON.stringify(JSON.stringify([{ type: 'todo', id: 't1', label: '回访' }])),
      updatedAt: 200,
      deleted: false,
      rev: 2,
    } as never)
    const after = (await db.notes.get('n1')) as unknown as {
      tags: string[]
      mentions: { label: string }[]
    }
    expect(after.tags).toEqual(['客户'])
    expect(after.mentions.map((m) => m.label)).toEqual(['回访'])
  })

  it('字段被误写成普通字符串时降级为单元素数组（不把字符串原样留下 → 不白屏）', async () => {
    await db.notes.put({ id: 'n1', ...noteBase } as never)
    await mergeRemote('notes', {
      id: 'pb1',
      localId: 'n1',
      title: '会议纪要',
      tags: '重点笔记',
      updatedAt: 200,
      deleted: false,
      rev: 2,
    } as never)
    const after = (await db.notes.get('n1')) as unknown as { tags: string[] }
    expect(Array.isArray(after.tags)).toBe(true)
    expect(typeof after.tags).not.toBe('string')
    // 不静默丢弃用户输入：原始文本按单标签保留
    expect(after.tags).toEqual(['重点笔记'])
  })

  it('本地未推送编辑保护分支同样还原（#130 教训：只在一条分支归一化 = 另一条照样白屏）', async () => {
    await db.notes.put({ id: 'n1', ...noteBase, tags: ['本地标签'] } as never)
    // 队列里仍有该记录的 upsert → 走「本地编辑优先保护」分支
    await db.syncQueue.add({ table: 'notes', recordId: 'n1', op: 'upsert', createdAt: 1 })
    await mergeRemote('notes', {
      id: 'pb1',
      localId: 'n1',
      title: '会议纪要',
      markdown: '# 远端正文',
      tags: JSON.stringify(['远端标签']),
      mentions: JSON.stringify([{ type: 'project', id: 'p1', label: '项目' }]),
      updatedAt: 200,
      deleted: false,
      rev: 2,
    } as never)
    const after = (await db.notes.get('n1')) as unknown as {
      tags: string[]
      mentions: { label: string }[]
    }
    expect(Array.isArray(after.tags)).toBe(true)
    // 远端有值且是新版本 → 按「逐字段覆盖」写入远端值（本地版本在 updatedAt 上并未胜出）；
    // 关键是**类型必须是数组**（这一条才是白屏根因），而不是远端字符串透传
    expect(after.tags).toEqual(['远端标签'])
    // 未推送的本地编辑改写过的 markdown 同样被远端覆盖（本分支只保护 json 嵌套字段，
    // 见 mergeLocalEditProtection.test.ts 的既有口径），此处只断言类型安全
    expect(typeof after.tags).not.toBe('string')
  })

  it('"本地已存在、远端无该键" 时不注入空值（服务端集合未升级路径）', async () => {
    await db.notes.put({ id: 'n1', ...noteBase, tags: ['本地标签'] } as never)
    await db.syncQueue.add({ table: 'notes', recordId: 'n1', op: 'upsert', createdAt: 1 })
    await mergeRemote('notes', {
      id: 'pb1',
      localId: 'n1',
      title: '会议纪要',
      // 远端集合未升级：tags/mentions 键根本不存在
      updatedAt: 200,
      deleted: false,
      rev: 2,
    } as never)
    const after = (await db.notes.get('n1')) as unknown as { tags: string[] }
    expect(Array.isArray(after.tags)).toBe(true)
    expect(after.tags).toEqual(['本地标签'])
  })
})

describe('防漂移锁：json 字段声明表 ↔ pb_setup/collections.json', () => {
  interface PbCollection {
    name: string
    fields?: { name: string; type: string }[]
  }

  /**
   * 服务端每个 `type=json` 的字段，都必须在 `mergeRemote.ts` 的 `JSON_FIELDS_BY_TABLE` 里登记。
   * 手法与 `blacklistScenes.test.ts` 的源码扫描同款：**源码文本断言**，因为它锁的是
   * 「这份声明表存在且覆盖完整」这个事实，而不是某个运行时函数的行为。
   *
   * 为什么值得一条锁：`reviveRemoteJsonFields` 写死 `table !== 'customers'` 这个缺陷的**根因**
   * 就是「服务端定义了 json 字段、本地没有任何一处声明它需要归一化」——
   * 这种缺口在类型系统里不可见（`Record<string, unknown>` 一路放行），只测单个表也永远测不出下一张表。
   */
  function loadServerJsonFields(): { collection: string; field: string }[] {
    const file = path.resolve(process.cwd(), 'pb_setup/collections.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as PbCollection[]
    return raw.flatMap((c) =>
      (c.fields ?? [])
        .filter((f) => f.type === 'json')
        .map((f) => ({ collection: c.name, field: f.name })),
    )
  }

  it('服务端 json 字段全部已登记（漏登记即红）', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/sync/mergeRemote.ts'), 'utf8')
    const start = src.indexOf('const JSON_FIELDS_BY_TABLE')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, src.indexOf('\n}', start))

    // 服务端集合名 → 本地表名（module_configs 是唯一一处历史遗留不一致，与 pbCollection 同口径）
    const LOCAL_NAME: Record<string, string> = { module_configs: 'moduleConfigs' }

    const missing = loadServerJsonFields()
      .filter(({ collection, field }) => {
        const localTable = LOCAL_NAME[collection] ?? collection
        const tableIdx = block.indexOf(`${localTable}:`)
        if (tableIdx < 0) return true
        const fieldsBlock = block.slice(tableIdx, block.indexOf(']', tableIdx))
        return !fieldsBlock.includes(`'${field}'`)
      })
      .map(({ collection, field }) => `${collection}.${field}`)

    expect(missing).toEqual([])
  })

  it('断言本身有区分力：探针集合不存在于声明表时会被判 missing', () => {
    // 反向对照（防「block 恰好包含所有字段名」造成的假绿）
    const src = readFileSync(path.resolve(process.cwd(), 'src/sync/mergeRemote.ts'), 'utf8')
    const block = src.slice(src.indexOf('const JSON_FIELDS_BY_TABLE'))
    expect(block.includes('不存在的集合:')).toBe(false)
    expect(block.includes("'zzzNotAField'")).toBe(false)
  })
})

/**
 * 事件纪律锁：**事件永在事务之后**（AGENTS.md §6.1）
 *
 * 为什么要有这个文件：全仓其余 emit（repositories/index.ts、crm/intimacy/config.ts、
 * quickCapture.ts）都严格在事务块之外，唯 `settingsRepo.save` 曾把 `settings:changed`
 * 写在 `db.transaction` 回调体内（put 之后、commit 之前）。
 * 事务一旦回滚，订阅方（effects.ts 的 applySettingsToDom、graph/themes.ts 的画布主题）
 * 已应用一份**未落库**的设置 = 幽灵状态，且**没有任何行为测试能发现**
 * （emit 载荷本身就是新值，看不出「尚未提交」；jsdom/Dexie 下事务读写顺序对断言不可见）。
 *
 * 故采用**源码结构判据**（与 noteFolderWrites.test.ts 的 TOCTOU 锁同款思路）：
 * 用括号配平精确框出每个 `db.transaction(...)` 区间，断言区内不出现 `eventBus.emit`。
 * 这把「emit 不得进事务体」从约定变成 CI 可拦的锁，并覆盖未来新增的 repositories 写函数。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import 'fake-indexeddb/auto'
import { db } from '@/db/db'
import { eventBus } from '@/shared/eventBus'
import { settingsRepo } from '../localAdmin'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

/** 用括号配平扫出所有 `db.transaction(...)` 的 [start, end] 字符区间（含整个回调体） */
function transactionRanges(src: string): [number, number][] {
  const ranges: [number, number][] = []
  const needle = 'db.transaction('
  let from = 0
  for (;;) {
    const start = src.indexOf(needle, from)
    if (start < 0) break
    // 从 needle 的 `(` 开始做括号配平
    let i = start + needle.length - 1
    let depth = 0
    for (; i < src.length; i++) {
      const ch = src[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
    }
    ranges.push([start, i])
    from = i
  }
  return ranges
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) return e === '__tests__' ? [] : walk(p)
    return /\.ts$/.test(p) ? [p] : []
  })
}

describe('防漂移锁：repositories 层的事件不得写在事务体内（§6.1）', () => {
  it('src/repositories/** 中没有任何 eventBus.emit 落在 db.transaction 区间内', () => {
    const files = walk(path.resolve(process.cwd(), 'src/repositories'))
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('eventBus.emit')) continue
      const ranges = transactionRanges(src)
      let idx = src.indexOf('eventBus.emit')
      while (idx >= 0) {
        const inside = ranges.some(([s, e]) => idx > s && idx < e)
        if (inside) {
          const line = src.slice(0, idx).split('\n').length
          offenders.push(`${path.relative(process.cwd(), file)}:${line} emit 落在事务体内`)
        }
        idx = src.indexOf('eventBus.emit', idx + 1)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * 反向校验（关键）：证明上面的扫描**真的能识别**「emit 在事务体内」这种形状。
   * 拿一段已知错误的源码片段喂给同一判据，必须判定为 inside=true。
   * 若本用例变红，说明判据失效（例如括号配平写错），上面那条绿灯不可信。
   */
  it('反向校验：判据能识别出「事务体内 emit」的错误形状', () => {
    const badSrc = `
      async save() {
        return db.transaction('rw', [db.settings], async () => {
          await db.settings.put({ key: 'singleton' })
          eventBus.emit('settings:changed', { settings: {} })
          return 1
        })
      }
    `
    const goodSrc = `
      async save() {
        const merged = await db.transaction('rw', [db.settings], async () => {
          await db.settings.put({ key: 'singleton' })
          return 1
        })
        eventBus.emit('settings:changed', { settings: merged })
        return merged
      }
    `
    const badRanges = transactionRanges(badSrc)
    const badIdx = badSrc.indexOf('eventBus.emit')
    expect(badRanges.some(([s, e]) => badIdx > s && badIdx < e)).toBe(true)

    const goodRanges = transactionRanges(goodSrc)
    const goodIdx = goodSrc.indexOf('eventBus.emit')
    expect(goodRanges.some(([s, e]) => goodIdx > s && goodIdx < e)).toBe(false)
  })
})

describe('settingsRepo.save 行为：写入生效且事件载荷与库内一致', () => {
  it('保存后库内是新值，且 emit 了 settings:changed（载荷与库内一致）', async () => {
    const emitted: string[] = []
    const orig = eventBus.emit.bind(eventBus)
    eventBus.emit = (event, payload) => {
      if (event === 'settings:changed') {
        emitted.push((payload as { settings: { appearance: { accent: string } } }).settings.appearance.accent)
      }
      orig(event, payload)
    }
    try {
      await settingsRepo.save({ appearance: { accent: 'teal' } })
    } finally {
      eventBus.emit = orig
    }
    expect(emitted).toEqual(['teal'])
    expect((await settingsRepo.get()).appearance.accent).toBe('teal')
  })

  it('段内单字段 patch 不抹掉同段其它字段（既有语义不回退）', async () => {
    await settingsRepo.save({ appearance: { accent: 'teal', radius: 'sharp' } })
    await settingsRepo.save({ appearance: { accent: 'amber' } })
    const after = await settingsRepo.get()
    expect(after.appearance.accent).toBe('amber') // 本次 patch 生效
    expect(after.appearance.radius).toBe('sharp') // 同段其它字段未被抹掉
  })
})
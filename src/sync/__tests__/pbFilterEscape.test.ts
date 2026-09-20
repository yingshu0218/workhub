/**
 * Issue #169 审计 P2-B 回归：PocketBase filter 拼接必须只有一个转义入口
 *
 * 缺陷形状：`pbUpsert` / `pbDeleteRemote` 用 `localId.replace(/'/g, "\\'")` 做了转义，
 * 而增量拉取的 `pbListAll` 直接把 `receivedAt` / `lastId` 内插进 filter 字符串。
 * 两值都来自服务端生成，实际可控注入面很窄 —— 但属**同一件事多种写法**的漂移形状：
 * 只要将来有一处值是用户可控的（例如按标题/标签做服务端搜索），就会成为真实的 filter 注入点。
 *
 * 本文件锁两层：① 转义函数语义正确（含反斜杠先行）；② 源码扫描禁止再出现内联 `replace(/'/g`。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import 'fake-indexeddb/auto'
import { escapePbFilterValue } from '../pocketbaseAdapter'

describe('escapePbFilterValue', () => {
  it('普通值原样返回', () => {
    expect(escapePbFilterValue('2026-09-14 10:00:00.000Z')).toBe('2026-09-14 10:00:00.000Z')
    expect(escapePbFilterValue('')).toBe('')
  })

  it('单引号被转义（防提前闭合字面量）', () => {
    expect(escapePbFilterValue("o'brien")).toBe("o\\'brien")
  })

  it('反斜杠先于单引号转义（顺序错了会多出一层反斜杠）', () => {
    // 若先转单引号，`\'` 会被后一步改写成 `\\'`（PB 端少读一个引号 → 字面量提前闭合）
    expect(escapePbFilterValue('a\\b')).toBe('a\\\\b')
    expect(escapePbFilterValue("a\\'b")).toBe("a\\\\\\'b")
  })

  it('典型注入尝试被中性化，不产生可执行的 filter 片段', () => {
    const evil = "' || id != ''"
    const out = escapePbFilterValue(evil)
    // 所有单引号都已转义 → 无法提前闭合本地字面量
    expect(out).not.toMatch(/(^|[^\\])'/)
  })
})

describe('防漂移锁：filter 值拼接只有一个转义入口', () => {
  it("源码中不再出现内联 replace(/'/g 的 filter 转义", () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/sync/pocketbaseAdapter.ts'), 'utf8')
    const escapeFnBody = src.slice(
      src.indexOf('export function escapePbFilterValue'),
      src.indexOf('\n}', src.indexOf('export function escapePbFilterValue')),
    )
    const inline = src.split('\n').filter(
      (line) =>
        line.includes("replace(/'/g") &&
        !line.trimStart().startsWith('*') &&
        // escapePbFilterValue 自身是实现处，唯一允许出现该表达式的地方
        !escapeFnBody.includes(line),
    )
    expect(inline).toEqual([])
  })

  /**
   * 补锁（摘取 #171 时发现原锁有盲区）：原锁只禁「内联 `replace(/'/g`」这一种**另起写法**，
   * 却抓不到 `pbListAll` 原始缺陷的形态 —— **完全不转义的直接内插**（`'${receivedAt}'`）。
   * 后者比内联转义更糟，却是原锁的漏网之鱼，故按形态特征补一道：
   * 模板里变量后**紧邻**单引号 = 该字面量未经转义就被闭合。正确写法必然是
   * `${escapePbFilterValue(x)}'`（`{` 之后是函数调用，不匹配本模式）。
   */
  it('filter 字面量不得直接内插变量（必须经 escapePbFilterValue 包裹）', () => {
    const offenders = readFileSync(
      path.resolve(process.cwd(), 'src/sync/pocketbaseAdapter.ts'),
      'utf8',
    )
      .split('\n')
      .filter((line) => {
        const t = line.trimStart()
        if (t.startsWith('*') || t.startsWith('//')) return false // 注释里的示例不算
        return /\$\{[A-Za-z_]\w*\}'/.test(line)
      })
    expect(offenders).toEqual([])
  })
})

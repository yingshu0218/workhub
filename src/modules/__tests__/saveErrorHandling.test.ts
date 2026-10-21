/**
 * 防漂移锁：表单抽屉的 `save()` 必须处理落库失败（审计 P1 · 2026-10-21）
 *
 * 缺陷形状：多个抽屉的 `save()` 直接把 `repo.put(...)` 的结果交给 `onClick`，
 * 既无 try/catch 也无法被调用方 await —— 落库失败（配额超限 / 隐私模式 / IndexedDB 被回收）时
 * 用户看到的是「点了保存没反应、抽屉不关」，且**零提示**；同时产生未处理的 Promise rejection。
 *
 * 同类组件出现两种纪律（TransactionFormDrawer 有 catch，其余三个没有），说明
 * 「每个抽屉都记得写」这种约定一定会漂移 —— 故用源码扫描把它变成 CI 可拦的锁：
 * 凡出现 `async function save()` 的组件文件，其 save 函数体内必须出现 `catch`。
 *
 * 判据用**括号配平**框出 save 函数体（不用 indexOf('\n}') —— 函数内出现顶格 `}` 会截断）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) return e === '__tests__' ? [] : walk(p)
    return /\.tsx?$/.test(p) ? [p] : []
  })
}

/** 用括号配平框出 `async function save()` 的函数体（从 `{` 到配对 `}`） */
function saveBody(src: string): string | undefined {
  const start = src.indexOf('async function save()')
  if (start < 0) return undefined
  const braceStart = src.indexOf('{', start)
  if (braceStart < 0) return undefined
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(braceStart, i + 1)
    }
  }
  return src.slice(braceStart)
}

describe('防漂移锁：save() 必须处理落库失败', () => {
  it('凡定义 async function save() 的组件，其 save 体内必须有 catch', () => {
    const files = walk(path.resolve(process.cwd(), 'src/modules'))
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('async function save()')) continue
      const body = saveBody(src)
      if (!body) continue
      if (!/\bcatch\b/.test(body)) {
        offenders.push(path.relative(process.cwd(), file))
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * 反向校验（关键）：证明判据**真的能识别**「无 catch」的形状。
   * 喂一段已知缺 catch 的源码，必须判定为 offender；补上 catch 后必须通过。
   * 若本用例变红，说明判据失效，上面那条绿灯不可信。
   */
  it('反向校验：判据能识别「无 catch 的 save」', () => {
    const bad = `
      async function save() {
        await repo.put({ id: 1 })
        onClose()
      }
    `
    const good = `
      async function save() {
        try {
          await repo.put({ id: 1 })
          onClose()
        } catch (e) {
          setError('x')
        }
      }
    `
    expect(/\bcatch\b/.test(saveBody(bad)!)).toBe(false)
    expect(/\bcatch\b/.test(saveBody(good)!)).toBe(true)
  })
})
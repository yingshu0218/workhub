/**
 * 输入法组合态守卫回归（用例 #44「中文输入法不误触」）
 *
 * 为什么这条要用单测锁而不是端到端脚本：无头浏览器驱动不了**真实系统输入法候选窗口**，
 * 端到端脚本只能构造 KeyboardEvent —— 而真实风险恰好只在「组合态的 Enter 被当成确认」
 * 这一个 bit 上。把这个 bit 的判据收口成纯函数并及时锁住，比反复试浏览器可靠得多
 * （本轮实测：注入的 KeyboardEvent 无法让 Chrome 的后续按键带上 isComposing=true，
 *  所以端到端那条路在原理上就测不到真实 IME）。
 *
 * 另有一条**源码扫描**断言：禁止再出现内联的组合态判据，防止新增输入框时漏掉守卫
 * —— 本项目已多次出现「一处接了、另一处漏了」的缺陷形状（见 D11 / D13）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isImeComposing } from '../ime'

describe('① isImeComposing 判据', () => {
  it('isComposing=true 即视为组合中（标准字段）', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true)
  })

  it('keyCode=229 也视为组合中（部分输入法只给 229，key 可能不是 Enter）', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isImeComposing({ keyCode: 229 })).toBe(true)
  })

  it('普通按键放行（组合中与不组合中的 Enter 必须走不同分支）', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false)
    expect(isImeComposing({ keyCode: 13 })).toBe(false)
  })

  it('缺字段 / 空值不抛错（非键盘来源的事件、老浏览器）', () => {
    expect(isImeComposing({})).toBe(false)
    expect(isImeComposing(null)).toBe(false)
    expect(isImeComposing(undefined)).toBe(false)
  })

  it('isComposing 只认真布尔 true（字符串/数字等脏值不误判为组合中）', () => {
    expect(isImeComposing({ isComposing: 'true' as unknown as boolean })).toBe(false)
    expect(isImeComposing({ isComposing: 1 as unknown as boolean })).toBe(false)
  })
})

describe('② 守卫已收口：源码里不应再有内联的组合态判据', () => {
  const SRC = join(process.cwd(), 'src')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) return walk(p)
      return /\.(ts|tsx)$/.test(name) ? [p] : []
    })

  const files = walk(SRC).filter(
    (f) => !f.endsWith('ime.ts') && !f.includes('__tests__') && !f.endsWith('ime.guard.test.ts'),
  )

  it('不存在 `isComposing` / `keyCode === 229` 的内联判据（一律走 isImeComposing）', () => {
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      text.split('\n').forEach((line, i) => {
        if (/\/\//.test(line) && !/isImeComposing/.test(line)) return // 纯注释行不计
        if (/\.isComposing\b/.test(line) && !/isImeComposing/.test(line)) {
          offenders.push(`${f.replace(SRC, 'src')}:${i + 1}  ${line.trim().slice(0, 90)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('至少 5 个调用点接上了守卫（快捷键/命令面板/笔记提及×2/项目进展/客户小结）', () => {
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('isImeComposing'))
    expect(hits.length).toBeGreaterThanOrEqual(5)
  })
})

// @vitest-environment jsdom
/**
 * 下载实现收口回归（P2 #42）
 *
 * 缺陷形状：全仓 6 处「建 Blob URL → 造 <a> → click → revokeObjectURL」内联写法，
 * 其中 4 处**同步 revoke**（settings 两处导出、trophies 海报、finance 附件下载）。
 * `a.click()` 只是把下载排入队列，浏览器尚未真正读取该 URL 就把 Blob 释放掉 ——
 * Chromium 下读取早已排队完成、看不出问题，**Safari / WebKit 下则下载中断或 0 字节**。
 *
 * 本测试锁三条：
 *   ① 释放必须是**延时**的（不在 click 之后同步执行）—— 这条就是缺陷本身；
 *   ② 锚点在**点击时已在 DOM 中**（Safari 不保证游离节点的 click 触发下载），延时后移除；
 *   ③ **源码扫描**：除 `shared/download.ts` 外不得再出现内联 revoke，
 *      且导出/下载入口必须走同一实现（防新增导出时又抄一份）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { downloadBlob, downloadText, REVOKE_DELAY_MS } from '../download'

describe('① downloadBlob 的释放时机与锚点处理', () => {
  let created: string[]
  let revoked: string[]
  let blobs: Blob[]
  let downloadInDom: (boolean | undefined)[]
  let names: (string | undefined)[]
  let origCreate: unknown
  let origRevoke: unknown
  let clickSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    created = []
    revoked = []
    blobs = []
    downloadInDom = []
    names = []
    let n = 0
    origCreate = (URL as unknown as Record<string, unknown>).createObjectURL
    origRevoke = (URL as unknown as Record<string, unknown>).revokeObjectURL
    ;(URL as unknown as Record<string, unknown>).createObjectURL = (b: Blob) => {
      const u = `blob:test/${++n}`
      created.push(u)
      blobs.push(b)
      return u
    }
    ;(URL as unknown as Record<string, unknown>).revokeObjectURL = (u: string) => {
      revoked.push(u)
    }
    // 点击那一刻锚点是否已在 DOM 中（Safari 兼容性断言）。
    // 注意：jsdom 里 `click()` 定义在 HTMLElement.prototype 上，锚点只是继承它，
    // 直接 spy HTMLAnchorElement.prototype.click 会因属性不存在而抛错。
    clickSpy = vi
      .spyOn(HTMLElement.prototype, 'click')
      .mockImplementation(function (this: HTMLElement) {
        if (this instanceof HTMLAnchorElement) {
          downloadInDom.push(document.body.contains(this))
          names.push(this.download)
        }
      })
  })

  afterEach(() => {
    clickSpy?.mockRestore()
    vi.useRealTimers()
    ;(URL as unknown as Record<string, unknown>).createObjectURL = origCreate
    ;(URL as unknown as Record<string, unknown>).revokeObjectURL = origRevoke
    document.body.innerHTML = ''
  })

  it('click 之后不得同步释放对象 URL（同步释放正是本缺陷）', () => {
    downloadBlob(new Blob(['x']), 'a.txt')
    expect(created).toEqual(['blob:test/1'])
    expect(revoked).toEqual([]) // ← 核心：此刻释放，Safari 还没开始读
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoked).toEqual(['blob:test/1'])
  })

  it('锚点在点击时已在 DOM 中，并在延时后从 DOM 移除', () => {
    downloadBlob(new Blob(['x']), 'a.txt')
    expect(downloadInDom).toEqual([true])
    expect(document.querySelectorAll('a[download]').length).toBe(1)
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(document.querySelectorAll('a[download]').length).toBe(0)
  })

  it('文件名与 href 指向本次创建的对象 URL', () => {
    downloadBlob(new Blob(['x']), '凭证-2026.png')
    expect(names).toEqual(['凭证-2026.png'])
    expect(created).toHaveLength(1)
  })

  it('定时器未到期前不释放、到期后只释放一次（不重复 revoke）', () => {
    downloadBlob(new Blob(['x']), 'a.txt')
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1)
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(1)
    expect(revoked).toEqual(['blob:test/1'])
    vi.advanceTimersByTime(REVOKE_DELAY_MS * 2)
    expect(revoked).toEqual(['blob:test/1'])
  })

  it('downloadText 走同一路径并保留 MIME（CSV 的 BOM 由调用方写在内容里）', () => {
    downloadText('\uFEFFa,b\n1,2\n', 'text/csv;charset=utf-8', 'x.csv')
    expect(blobs[0].type).toBe('text/csv;charset=utf-8')
    expect(names).toEqual(['x.csv'])
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoked).toHaveLength(1)
  })
})

describe('② 已收口：源码里不应再有内联的对象 URL 释放', () => {
  const SRC = join(process.cwd(), 'src')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) return walk(p)
      return /\.(ts|tsx)$/.test(name) ? [p] : []
    })

  /**
   * ⚠️ 源码内容**在模块作用域只读一次**（审计 P1：此前两个 `it` 各遍历读一遍 ~240 个文件，
   * 全量并发时 I/O 争用把用例拖过 5s 默认阈值 → flaky 红灯；单跑因无争用而通过）。
   * 键为相对路径（用于报错定位），值为文件内容。
   */
  const sources: [string, string][] = walk(SRC)
    .filter((f) => !f.endsWith('download.ts') && !f.includes('__tests__'))
    .map((f) => [f, readFileSync(f, 'utf8')])

  it('除 shared/download.ts 外，没有任何文件直接调用 URL.revokeObjectURL', () => {
    const offenders: string[] = []
    for (const [f, text] of sources) {
      text.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // 注释行不计
        if (/URL\s*\.\s*revokeObjectURL/.test(line)) {
          offenders.push(`${f.replace(SRC, 'src')}:${i + 1}  ${line.trim().slice(0, 90)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('至少 5 个导出/下载入口接上了统一实现（settings / trophies / finance / notes ×2）', () => {
    const hits = sources.filter(([, text]) => /from '@\/shared\/download'/.test(text))
    expect(hits.length).toBeGreaterThanOrEqual(5)
  })
})

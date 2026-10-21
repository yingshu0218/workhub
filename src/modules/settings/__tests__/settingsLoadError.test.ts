// @vitest-environment jsdom
/**
 * 设置读取失败必须「不静默」回归锁（审计 C-4 同类形态 · 2026-10-21）
 *
 * ## 背景（真机验证发现的真实缺陷）
 *
 * `SettingsPage` 的初始化原为 `settingsRepo.get().then(...)` —— **只有 `.then`，没有 `.catch`**。
 * 一旦读取失败（IndexedDB 被浏览器阻断 / 隐私模式 / 配额耗尽 / 库损坏），
 * Promise 永不 resolve → 整页**永久停在「设置载入中…」**，且没有任何错误提示。
 *
 * 这是本仓明确忌讳的「静默失败」形态（与 `saveErrorHandling.test.ts` 拦的
 * 「保存失败零提示」是同族问题：**失败必须可见**）。
 *
 * 发现过程值得留档：拆分 SettingsPage 后做真机验证时，`/settings` 一直显示「设置载入中…」，
 * 而 `/todo` `/crm` `/finance` 都正常。对照正式站（拆分前版本）**同样如此** →
 * 说明**不是本轮拆分引入**，而是既有缺陷被真机验证顺带暴露（单测从没覆盖过这条路径）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = readFileSync(
  path.resolve(process.cwd(), 'src/modules/settings/SettingsPage.tsx'),
  'utf8',
)

describe('设置初始化：读失败不得静默卡住', () => {
  /**
   * ⚠️ 判据要取**调用点**而非首次出现（`settingsRepo` 首次出现在 import 行 ——
   * 我在写这条锁时就踩了这个坑：片段里根本没有调用链，于是断言必然失败）。
   */
  /**
   * ⚠️ 片段必须**只切到 `settingsRepo` 那条链**为止 —— 变异校验实测：
   * 若向后取 900 字符，会把后面 `navigator.storage.persisted().catch(...)` 一并纳入，
   * 于是「删掉 settingsRepo 的 catch」也会因为别处的 catch 而**假绿**（已复现）。
   * 故以「下一条语句 `if (navigator.storage`」为右边界切分。
   */
  const callSite = () => {
    const i = SRC.indexOf('settingsRepo\n      .get()')
    expect(i).toBeGreaterThan(-1) // 应存在「settingsRepo 换行 .get()」的调用形态
    const j = SRC.indexOf('if (navigator.storage', i)
    expect(j).toBeGreaterThan(i)
    return SRC.slice(i, j)
  }

  it('settingsRepo.get() 调用链必须带 .catch', () => {
    expect(callSite()).toMatch(/\.catch\(/)
  })

  it('失败时回落到默认值并设置可见错误（loadError）', () => {
    const seg = callSite()
    expect(seg).toContain('DEFAULT_SETTINGS') // 回落默认值：界面仍可用
    expect(seg).toContain('setLoadError') // 可见错误：不静默
    expect(SRC).toMatch(/\{loadError &&/) // 且真的渲染出来（不只是设了 state）
  })

  it('反向校验：判据能识别「只有 then 没有 catch」的错误形态', () => {
    const bad = `void settingsRepo.get().then((s) => { setSettings(s) })`
    const good = `void settingsRepo.get().then((s) => { setSettings(s) }).catch((e) => { setLoadError(e) })`
    expect(/\.catch\(/.test(bad)).toBe(false)
    expect(/\.catch\(/.test(good)).toBe(true)
  })
})
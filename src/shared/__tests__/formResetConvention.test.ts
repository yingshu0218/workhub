/**
 * 防漂移锁：弹层表单的「打开时重置」不得再手写（收口 C-10 · 2026-10-21）
 *
 * ## 为什么要有这条锁
 *
 * 本仓原有 **7 处**手写同一套「渲染期重置」骨架 ——
 * `const openKey` + `const [lastKey, setLastKey]` + `if (openKey !== lastKey) { setLastKey(...) ... }`。
 *
 * 抄 7 遍的后果不是「难看」，而是**细节已经漂移**（key 拼法各异、有没有 `if (open)`、
 * 有没有 `seedKey` 各不相同）。更要命的是**没有任何测试挡住新代码再抄一遍** ——
 * 本仓这类「同源实现各自演化」已多次发生（`Toggle` 两份、`Segmented` 两份、
 * `StatCard` 两份、实体摘要卡两份）。故这次不仅要收口，还要把口**锁住**。
 *
 * ## ⚠️ 判据必须查「特征」，不能查「有没有 useFormReset 字样」
 *
 * 初版判据是「出现 `openKey` 但没出现 `useFormReset`」→ **变异校验直接打回**：
 * 我在变异时保留了 `useFormReset` 字样（因为要维持 `seedKey` 变量），判据就被满足了，
 * **抓不住回退**。这类「判据查手段而非查特征」的错误在本仓已反复出现，故此处明确记为反例。
 *
 * 现判据查**手写的两个必要件同时出现**：
 * ① `const [lastKey, setLastKey] = useState('')` —— 上一次 key 的 state
 * ② `if (openKey !== lastKey)` —— 渲染期比较
 *
 * 收口后这两件都不再出现在业务文件里（由 hook 内部持有），
 * 与「文件里有没有 `useFormReset` 字样」无关 —— 那只是手段，不是特征。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** 扫描范围：所有含 UI 的源码目录（弹层可能出现在任何模块） */
const SCAN_DIRS = ['src/modules', 'src/app', 'src/shared', 'src/design-system']

/**
 * 允许「手写重置骨架」的例外（相对仓库根的路径 → 理由）。
 *
 * ⚠️ 目前**只有一处**，且理由明确；如要新增必须在此署名（见下方「例外表必须写理由」用例）。
 */
const ALLOWED: Record<string, string> = {
  'src/shared/useFormReset.ts':
    '**hook 自身的实现处** —— 它是这套骨架的唯一合法归属地（判据要找的「手写特征」正是它实现的东西）。' +
    '这里必须直写 lastKey state 与渲染期比较，逻辑上不可能「再走 useFormReset」。',
  'src/modules/todo/TodoFormDrawer.tsx':
    '待办表单的重置块（2026-10-26 随组件从 TodoPage.tsx 拆出，路径随迁、语义未变）服务于**待办新建/编辑表单**；' +
    '当前收口范围只含 5 个 *FormDrawer + GroupEditorDrawer，其语义与 useFormReset 一致但未纳入。' +
    '⚠️ 保留此条是为了「不假装已收口」——后续若一并收口，应同步删除本条。',
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) return e === '__tests__' ? [] : walk(p)
    return /\.tsx?$/.test(p) ? [p] : []
  })
}

/** 手写重置骨架的特征：① lastKey state ② openKey 与 lastKey 的渲染期比较 */
function hasHandwrittenReset(src: string): boolean {
  const hasLastKeyState = /const \[lastKey, setLastKey\] = useState\(/.test(src)
  const hasKeyCompare = /if \(openKey !== lastKey\)/.test(src)
  return hasLastKeyState && hasKeyCompare
}

describe('防漂移锁：弹层重置骨架不得再手写', () => {
  it('无未署名的手写重置骨架（新增必须署名）', () => {
    const root = process.cwd()
    const offenders: string[] = []
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.resolve(root, dir))) {
        const rel = path.relative(root, file)
        if (ALLOWED[rel]) continue
        if (hasHandwrittenReset(readFileSync(file, 'utf8'))) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * 反向校验（关键）：证明判据真能区分「手写」与「已收口」。
   * 若本用例变红，说明上面那条绿灯不可信（判据失效）。
   */
  it('反向校验：判据能识别手写（含混入 useFormReset 字样的变体）', () => {
    const handwritten = [
      '  const openKey = `${open}-x`',
      "  const [lastKey, setLastKey] = useState('')",
      '  if (openKey !== lastKey) { setLastKey(openKey) }',
    ].join('\n')
    const migrated = [
      '  const openKey = `${open}-x`',
      '  const { seedKey } = useFormReset(openKey, open, () => {})',
    ].join('\n')
    // ★ 关键变体：文件里**也出现了 useFormReset 字样**，但骨架仍是手写 → 必须仍被点名
    const mixed = `${handwritten}\nvoid useFormReset // 混入字样也照样点名`

    expect(hasHandwrittenReset(handwritten)).toBe(true)
    expect(hasHandwrittenReset(migrated)).toBe(false)
    expect(hasHandwrittenReset(mixed)).toBe(true)
    expect(hasHandwrittenReset('const x = 1')).toBe(false)
  })

  it('例外表每条都必须写明实质理由（防止「加个 key 就放行」）', () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(file).toMatch(/^src\//)
      expect(reason.length).toBeGreaterThan(30)
    }
  })
})
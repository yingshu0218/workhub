/**
 * 图标完整性校验（CI 前置拦截）
 *
 * 背景：Icon 组件在图标缺失时静默渲染为空白（构建/lint 全绿），
 * 已多次出现「按钮/入口隐形」类问题（person_off、radio_button_unchecked、list/today…）。
 *
 * 做法：静态扫描 src/ 下所有 `Icon name="x"` / `icon="x"` / `icon: 'x'` 用法，
 * 与 src/assets/icons/*.svg 的可用集合比对，任一缺失即退出码 1。
 *
 * 用法：node scripts/check-icons.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// 注意：必须用 fileURLToPath 解码，直接用 new URL(...).pathname 会把中文路径
// 变成 %E5%B7%A5... 形式，导致在含中文的目录下 readdirSync 报 ENOENT
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const ICON_DIR = join(SRC, 'assets', 'icons')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const available = new Set(
  readdirSync(ICON_DIR)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.replace(/\.svg$/, '')),
)

/** 收集源码中引用的图标名（含 -fill 变体：fill 变体缺失时回落到基础名，故两者都算命中） */
const used = new Map() // name -> [file:line]
const patterns = [
  /name="([a-z0-9_]+)"/g,
  /\bicon="([a-z0-9_]+)"/g,
  /\bicon:\s*'([a-z0-9_]+)'/g,
]
// 表达式形态：name={cond ? 'call_made' : 'call_received'} / icon={x || 'expand_more'}。
// 静态字面量正则扫不到三元/短路表达式里的图标名，曾漏掉 call_made/call_received
// 这类「行内图标整体隐形」的问题；这里把 {} 表达式内的字符串字面量也纳入扫描。
const exprPatterns = [/\bname=\{([^}]*)\}/g, /\bicon=\{([^}]*)\}/g]
const stringLiteral = /'([a-z0-9_]+)'/g
/**
 * 图标名**常量数组**：`export const HABIT_ICONS = ['a','b',…]`。
 *
 * 这类名字不经过 `Icon name=/icon=` 属性，而是运行时被 `icon={state}` 间接喂进去 ——
 * 上面的正则**整类扫不到**。实测后果：`HABIT_ICONS` 里的 `briefcase` / `brain`
 * 长期没有对应 SVG，用户在习惯表单选中即**渲染成空白**，而构建、lint、测试全绿
 * （2026-10-21 补工具测试时被顺带撞出来）。故按整块扫，跨多行也覆盖。
 */
const iconSetDecl = /export const [A-Z0-9_]*ICONS?\s*=\s*\[([\s\S]*?)\]/g

/** 偏移量 → 行号（1 基），用于报错定位 */
function lineOf(src, index) {
  let line = 1
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === '\n') line += 1
  return line
}

for (const file of walk(SRC)) {
  if (file.endsWith('Icon.tsx')) continue
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')

  // ① 图标名常量数组（跨行，必须在整文件上扫，逐行扫不到）
  iconSetDecl.lastIndex = 0
  for (const m of src.matchAll(iconSetDecl)) {
    for (const lit of m[1].matchAll(stringLiteral)) {
      const name = lit[1]
      if (!used.has(name)) used.set(name, [])
      used.get(name).push(`${relative(ROOT, file)}:${lineOf(src, m.index)}`)
    }
  }

  // ② 属性与表达式形态（原逻辑，逐行）
  lines.forEach((line, i) => {
    for (const re of patterns) {
      re.lastIndex = 0
      for (const m of line.matchAll(re)) {
        const name = m[1]
        if (!used.has(name)) used.set(name, [])
        used.get(name).push(`${relative(ROOT, file)}:${i + 1}`)
      }
    }
    for (const re of exprPatterns) {
      re.lastIndex = 0
      for (const m of line.matchAll(re)) {
        stringLiteral.lastIndex = 0
        for (const lit of m[1].matchAll(stringLiteral)) {
          const name = lit[1]
          if (!used.has(name)) used.set(name, [])
          used.get(name).push(`${relative(ROOT, file)}:${i + 1}`)
        }
      }
    }
  })
}

const missing = []
for (const [name, refs] of used) {
  const base = name.replace(/-fill$/, '')
  if (available.has(name) || available.has(base)) continue
  missing.push({ name, refs })
}

if (missing.length) {
  console.error(`\n❌ 发现 ${missing.length} 个缺失图标（会静默渲染为空白）：\n`)
  for (const { name, refs } of missing.sort((a, b) => a.name.localeCompare(b.name))) {
    console.error(`  • ${name}`)
    for (const ref of refs) console.error(`      ${ref}`)
  }
  console.error(
    '\n修复：从 node_modules/@material-symbols/svg-400/rounded/<name>.svg 拷贝到 src/assets/icons/\n',
  )
  process.exit(1)
}

/**
 * 反向报告（审计 C-13 的配套工具 · 2026-10-21）：`--report-unused`
 * 列出**未被任何源码引用的可用图标**（只报告、不失败，退出码仍为 0）。
 *
 * ⚠️ 为什么只做「报告」而不自动删：
 * 静态扫描**扫不到数据驱动的图标名** —— 例如奖杯图标来自 `db/seed.ts` 的
 * `trophies[].icon` 字段（`psychology` / `handshake` …），而 `<Icon name={t.icon} />`
 * 传的是变量。删图标前必须**同时核对数据源**，否则会删掉运行时真正用到的图标
 * （而缺失时 Icon 组件**静默渲染空白**，只有肉眼能发现）。
 * 另经实测：241 个图标 gzip 后仅 ~31KB，删除全部未引用项收益约 **3.6%**（主包 gzip），
 * 与「误删导致静默空白」的风险不对等 —— 故本仓库**不做图标清理**，只留这个核对工具。
 */
if (process.argv.includes('--report-unused')) {
  const unused = [...available]
    .filter((n) => !used.has(n) && !used.has(n.replace(/-fill$/, '')))
    .sort()
  if (unused.length === 0) {
    console.log('✅ 无未引用图标（全部可用图标都被源码引用）')
  } else {
    console.log(`\nℹ️ 未被源码引用的可用图标 ${unused.length} 个（**候选清单，勿直接删**）：\n`)
    for (const n of unused) console.log(`  • ${n}`)
    console.log(
      '\n⚠️ 删除前必须核对「数据驱动的图标名」（如 db/seed.ts 的 trophies[].icon、' +
        '模块配置里的图标字段）——静态扫描看不到它们，误删会静默渲染空白。\n',
    )
  }
}

console.log(`✅ 图标校验通过：${used.size} 个引用全部存在（可用图标 ${available.size} 个）`)

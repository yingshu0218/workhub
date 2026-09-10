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

const ROOT = new URL('..', import.meta.url).pathname
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
for (const file of walk(SRC)) {
  if (file.endsWith('Icon.tsx')) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const re of patterns) {
      re.lastIndex = 0
      for (const m of line.matchAll(re)) {
        const name = m[1]
        if (!used.has(name)) used.set(name, [])
        used.get(name).push(`${relative(ROOT, file)}:${i + 1}`)
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

console.log(`✅ 图标校验通过：${used.size} 个引用全部存在（可用图标 ${available.size} 个）`)

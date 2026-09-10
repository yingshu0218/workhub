#!/usr/bin/env node
/**
 * skill / MCP tools schema 生成器 —— 方案 §五 / §10.1（P1 第 6 步）
 *
 * 单源原则：skill 文档与 MCP tools schema **都由 `src/agent/skillSource.ts`（即 agentOps 的 zod schema）生成**。
 * 任何工具改动只需改 zod 一处，跑本脚本即同步文档与 schema，杜绝「实现 / 文档 / MCP schema」三份漂移。
 *
 * 产出：
 *   docs/skills/README.md          —— 工具总览 + 协议与安全说明（Agent 推理上下文入口）
 *   docs/skills/<tool>.md          —— 每个工具一份（参数 + 副作用 + 风险级 + 幂等 + 关联规则 + 示例）
 *   docs/skills/mcp-tools.json     —— MCP `tools/list` 的静态快照（供离线 Agent / 校验用）
 *
 * 用法：node scripts/gen-skills.mjs
 */
import { build } from 'esbuild'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(dirname, '..')
const outDir = path.join(root, 'docs', 'skills')

/** 用 esbuild 把 TS 单源打包成可 import 的 ESM（带 @ 别名），再动态载入 */
async function loadSkillSource() {
  const tmp = path.join(root, `node_modules/.cache-workhub-skill-${process.pid}.mjs`)
  await build({
    entryPoints: [path.join(root, 'src/agent/skillSource.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: tmp,
    logLevel: 'silent',
    alias: { '@': path.join(root, 'src') },
  })
  const mod = await import(pathToFileURL(tmp).href)
  await rm(tmp, { force: true })
  return mod
}

/** 极简 zod → JSON Schema（与 src/agent/jsonSchema.ts 同口径；生成器内联避免二次打包） */
function zodToJsonSchema(schema) {
  const def = schema?._def ?? {}
  const t = def.typeName ?? def.type ?? 'ZodUnknown'
  if (['ZodOptional', 'ZodNullable', 'ZodReadonly', 'ZodBranded', 'ZodCatch'].includes(t)) {
    return zodToJsonSchema(def.innerType)
  }
  if (t === 'ZodDefault') {
    const inner = zodToJsonSchema(def.innerType)
    try {
      const dv = def.defaultValue()
      if (dv !== undefined) return { ...inner, default: dv }
    } catch {
      /* ignore */
    }
    return inner
  }
  if (t === 'ZodEffects') {
    const inner = zodToJsonSchema(def.schema)
    return schema.description ? { ...inner, description: schema.description } : inner
  }
  if (t === 'ZodObject') {
    const shape = typeof schema.shape === 'function' ? schema.shape() : schema.shape
    const properties = {}
    const required = []
    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(val)
      const ct = val?._def?.typeName ?? val?._def?.type
      if (ct !== 'ZodOptional' && ct !== 'ZodDefault') required.push(key)
    }
    const out = { type: 'object', properties }
    if (required.length) out.required = required
    return out
  }
  if (t === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) }
  if (t === 'ZodEnum') return { type: 'string', enum: [...def.values] }
  if (t === 'ZodNativeEnum') {
    const values = Object.values(def.values)
    const allString = values.every((v) => typeof v === 'string')
    return { type: allString ? 'string' : 'number', enum: values }
  }
  if (t === 'ZodLiteral') {
    const vt = typeof def.value === 'string' ? 'string' : typeof def.value === 'number' ? 'number' : 'boolean'
    return { type: vt, enum: [def.value] }
  }
  if (t === 'ZodUnion') {
    const values = def.options.map((o) => o._def?.value)
    const allString = values.every((v) => typeof v === 'string')
    return { type: allString ? 'string' : 'number', enum: values }
  }
  if (t === 'ZodString') return { type: 'string' }
  if (t === 'ZodNumber' || t === 'ZodBigInt') return { type: 'number' }
  if (t === 'ZodBoolean') return { type: 'boolean' }
  if (t === 'ZodDate') return { type: 'string', format: 'date' }
  return {}
}

/** 把 JSON Schema 渲染成 markdown 参数表 */
function paramsTable(schema) {
  const props = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const rows = Object.entries(props).map(([name, v]) => {
    const type = v.enum ? `enum(${v.enum.join(' / ')})` : v.type ?? (v.anyOf ? 'anyOf' : '?')
    const defv = v.default === undefined ? '—' : `\`${JSON.stringify(v.default)}\``
    return `| \`${name}\` | ${type} | ${required.has(name) ? '是' : '否'} | ${defv} | ${v.description ?? ''} |`
  })
  if (!rows.length) rows.push('| — | — | — | — | 无入参 |')
  return ['| 参数 | 类型 | 必填 | 默认 | 说明 |', '|---|---|---|---|---|', ...rows].join('\n')
}

function renderToolDoc(t, meta) {
  const inputSchema = zodToJsonSchema(t.schema)
  const risk = meta.TOOL_RISK[t.name] ?? 'low'
  const domain = meta.TOOL_DOMAIN[t.name] ?? 'unknown'
  const events = (meta.TOOL_EVENTS ?? {})[t.name] ?? []
  return `# \`${t.name}\`

> 域：\`${domain}\` · 风险级：**${risk}** · ${t.readOnly ? '读工具（只读，不产事件）' : '写工具'}

## 能力

${t.summary}

## 参数

${paramsTable(inputSchema)}

## 副作用

${t.sideEffect}

## 事件

${events.length ? events.map((e) => `- \`${e}\``).join('\n') : '本工具不产生领域事件。'}

## 幂等语义

${t.idempotency}

## 实体引用规则

${t.entityRule}

## 典型说法

${t.examples.map((e) => `- 「${e}」`).join('\n')}

## 确认流程

${risk === 'medium' ? '中风险：先以本参数向用户转述并取得确认；用户确认后携带 relay 签发的一次性 `confirmToken` 再次调用本工具。' : '低风险：直接执行，结果可撤销（undo）。'}

---
_本文件由 \`scripts/gen-skills.mjs\` 从 \`src/agent/skillSource.ts\`（agentOps zod schema）自动生成，请勿手改。_
`
}

function renderReadme(meta) {
  const all = meta.ALL_TOOL_SKILLS
  const rows = all
    .map((t) => {
      const risk = meta.TOOL_RISK[t.name] ?? 'low'
      const domain = meta.TOOL_DOMAIN[t.name] ?? 'unknown'
      return `| [\`${t.name}\`](./${t.name}.md) | ${domain} | ${risk} | ${t.summary} |`
    })
    .join('\n')
  return `# 寻鸽工作台 · Agent skill（P1 首版）

> ⚠️ **自动生成**：由 \`scripts/gen-skills.mjs\` 从 \`src/agent/skillSource.ts\`（agentOps zod schema）生成，
> 与 MCP \`tools/list\` 的 \`inputSchema\` **同源一份定义**（方案 §五 / §10.1）。请勿手改本目录。

## 怎么用

- 本目录写给**外部 Agent 的推理上下文**：每个工具的参数、副作用、风险级、幂等语义、关联规则与示例；
- 机器校验用 \`mcp-tools.json\`（等价于运行期 MCP \`tools/list\` 的静态快照）；
- 运行期以 \`tools/list\` 返回的**实际工具清单**为准——**能力白名单关闭的域，工具不会出现**（方案 §四.3）。

## 协议与安全边界

- 桥只暴露**标准 MCP**（\`tools/list\` + \`tools/call\`），不定义私有协议；
- relay 只监听 \`127.0.0.1\`，Agent 连接必须携带 relay 启动时生成的 **token**；
- **relay 不是安全边界**：真正的防线是 agentOps 的 zod 校验 + 风险分级 + confirmToken + 白名单；
- relay 是**通道、不持有数据**：权威数据在浏览器 IndexedDB，agentOps 在页面进程内执行。

## 工具总览（${all.length} 个）

| 工具 | 域 | 风险 | 能力 |
|---|---|---|---|
${rows}

## 通用纪律

1. **实体引用先消解**：人名/公司名/账本名等一律先调 \`resolveEntity\`；候选不唯一必须**反问用户**，禁止猜 id；
2. **写工具只接受消解后的 id**：字符串关联会被拒绝（可操作错误）；
3. **中风险先确认**：调用前先向用户转述参数，取得确认后再携带 \`confirmToken\` 执行；
4. **读工具有限幅**：返回条数与字段受白名单约束，超限会置 \`truncated: true\`；
5. **事件永在事务 commit 之后**：写工具触发的领域事件由 repositories 层统一发出，Agent 无需手动补发。
`
}

async function main() {
  const meta = await loadSkillSource()
  await mkdir(outDir, { recursive: true })
  const tools = []
  for (const t of meta.ALL_TOOL_SKILLS) {
    const inputSchema = zodToJsonSchema(t.schema)
    const risk = meta.TOOL_RISK[t.name] ?? 'low'
    const domain = meta.TOOL_DOMAIN[t.name] ?? 'unknown'
    await writeFile(path.join(outDir, `${t.name}.md`), renderToolDoc(t, meta), 'utf8')
    tools.push({
      name: t.name,
      description: t.summary,
      inputSchema,
      annotations: { risk, domain, readOnly: Boolean(t.readOnly) },
      events: (meta.TOOL_EVENTS ?? {})[t.name] ?? [],
    })
  }
  await writeFile(path.join(outDir, 'README.md'), renderReadme(meta), 'utf8')
  await writeFile(
    path.join(outDir, 'mcp-tools.json'),
    JSON.stringify(
      {
        generatedBy: 'scripts/gen-skills.mjs',
        source: 'src/agent/skillSource.ts',
        protocolVersion: '2024-11-05',
        toolCount: tools.length,
        tools,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )
  process.stdout.write(`[gen-skills] 已生成 ${tools.length} 个工具 → docs/skills/（含 README.md 与 mcp-tools.json）\n`)
}

main().catch((e) => {
  process.stderr.write(`[gen-skills] 失败：${e?.stack ?? e}\n`)
  process.exit(1)
})

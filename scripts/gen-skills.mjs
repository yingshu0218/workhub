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
import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { MCP_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '../relay/mcp-relay.mjs'

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

/**
 * 复用**运行期同一份**实现（`src/agent/jsonSchema.ts`），在 loadSkillSource() 后注入。
 *
 * 这里曾经是一份内联的简化拷贝，注释写着「与 src/agent/jsonSchema.ts 同口径」，
 * 但运行期修好 union 分支后它没跟 —— 直接后果是 `fin_recordTransaction` 的 6 个关联字段
 * 被生成成 `{type:'number',enum:[null,null]}`（运行期真相是 `anyOf: [string, array]`），
 * skill 文档与 mcp-tools.json 双双失真。故改为共用同一个函数，不再维护第二份。
 */
let zodToJsonSchema = null

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
  const inputSchema = zodToJsonSchema(t.name, t.schema)
  const risk = meta.TOOL_RISK[t.name] ?? 'low'
  const domain = meta.TOOL_DOMAIN[t.name] ?? 'unknown'
  const events = (meta.TOOL_EVENTS ?? {})[t.name] ?? []
  const personalPrefix = /^(cancel_operation|resolve_contacts|resolve_topics|search_activities|get_activity|get_operation|list_operations|get_contact_context|query_tasks|query_finance|get_record|query_graph|preview_|commit_)/.test(t.name)
  const isPreviewCommand = t.name.startsWith('preview_')
  const isCommitCommand = t.name.startsWith('commit_')
  const isCancelCommand = t.name === 'cancel_operation'
  const isLegacyWrite = !personalPrefix && /^(fin|crm|todo|project|note|link)_/.test(t.name) && !t.readOnly
  const requestGuide = isPreviewCommand
    ? '必填顶层字段 requestId 与 generation；requestId 在本客户端和当前世代内固定绑定完整输入。结果未知先按原 requestId 查回执，不要换号重录。'
    : isCommitCommand
      ? '必填顶层字段 requestId、generation、previewId；confirmToken 由 relay 的 confirm_preview 签发并在 MCP 入参中随 commit 提交。四项都必须来自同一客户端、同一原预览。'
      : isCancelCommand
        ? '用原待确认操作的 requestId 与 generation；仅该预览发起客户端可撤回，不能撤回已提交操作。'
        : isLegacyWrite
          ? '低风险直接写入在首次调用前必须提供稳定 requestId 与当前 generation。中/高风险首次预览若缺少这两项，服务端可补齐并返回实际值；之后的取票、查询回执与重试必须沿用原参数及返回的 requestId/generation。改变意图使用新 requestId 并重新预览。'
          : personalPrefix && t.readOnly
            ? '只读请求按当前凭据的授权范围执行。分页或分段续读沿用响应给出的 generation、revision、watermark、nextCursor 等原上下文；上下文失效时重新查询。'
            : ''
  const argumentExamples = (t.inputExamples ?? []).map((example) =>
    `### ${example.label}\n\n\`\`\`json\n${JSON.stringify(example.args, null, 2)}\n\`\`\`${example.note ? `\n\n${example.note}` : ''}`,
  )
  const commitPreviewTool = t.name.replace(/^commit_/, 'preview_')
  const confirmGuide = isPreviewCommand
    ? '预览工具本身不提交业务事实，但会保存待确认计划。先检查完整 changes/影响，并按返回的 `confirmHint.args` 请求用户确认、取票和调用对应 `commit_*`。'
    : isCommitCommand
      ? `提交工具的执行权限为 ${risk}。先调用对应的 \`${commitPreviewTool}\`，向用户转述具体计划并取得确认，再按预览返回的 \`confirmHint.args\` 调用 \`confirm_preview\`，最后带原 requestId/generation/previewId 和一次性 confirmToken 重试本工具。`
      : isCancelCommand
        ? '撤回只作用于本客户端自己的待确认操作，不需要确认票；执行前核对原 requestId 与 generation。'
        : risk === 'medium' || risk === 'high'
          ? `${risk === 'high' ? '高' : '中'}风险：首次调用只返回预览。向用户转述该次预览中的参数与实际影响并取得确认；随后按返回的 \`confirmHint.args\` 调用 \`confirm_preview\`，再用同一业务参数和 relay 返回的一次性 \`confirmToken\` 重试。不要自行重建 hint。`
          : '低风险：可直接调用。远程写操作仍须使用稳定 requestId/generation；结果未知先查询原回执再决定是否重试。'
  return `# \`${t.name}\`

> 域：\`${domain}\` · 风险级：**${risk}** · ${t.readOnly ? '读工具（只读，不产事件）' : '写工具'}

## 能力

${t.summary}

## 参数

${paramsTable(inputSchema)}
${t.parameterGuide ? `\n## 参数使用说明\n\n${t.parameterGuide}\n` : ''}${requestGuide ? `\n## 请求上下文与权限\n\n${requestGuide} 工具目录只描述可发现能力；服务端会按 Agent 凭据能力、部署白名单、数据世代和客户端身份逐请求授权。工具可见不代表调用获准。\n` : ''}${argumentExamples.length ? `\n## MCP 入参示例\n\n${argumentExamples.join('\n\n')}\n` : ''}

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

${confirmGuide}

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
  return `# 寻鸽工作台 · Agent 工具目录

> ⚠️ **自动生成**：由 \`scripts/gen-skills.mjs\` 从 \`src/agent/skillSource.ts\`（agentOps zod schema）生成，
> 与业务工具的公共 \`inputSchema\` **同源一份定义**。请勿手改本目录；入参示例仅用于说明，不是额外权限。

## 怎么用

- 本目录写给**外部 Agent 的推理上下文**：工具 schema、作用、副作用、重试和参数示例；
- 机器校验用 \`mcp-tools.json\`（只含业务工具的生成快照）；
- Relay 在运行期另加入 \`confirm_preview\`。MCP 清单受部署策略影响，当前测试站已核对为 57 个业务工具 + \`confirm_preview\`；实际每次调用仍由服务端逐请求检查客户端凭据与能力。目录可见或清单中出现都不代表已获执行权限。

## 协议与安全边界

- 新接入使用标准 **MCP Streamable HTTP**：\`POST <url>/relay/mcp\`，请求携带 \`Authorization: Bearer <独立 token>\`；无需本地仓库或浏览器在线；
- 个人数据权威在自托管 VPS 的 PocketBase。客户端有界镜像用于客户端缓存，不是服务端权威；
- 独立凭据由拥有者按客户端签发，服务端按请求校验 token 散列、能力、部署域与恢复世代；每个客户端可单独撤销；
- 常规列表与搜索限幅并返回截断/续页信息；正文、来源和操作历史按显式字段、版本、游标及能力读取；
- 旧共享浏览器桥仍是兼容路径，需要已登录页面在线；不能替代新独立凭据或直接 HTTP MCP。

## 工具总览（${all.length} 个）

| 工具 | 域 | 风险 | 能力 |
|---|---|---|---|
${rows}

## 通用纪律

1. **实体引用先消解**：人名/公司名/账本名等一律先调 \`resolveEntity\`；候选不唯一必须**反问用户**，禁止猜 id；
2. **权限先于可见性**：工具目录和 \`tools/list\` 不是授权；服务端每次检查独立凭据的域能力和部署白名单；
3. **写入复用稳定上下文**：相同意图重试复用原 \`requestId\` 与 \`generation\`；改变意图必须用新请求和新预览；
4. **按实际预览确认**：普通中/高风险操作使用返回的 \`confirmHint.args\`；个人命令用 \`preview_* → 用户确认 → confirm_preview → commit_*\`；票据 5 分钟、一次性且绑定具体计划；
5. **分域读取正文/历史**：笔记正文用 \`get_record(fields:["markdown"])\`，历史用 \`view:"history"\`，续读复用 generation/revision/cursor；超限结果不能视为完整；
6. **兼容搜索受限**：独立 Agent 当前不能调用 \`searchEntities\`，请用 \`resolve_contacts\`、\`resolve_topics\`、\`query_tasks\`、\`search_activities\` 与 \`listNotes\` 等定域工具；\`listHabits\` 只读历史，且需要已有 \`habit:read\`（后台当前不签发）。
`
}

async function main() {
  const meta = await loadSkillSource()
  // 注入运行期同一份实现（src/agent/jsonSchema.ts，随 skillSource 一起被 esbuild 打包）
  zodToJsonSchema = meta.toolJsonSchema
  await mkdir(outDir, { recursive: true })
  // 退役工具不能继续留在自动生成目录里误导离线 Agent；只清理由本脚本署名的旧产物。
  const expected = new Set(meta.ALL_TOOL_SKILLS.map(t => `${t.name}.md`))
  for (const name of await readdir(outDir)) {
    if (name === 'README.md' || !name.endsWith('.md') || expected.has(name)) continue
    const file = path.join(outDir, name)
    if ((await readFile(file, 'utf8')).includes('_本文件由 `scripts/gen-skills.mjs`')) await rm(file)
  }
  const tools = []
  for (const t of meta.ALL_TOOL_SKILLS) {
    const inputSchema = zodToJsonSchema(t.name, t.schema)
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
        protocolVersion: MCP_PROTOCOL_VERSION,
        supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
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

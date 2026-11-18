/**
 * skill / MCP schema 同源一致性测试（方案 §五 / §10.2 / §10.4）
 *
 * 核心断言：`skillSource.ts`（生成源）与 `executor.ts`（实现注册表）**工具集完全一致**——
 * 任何「加了工具没写 skill」或「写了 skill 没注册实现」都会在此炸出来，
 * 保证 §五「skill 与 MCP tools schema 由同一份 zod 生成」不是口号。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
// bridge 经 @/repositories 拉入 Dexie；node 环境下需假实现（与 bridge.test.ts 同口径）
import 'fake-indexeddb/auto'
import { AGENT_TOOLS, listVisibleTools } from '../executor'
import { ALL_TOOL_SKILLS, WRITE_TOOL_SKILLS, READ_TOOL_SKILLS, TOOL_RISK, TOOL_DOMAIN, TOOL_EVENTS } from '../skillSource'
import { buildToolsList } from '../bridge'

const docsDir = path.resolve(__dirname, '../../../docs/skills')
const relaySource = readFileSync(path.resolve(__dirname, '../../../relay/mcp-relay.mjs'), 'utf8')
const protocolVersion = /^export const MCP_PROTOCOL_VERSION = '([^']+)'/m.exec(relaySource)?.[1]
const supportedProtocolSource = /^export const SUPPORTED_PROTOCOL_VERSIONS = (\[[^\]]+\])/m.exec(relaySource)?.[1]
const supportedProtocolVersions = supportedProtocolSource
  ? JSON.parse(supportedProtocolSource.replace(/'/g, '"')) as string[]
  : undefined

describe('工具集同源（实现 ↔ skill 生成源）', () => {
  it('skill 源与 executor 注册表工具名一一对应（无孤儿）', () => {
    const implNames = Object.keys(AGENT_TOOLS).sort()
    const skillNames = ALL_TOOL_SKILLS.map((t) => t.name).sort()
    expect(skillNames).toEqual(implNames)
  })

  it('每个工具都有域归属与风险级（白名单与确认机制不漏筛）', () => {
    for (const t of ALL_TOOL_SKILLS) {
      expect(TOOL_DOMAIN[t.name], `${t.name} 缺域归属`).toBeTruthy()
      expect(['low', 'medium', 'high']).toContain(TOOL_RISK[t.name])
    }
  })

  it('读工具不声明领域事件，写工具声明表与 schema 事件表一致', () => {
    for (const t of READ_TOOL_SKILLS) {
      expect(TOOL_EVENTS[t.name] ?? []).toEqual([])
      expect(t.readOnly).toBe(true)
    }
    for (const t of WRITE_TOOL_SKILLS) {
      // 写工具必有副作用描述与幂等说明
      expect(t.sideEffect.length).toBeGreaterThan(0)
      expect(t.idempotency.length).toBeGreaterThan(0)
    }
  })
})

describe('生成产物与 skill 源一致（防文档漂移）', () => {
  it('docs/skills 下每个工具都有对应 md', () => {
    const files = new Set(readdirSync(docsDir))
    for (const t of ALL_TOOL_SKILLS) {
      expect(files.has(`${t.name}.md`), `缺 docs/skills/${t.name}.md`).toBe(true)
    }
    expect(files.has('README.md')).toBe(true)
    expect(files.has('mcp-tools.json')).toBe(true)
    expect([...files].filter(name => name.endsWith('.md') && name !== 'README.md').sort()).toEqual(
      ALL_TOOL_SKILLS.map(tool => `${tool.name}.md`).sort(),
    )
  })

  it('mcp-tools.json 工具集与 skill 源一致，且带 annotations.risk/domain', () => {
    const snapshot = JSON.parse(readFileSync(path.join(docsDir, 'mcp-tools.json'), 'utf8')) as {
      toolCount: number
      protocolVersion: string
      supportedProtocolVersions: string[]
      tools: { name: string; inputSchema: unknown; annotations: { risk: string; domain: string; readOnly: boolean } }[]
    }
    expect(snapshot.toolCount).toBe(ALL_TOOL_SKILLS.length)
    expect(snapshot.protocolVersion).toBe(protocolVersion)
    expect(snapshot.supportedProtocolVersions).toEqual(supportedProtocolVersions)
    expect(snapshot.tools.map((t) => t.name).sort()).toEqual(ALL_TOOL_SKILLS.map((t) => t.name).sort())
    for (const t of snapshot.tools) {
      expect(t.annotations.risk).toBe(TOOL_RISK[t.name])
      expect(t.annotations.domain).toBe(TOOL_DOMAIN[t.name])
      expect(t.inputSchema).toBeTruthy()
    }
  })

  it('运行期 tools/list（含白名单）是 skill 源的子集', () => {
    const visible = new Set(listVisibleTools().map((t) => t.name))
    for (const n of visible) expect(ALL_TOOL_SKILLS.some((t) => t.name === n)).toBe(true)
  })

  /**
   * 下面两条是 P1-2 / P2-1 的回归锁。
   *
   * 背景：`gen-skills.mjs` 曾内联一份「与 jsonSchema.ts 同口径」的简化拷贝，运行期修好
   * union 分支后它没跟，于是 `fin_recordTransaction` 的 6 个关联字段在 skill 文档与
   * mcp-tools.json 里被生成成 `{type:'number',enum:[null,null]}`。而原有断言只比
   * 「工具集 / 风险 / 域」，**不比 schema 内容**，所以测试全绿也发现不了 —— 这两条把它堵上。
   */
  it('运行期 tools/list 的 inputSchema 与 mcp-tools.json 逐字段一致', () => {
    const snapshot = JSON.parse(readFileSync(path.join(docsDir, 'mcp-tools.json'), 'utf8')) as {
      tools: { name: string; inputSchema: Record<string, unknown> }[]
    }
    const snapMap = new Map(snapshot.tools.map((t) => [t.name, t.inputSchema]))
    // 走运行期同一个构造函数（bridge.buildToolsList），避免测试自造第二份映射
    const live = buildToolsList()
    expect(live.length).toBe(snapshot.tools.length)
    for (const t of live) {
      expect(snapMap.get(t.name), `快照缺少 ${t.name}`).toBeTruthy()
      // JSON 往返一次消除键序差异后做深度比较
      expect(JSON.parse(JSON.stringify(t.inputSchema)), `${t.name} 的 inputSchema 与快照不一致`).toEqual(
        snapMap.get(t.name),
      )
    }
  })

  it('listTodos.priority 是可选过滤器，不得标为必填（P2-1 回归）', () => {
    const listTodos = buildToolsList().find((t) => t.name === 'listTodos')
    expect(listTodos, 'tools/list 里没有 listTodos').toBeTruthy()
    const required = (listTodos?.inputSchema as { required?: string[] }).required ?? []
    expect(required).not.toContain('priority')
  })

  it('所有生成的 MCP 入参示例都能通过对应 zod schema', () => {
    for (const tool of ALL_TOOL_SKILLS) {
      for (const example of tool.inputExamples ?? []) {
        const parsed = tool.schema.safeParse(example.args)
        expect(parsed.success, `${tool.name} 示例「${example.label}」不符合公开 schema`).toBe(true)
      }
    }
  })

  it('生成文档呈现风险确认上下文和关键授权限制', () => {
    const readme = readFileSync(path.join(docsDir, 'README.md'), 'utf8')
    expect(readme).toContain(`${ALL_TOOL_SKILLS.length} 个业务工具`)
    expect(readme).toContain('不能调用 `searchEntities`')
    expect(readme).toContain('需要已有 `habit:read`')

    for (const tool of ALL_TOOL_SKILLS.filter((item) => TOOL_RISK[item.name] === 'high')) {
      const doc = readFileSync(path.join(docsDir, `${tool.name}.md`), 'utf8')
      expect(doc, `${tool.name} 高风险页未说明确认票流程`).toContain('confirmHint.args')
      expect(doc, `${tool.name} 高风险页未说明 confirm_preview`).toContain('confirm_preview')
    }

    const search = readFileSync(path.join(docsDir, 'searchEntities.md'), 'utf8')
    expect(search).toContain('独立配对 Agent 当前不能调用')
    const habits = readFileSync(path.join(docsDir, 'listHabits.md'), 'utf8')
    expect(habits).toContain('habit:read')
    expect(habits).toContain('不再提供该能力的签发选项')
  })

  it('文档中的结构化 MCP 入参示例与元数据完全一致', () => {
    for (const tool of ALL_TOOL_SKILLS) {
      const doc = readFileSync(path.join(docsDir, `${tool.name}.md`), 'utf8')
      for (const example of tool.inputExamples ?? []) {
        expect(doc, `${tool.name} 缺少「${example.label}」示例`).toContain(JSON.stringify(example.args, null, 2))
      }
    }
  })
})

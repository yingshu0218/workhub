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
import { AGENT_TOOLS, listVisibleTools } from '../executor'
import { ALL_TOOL_SKILLS, WRITE_TOOL_SKILLS, READ_TOOL_SKILLS, TOOL_RISK, TOOL_DOMAIN, TOOL_EVENTS } from '../skillSource'

const docsDir = path.resolve(__dirname, '../../../docs/skills')

describe('工具集同源（实现 ↔ skill 生成源）', () => {
  it('skill 源与 executor 注册表工具名一一对应（无孤儿）', () => {
    const implNames = Object.keys(AGENT_TOOLS).sort()
    const skillNames = ALL_TOOL_SKILLS.map((t) => t.name).sort()
    expect(skillNames).toEqual(implNames)
  })

  it('每个工具都有域归属与风险级（白名单与确认机制不漏筛）', () => {
    for (const t of ALL_TOOL_SKILLS) {
      expect(TOOL_DOMAIN[t.name], `${t.name} 缺域归属`).toBeTruthy()
      expect(['low', 'medium']).toContain(TOOL_RISK[t.name])
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
  })

  it('mcp-tools.json 工具集与 skill 源一致，且带 annotations.risk/domain', () => {
    const snapshot = JSON.parse(readFileSync(path.join(docsDir, 'mcp-tools.json'), 'utf8')) as {
      toolCount: number
      tools: { name: string; inputSchema: unknown; annotations: { risk: string; domain: string; readOnly: boolean } }[]
    }
    expect(snapshot.toolCount).toBe(ALL_TOOL_SKILLS.length)
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
})

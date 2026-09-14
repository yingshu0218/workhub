/**
 * `scripts/agent-setup.mjs` 回归（Issue #33 · 一键接入）
 *
 * 这个脚本会往**用户级配置文件**里写东西（~/.codex/config.toml、~/.hermes/config.yaml…），
 * 所以它的正确性标准比一般脚本高：改错了就是用户自己的 Agent 环境出问题。
 * 三组断言固定住这个标准：
 *
 *   ① **不越界**：只动托管块 / 只动我们那一个键，用户自己的配置一个字节不动；
 *   ② **幂等**：连跑两次结果完全一致（否则「一条命令」会变成「每次跑都有 diff」）；
 *   ③ **可回退**：--uninstall 把写入的全部摘干净，且不误删用户自己的服务器条目。
 *
 * 集成用例用临时 HOME + 临时项目根（`WORKHUB_PROJECT_ROOT`），不碰真实环境。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  upsertManagedBlock,
  stripManagedBlock,
  upsertYamlMcpServers,
  renderCodexBlock,
  renderHermesEntry,
  renderToolSkill,
  collectToolSkills,
  parseArgs,
  TARGETS,
  REPO_ROOT,
  SERVER_NAME,
  SKILL_NAME,
} from '../../../scripts/agent-setup.mjs'

const SETUP = path.join(REPO_ROOT, 'scripts', 'agent-setup.mjs')

/* ============================ ① 托管块（Markdown / TOML） ============================ */

describe('托管块：只替换我们写的那一段', () => {
  it('文件为空时直接落下区块', () => {
    const out = upsertManagedBlock('', 'hello', 'html')
    expect(out).toContain('<!-- >>> workhub-agent-setup >>> -->')
    expect(out).toContain('hello')
    expect(out.endsWith('<!-- <<< workhub-agent-setup <<< -->\n')).toBe(true)
  })

  it('用户已有内容原样保留，我们的区块追加在后', () => {
    const user = '# 我的项目规则\n\n不要动我。\n'
    const out = upsertManagedBlock(user, '托管内容', 'html')
    expect(out.startsWith(user)).toBe(true)
    expect(out).toContain('托管内容')
  })

  it('重复 upsert 幂等（第二次不产生新内容）', () => {
    const once = upsertManagedBlock('用户前言\n', 'BODY', 'html')
    const twice = upsertManagedBlock(once, 'BODY', 'html')
    expect(twice).toBe(once)
  })

  it('body 变化时只换区块内部，用户前言不动', () => {
    const once = upsertManagedBlock('用户前言\n', 'OLD', 'html')
    const twice = upsertManagedBlock(once, 'NEW', 'html')
    expect(twice).toContain('用户前言')
    expect(twice).toContain('NEW')
    expect(twice).not.toContain('OLD')
    expect(twice.match(/workhub-agent-setup >>>/g)).toHaveLength(1)
  })

  it('只有开标记没有闭标记（上次写到一半被打断）时也能自愈，不会越写越乱', () => {
    const broken = '用户前言\n<!-- >>> workhub-agent-setup >>> -->\n半截内容没有收尾\n'
    const fixed = upsertManagedBlock(broken, 'NEW', 'html')
    expect(fixed).toContain('用户前言')
    expect(fixed).toContain('NEW')
    expect(fixed).not.toContain('半截内容')
    expect(fixed.match(/<<< workhub-agent-setup <<</g)).toHaveLength(1)
  })

  it('hash 风格（TOML/YAML）用 # 注释标记', () => {
    const out = upsertManagedBlock('[a]\nb = 1\n', 'x = 1', 'hash')
    expect(out).toContain('# >>> workhub-agent-setup >>>')
    expect(out).toContain('# <<< workhub-agent-setup <<<')
  })

  it('strip 摘掉区块、留下用户内容', () => {
    const once = upsertManagedBlock('用户前言\n', 'BODY', 'html')
    const out = stripManagedBlock(once, 'html')
    expect(out).toContain('用户前言')
    expect(out).not.toContain('BODY')
    expect(out).not.toContain('workhub-agent-setup')
  })

  it('Codex 区块形状正确且可重复插入不叠加', () => {
    const block = renderCodexBlock()
    expect(block).toContain(`[mcp_servers.${SERVER_NAME}]`)
    expect(block).toMatch(/^command = "/m)
    expect(block).toMatch(/^args = \["/m)
    const once = upsertManagedBlock('', block, 'hash')
    expect(upsertManagedBlock(once, block, 'hash')).toBe(once)
  })
})

/* ============================ ② Hermes YAML：段落内合并 ============================ */

describe('Hermes YAML：合并进 mcp_servers 段落，不碰别处', () => {
  const userYaml = ['model:', '  default: x', '', '', '# 备注', 'terminal:', '  backend: local', ''].join('\n')

  it('没有 mcp_servers 时追加一段', () => {
    const out = upsertYamlMcpServers(userYaml, { uninstall: false })
    expect(out).toContain('mcp_servers:')
    expect(out).toContain(`  ${SERVER_NAME}:`)
    // 用户的缩进内容一字不改
    expect(out).toContain('model:\n  default: x')
    expect(out).toContain('terminal:\n  backend: local')
  })

  it('段落为空对象 {} 时能就地展开（不留下重复的顶层键）', () => {
    const out = upsertYamlMcpServers('model:\n  default: x\nmcp_servers: {}\n', { uninstall: false })
    expect(out.match(/^mcp_servers:/gm)).toHaveLength(1)
    expect(out).not.toContain('{}')
    expect(out).toContain(`  ${SERVER_NAME}:`)
  })

  it('保留用户已有的其它 MCP 服务器', () => {
    const withOther = `mcp_servers:\n  other-server:\n    command: "other"\n    args:\n      - "x"\n\nmodel:\n  default: y\n`
    const out = upsertYamlMcpServers(withOther, { uninstall: false })
    expect(out).toContain('other-server:')
    expect(out).toContain('command: "other"')
    expect(out).toContain(`  ${SERVER_NAME}:`)
    expect(out).toContain('model:\n  default: y')
    expect(out.match(/^mcp_servers:/gm)).toHaveLength(1)
  })

  it('幂等：连续两次结果完全一致', () => {
    const once = upsertYamlMcpServers(userYaml, { uninstall: false })
    expect(upsertYamlMcpServers(once, { uninstall: false })).toBe(once)
  })

  it('幂等（已有其它服务器的情况下同样成立）', () => {
    const src = 'mcp_servers:\n  other:\n    command: "o"\n\nmodel:\n  default: y\n'
    const once = upsertYamlMcpServers(src, { uninstall: false })
    expect(upsertYamlMcpServers(once, { uninstall: false })).toBe(once)
  })

  it('重跑时替换我们的条目（node 路径变了要跟着更新）', () => {
    const once = upsertYamlMcpServers('mcp_servers:\n', { uninstall: false })
    const changed = once.replace(/command: .*/, 'command: "/old/node"')
    const out = upsertYamlMcpServers(changed, { uninstall: false })
    expect(out).not.toContain('/old/node')
    expect(out.match(new RegExp(`  ${SERVER_NAME}:`, 'g'))).toHaveLength(1)
  })

  it('uninstall 只摘我们自己，别人的服务器留着', () => {
    const src = 'mcp_servers:\n  other:\n    command: "o"\n\nmodel:\n  default: y\n'
    const added = upsertYamlMcpServers(src, { uninstall: false })
    const out = upsertYamlMcpServers(added, { uninstall: true })
    expect(out).not.toContain(SERVER_NAME)
    expect(out).toContain('other:')
    expect(out).toContain('command: "o"')
    expect(out).toContain('model:\n  default: y')
  })

  it('uninstall 后段落空了就连顶层键一起摘掉，不留空壳', () => {
    const added = upsertYamlMcpServers('model:\n  default: x\n', { uninstall: false })
    const out = upsertYamlMcpServers(added, { uninstall: true })
    expect(out).not.toContain('mcp_servers')
    expect(out).toContain('model:\n  default: x')
  })

  it('行内 flow 写法宁可报错也不写坏用户配置', () => {
    expect(() => upsertYamlMcpServers('mcp_servers: {a: {command: "x"}}\n', { uninstall: false })).toThrow(
      /行内写法/,
    )
  })

  it('条目形状符合 Hermes 的 mcp_servers 约定（command + args 序列）', () => {
    const out = renderHermesEntry(2)
    expect(out.split('\n')[0]).toBe(`  ${SERVER_NAME}:`)
    expect(out).toContain('    command: ')
    expect(out).toContain('    args:')
    expect(out).toContain('      - ')
  })
})

/* ============================ ③ skills 渲染 ============================ */

describe('skills：slug 合规 + 与生成源同源', () => {
  it('工具名的下划线/大写被规范化成合法的 agentskills.io slug', () => {
    const { slug, content } = renderToolSkill('fin_recordTransaction', '记一笔', '# 标题\n\n正文')
    expect(slug).toBe('fin-recordtransaction')
    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(content).toContain(`name: ${slug}`)
    // 正文里保留真实工具名，否则 Agent 对不上 MCP 工具清单
    expect(content).toContain('fin_recordTransaction')
  })

  it('描述里的双引号被转义，frontmatter 不会被破坏', () => {
    const { content } = renderToolSkill('x_tool', '带"引号"的描述', '正文')
    const fm = content.split('---')[1]
    expect(fm).toContain('\\"')
  })

  it('全量技能与 mcp-tools.json 工具集一一对应且 slug 互不冲突', () => {
    const skills = collectToolSkills()
    const meta = JSON.parse(readFileSync(path.join(REPO_ROOT, 'docs', 'skills', 'mcp-tools.json'), 'utf8')) as {
      tools: { name: string }[]
    }
    expect(skills).toHaveLength(meta.tools.length)
    expect(new Set(skills.map((s) => s.slug)).size).toBe(skills.length)
    for (const s of skills) expect(s.slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('元技能带合法 frontmatter（缺 frontmatter 的技能文件不会被任何工具加载）', async () => {
    const { renderMetaSkill } = await import('../../../scripts/agent-setup.mjs')
    const md = renderMetaSkill()
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain(`name: ${SKILL_NAME}`)
    expect(md).toMatch(/description: .+/)
  })
})

/* ============================ ④ 参数解析 ============================ */

describe('参数解析', () => {
  it('缺省值合理（默认 dry-run 关闭、技能粒度 meta）', () => {
    const o = parseArgs([])
    expect(o.dryRun).toBe(false)
    expect(o.uninstall).toBe(false)
    expect(o.skills).toBe('meta')
    expect(o.opencodeSchema).toBe('auto')
  })

  it('--only 逗号分隔且去空白', () => {
    expect(parseArgs(['--only', 'codex, hermes']).only).toEqual(['codex', 'hermes'])
  })

  it('取值的选项不会把下一个 flag 当成值', () => {
    const o = parseArgs(['--transport', '--dry-run'])
    expect(o.transport).toBe('')
    expect(o.dryRun).toBe(true)
  })
})

/* ============================ ⑤ 真实落盘：集成（临时 HOME） ============================ */

describe('集成：真实写入 / 幂等 / 回退（临时 HOME + 临时项目根）', () => {
  let home: string
  let proj: string

  const run = (extra: string[] = []) =>
    spawnSync(
      process.execPath,
      [SETUP, '--transport', 'local', '--port', '9001', '--token', 'test-token-abcdefghijklmnop', ...extra],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, HOME: home, WORKHUB_PROJECT_ROOT: proj },
        encoding: 'utf8',
      },
    )

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'workhub-home-'))
    proj = mkdtempSync(path.join(tmpdir(), 'workhub-proj-'))
    mkdirSync(path.join(home, '.codex'), { recursive: true })
    mkdirSync(path.join(home, '.hermes'), { recursive: true })
    mkdirSync(path.join(home, '.workbuddy'), { recursive: true })
    writeFileSync(path.join(proj, 'AGENTS.md'), '# 项目规则\n')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(proj, { recursive: true, force: true })
  })

  it('写入后：Codex/Hermes 得到 MCP 条目，且用户已有的键都还在', () => {
    writeFileSync(
      path.join(home, '.codex', 'config.toml'),
      '[projects."/some/where"]\ntrust_level = "trusted"\n',
    )
    writeFileSync(
      path.join(home, '.hermes', 'config.yaml'),
      'model:\n  default: x\nmcp_servers:\n  user-server:\n    command: "user"\n',
    )

    const r = run(['--only', 'codex,hermes'])
    expect(r.status).toBe(0)

    const toml = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
    expect(toml).toContain(`[mcp_servers.${SERVER_NAME}]`)
    expect(toml).toContain('[projects."/some/where"]')
    expect(toml).toContain('trust_level = "trusted"')

    const yaml = readFileSync(path.join(home, '.hermes', 'config.yaml'), 'utf8')
    expect(yaml).toContain(`  ${SERVER_NAME}:`)
    expect(yaml).toContain('user-server:') // 用户的服务器没被吞
    expect(yaml).toContain('model:\n  default: x')
  })

  it('幂等：第二次运行对同一批文件不再产生任何改动', () => {
    const files = ['.codex/config.toml', '.hermes/config.yaml', '.workbuddy/mcp.json']
    for (const f of files) writeFileSync(path.join(home, f), '')
    writeFileSync(path.join(home, '.hermes', 'config.yaml'), 'model:\n  default: x\n')

    expect(run(['--only', 'codex,hermes,workbuddy']).status).toBe(0)
    const snapshot = files.map((f) => readFileSync(path.join(home, f), 'utf8'))
    expect(run(['--only', 'codex,hermes,workbuddy']).status).toBe(0)
    const after = files.map((f) => readFileSync(path.join(home, f), 'utf8'))
    expect(after).toEqual(snapshot)
  })

  it('token 绝不出现在可入库的项目级配置里（只有凭据文件有）', () => {
    writeFileSync(path.join(home, '.workbuddy', 'mcp.json'), JSON.stringify({ mcpServers: {} }))
    expect(run(['--only', 'workbuddy,opencode']).status).toBe(0)

    const token = 'test-token-abcdefghijklmnop'
    const projectFiles = [path.join(proj, 'opencode.json')]
    for (const f of projectFiles) {
      if (existsSync(f)) expect(readFileSync(f, 'utf8')).not.toContain(token)
    }
    // 反向确认：凭据文件里确实写了（否则上面的断言可能只是因为什么都没写）
    expect(readFileSync(path.join(home, '.workhub', 'relay.json'), 'utf8')).toContain(token)
  })

  it('--dry-run 一个文件都不落盘', () => {
    writeFileSync(path.join(home, '.codex', 'config.toml'), '')
    const r = run(['--only', 'codex,hermes', '--dry-run'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('dry-run')
    expect(readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')).toBe('')
    expect(existsSync(path.join(home, '.hermes', 'config.yaml'))).toBe(false)
    expect(existsSync(path.join(home, '.workhub', 'relay.json'))).toBe(false)
  })

  it('--uninstall 摘干净我们写的，用户自己的条目留着', () => {
    writeFileSync(path.join(home, '.workbuddy', 'mcp.json'), JSON.stringify({ mcpServers: { mine: {} } }, null, 2))
    writeFileSync(path.join(home, '.hermes', 'config.yaml'), 'mcp_servers:\n  user-server:\n    command: "user"\n')
    // Codex 单独放一份用户内容：它的卸载曾经写错分支（走 upsert 把托管块**又写回去**，
    // 表面报成功、实际什么都没清），所以这里必须逐字断言区块真的消失了
    writeFileSync(path.join(home, '.codex', 'config.toml'), '[projects."/keep/me"]\ntrust_level = "trusted"\n')
    expect(run(['--only', 'workbuddy,codex,hermes,opencode']).status).toBe(0)
    expect(readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')).toContain(`[mcp_servers.${SERVER_NAME}]`)

    const r = run(['--only', 'workbuddy,codex,hermes,opencode', '--uninstall'])
    expect(r.status).toBe(0)

    const mcp = JSON.parse(readFileSync(path.join(home, '.workbuddy', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(mcp.mcpServers[SERVER_NAME]).toBeUndefined()
    expect(mcp.mcpServers.mine).toBeDefined()

    const yaml = readFileSync(path.join(home, '.hermes', 'config.yaml'), 'utf8')
    expect(yaml).not.toContain(`  ${SERVER_NAME}:`)
    expect(yaml).toContain('user-server:')

    const toml = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
    expect(toml).not.toContain(SERVER_NAME)
    expect(toml).not.toContain('workhub-agent-setup')
    expect(toml).toContain('[projects."/keep/me"]')

    // opencode.json 当初是本脚本创建的空壳（只有 $schema），卸载后应整文件消失而不是留一个 `{}`
    expect(existsSync(path.join(proj, 'opencode.json'))).toBe(false)
    expect(existsSync(path.join(home, '.workhub', 'relay.json'))).toBe(false)
  })

  it('--uninstall 不误删用户自己写过的 opencode.json', () => {
    writeFileSync(
      path.join(proj, 'opencode.json'),
      JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'anthropic/claude-sonnet-4-5' }, null, 2),
    )
    expect(run(['--only', 'opencode']).status).toBe(0)
    expect(run(['--only', 'opencode', '--uninstall']).status).toBe(0)

    const cfg = JSON.parse(readFileSync(path.join(proj, 'opencode.json'), 'utf8')) as Record<string, unknown>
    expect(cfg.model).toBe('anthropic/claude-sonnet-4-5')
    expect(JSON.stringify(cfg)).not.toContain(SERVER_NAME)
  })

  it('规则壳（Gemini）建了能删：卸载后不留空的 GEMINI.md，也不留 .bak', () => {
    // 强制目标：临时 HOME 里没有 ~/.gemini，靠 --only 走「强制写入」分支
    expect(run(['--only', 'gemini']).status).toBe(0)
    const geminiMd = path.join(proj, 'GEMINI.md')
    expect(readFileSync(geminiMd, 'utf8')).toContain('AGENTS.md')

    expect(run(['--only', 'gemini', '--uninstall']).status).toBe(0)
    // 托管块摘掉后什么都不剩 → 整个文件删掉（它当初就是本脚本创建的）
    expect(existsSync(geminiMd)).toBe(false)
    // 备份在卸载后已无意义，顺手清掉，不在用户 HOME / 仓库里留一地 .bak
    expect(existsSync(`${geminiMd}.bak-workhub-agent-setup`)).toBe(false)
  })

  it('规则壳不吞用户内容：已有 CLAUDE.md 时只追加托管块，卸载后用户内容留着', () => {
    const claudeMd = path.join(proj, 'CLAUDE.md')
    writeFileSync(claudeMd, '# 我自己的约定\n\n不要动这一段。\n')
    expect(run(['--only', 'claude']).status).toBe(0)
    expect(readFileSync(claudeMd, 'utf8')).toContain('我自己的约定')

    expect(run(['--only', 'claude', '--uninstall']).status).toBe(0)
    const after = readFileSync(claudeMd, 'utf8')
    expect(after).toContain('我自己的约定')
    expect(after).not.toContain('workhub-agent-setup')
  })

  it('缺少 AGENTS.md 时报错退出（规则单一事实源不在 = 接入等于没接）', () => {
    rmSync(path.join(proj, 'AGENTS.md'))
    writeFileSync(path.join(home, '.codex', 'config.toml'), '')
    const r = run(['--only', 'codex'])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('AGENTS.md')
  })

  it('目标表里每个目标的 MCP 落点格式都被实现覆盖（防止加了 target 忘了写 writer）', () => {
    const formats = new Set(['codex-toml', 'hermes-yaml', 'opencode-json'])
    for (const t of TARGETS) {
      expect(Boolean(t.mcp.format) || typeof t.mcp.write === 'function').toBe(true)
      if (t.mcp.format) expect(formats.has(t.mcp.format)).toBe(true)
      // 相对路径必须落在项目根下，绝对路径必须是家目录下（防止误写 cwd）
      if (path.isAbsolute(t.mcp.path)) expect(t.mcp.path.startsWith('~/')).toBe(true)
    }
  })
})

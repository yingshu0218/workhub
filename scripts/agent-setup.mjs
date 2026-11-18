#!/usr/bin/env node
/**
 * 一条命令把「寻鸽工作台」接入本机已有的 Agent 工具 —— Issue #33 收尾
 *
 * ## 它解决什么
 *
 * 本项目通过 MCP 对外暴露个人工作台工具，
 * 但每换一个 Agent 工具都要手搓一遍配置：MCP 条目的位置与格式各不相同、项目规则要重讲一遍、
 * 工具说明要重新投喂。本脚本把这三件事合并成一条命令：
 *
 *   npm run agent:setup
 *
 * ## 三件套（与飞书 CLI 的 `npx <cli> install` 同款分工）
 *
 * | 件 | 干什么 | 落点 |
 * |---|---|---|
 * | MCP | 把 relay 桥挂成该工具的一个 MCP 服务器 | 各工具自己的配置文件 |
 * | 规则 | 让 Agent 知道本项目的技术栈 / 纪律 / 禁区 | `AGENTS.md`（单一事实源，不复制多份） |
 * | skills | 投喂「怎么用这座桥」的元技能（确认流程 / 消解纪律 / 限幅） | 各工具的技能目录 |
 *
 * ## 设计原则
 *
 * 1. **通用探测，不写死厂商**：`TARGETS` 是一张表，新增工具只加一行；只处理**探测到已安装**的。
 * 2. **幂等 + 合并写入**：JSON 走键合并；TOML/YAML/Markdown 走带标记的「托管块」，
 *    只替换我们写过的那一段，用户自己的内容一个字节不动。连续跑两次结果完全一致。
 * 3. **token 只有一个落点**：权限受限的凭据文件。MCP 配置只引用凭据文件路径，绝不包含 token。
 * 4. **改前必留备份**：任何被修改的已有文件先复制成 `<file>.bak-workhub`（只留最近一份，不刷屏）。
 * 5. **不硬编码环境地址**：本项目处于开发/测试阶段，站点地址会变；远程地址必须显式提供。
 *
 * ## 用法
 *
 *   npm run agent:setup                          # 探测 + 写入（默认从已有凭据复用地址）
 *   npm run agent:setup -- --transport local     # 指向本地 relay（默认端口 9001）
 *   npm run agent:setup -- --url wss://<域名>/relay --pair
 *   npm run agent:setup -- --dry-run             # 只打印将要做什么，不落盘
 *   npm run agent:setup -- --only codex,hermes   # 只配指定目标
 *   npm run agent:setup -- --check               # 连通性自检（起 shim 走真实 MCP 握手）
 *   npm run agent:setup -- --skills full         # 额外投放逐工具技能（通常不需要，见下）
 *   npm run agent:setup -- --uninstall           # 移除本脚本写入的全部内容
 *
 * `--skills full` 为什么通常不需要：MCP 的 `tools/list` 本身就会把工具的
 * 名称 / 描述 / schema 交给 Agent。再写成逐工具技能是**重复投喂**，只会抬高每次请求的固定成本。
 * 默认只投放一份元技能（讲清「中风险确认流程 / 消解优先 / 读限幅」这些 MCP schema 表达不了的事）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync, chmodSync, renameSync, unlinkSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* ================================ 常量 ================================ */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 可独立隔离用户级 Agent 配置；不改写或复用 HOME/CODEX_HOME 环境变量。 */
const AGENT_HOME = path.resolve(process.env.WORKHUB_AGENT_HOME || homedir())
/**
 * 项目级写入的根目录。默认就是仓库根；可用 `WORKHUB_PROJECT_ROOT` 覆盖
 * （用途：测试时把项目级产物落到临时目录，不污染真实仓库；也兼容仓库被搬走/软链的场景）。
 */
const PROJECT_ROOT = process.env.WORKHUB_PROJECT_ROOT
  ? path.resolve(process.env.WORKHUB_PROJECT_ROOT)
  : REPO_ROOT
/** 旧版共享凭据文件；新的配对流程会切到 .workhub/agents/<credentialId>.json。 */
export const CRED_FILE = process.env.WORKHUB_RELAY_CRED_FILE
  ? path.resolve(process.env.WORKHUB_RELAY_CRED_FILE)
  : path.join(AGENT_HOME, '.workhub', 'relay.json')
/** 桥在 MCP 里的服务器名（各工具配置里的 key） */
export const SERVER_NAME = 'workhub'

/**
 * 当前生效的凭据文件 —— `--env <name>` 会把它切到 `~/.workhub/relay.<name>.json`。
 *
 * 为什么需要多份：测试站与正式站是**两套独立部署**，relay token 完全不同
 * （2026-10-21 实测：拿正式站 token 连测试站，直接报「接入 token 无效」）。
 * 单份凭据意味着「去测试站验收 AI 桥」必须先覆盖掉正式站配置、验完再改回来 ——
 * 忘一次就是两头都连不上，而且从报错上看不出是自己忘改了。
 */
let activeCredFile = CRED_FILE

/** 按 --env 切换旧版环境凭据文件；新配对的 credential-id 路径不受影响。 */
function applyEnv(envName) {
  if (!envName) return
  if (!/^[A-Za-z0-9_-]+$/.test(envName)) {
    throw new Error(`--env 只接受字母、数字、下划线与连字符，收到：${envName}`)
  }
  activeCredFile = path.join(AGENT_HOME, '.workhub', `relay.${envName}.json`)
}
function credentialPathForId(id) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(id))) throw new Error('credential-id 格式非法')
  return path.join(AGENT_HOME, '.workhub', 'agents', `${id}.json`)
}
/** 托管块标记：只替换标记之间的内容，用户自己的配置不动 */
const MARK = 'workhub-agent-setup'
/** 随本脚本投放的技能名 */
const SKILL_NAME = 'workhub-bridge'
/** 由 gen-skills.mjs 生成的工具文档目录（skills 的取材来源） */
const SKILLS_SRC = path.join(REPO_ROOT, 'docs', 'skills')
const SHIM = path.join(REPO_ROOT, 'relay', 'mcp-stdio-shim.mjs')

// 用函数而非常量：模板里引用 TARGETS，而 TARGETS 在下方才定义（常量会在模块加载时求值 → TDZ 报错）
const usage = () => `寻鸽工作台 · Agent 一键接入

用法：npm run agent:setup -- [选项]

接入（推荐：把这一段原样复制给任意 Agent）
  --pair                     在终端隐藏输入后台生成的一次性配对码，兑换后安全保存独立凭据
  --print-prompt             打印不含配对码或长期 token 的接入说明

选址（不设默认地址：站点地址随环境变化，写死等于埋隐性依赖）
  --transport local          指向本地 relay（默认 ws://127.0.0.1:9001/relay）
  --port <n>                 配合 --transport local 指定端口（dev 通常 5173，serve 默认 9001）
  --url <ws(s)://…/relay>    显式指定 relay 地址（远程部署用这个）
  --login                    兼容设备授权：登录后写入独立凭据；个人接入优先使用后台配对码
  WORKHUB_RELAY_TOKEN        兼容已有凭据的环境变量，不要把 token 放在命令行参数中
  --credential-id <id>       选择已有的独立配对凭据（可与 --url、--check、--only 合用）
  --env <name>               把凭据存到 ~/.workhub/relay.<name>.json，且**不改 MCP 配置**
                             （用途：去测试站验收桥，不动正式站那套配置；
                               配 --check 即「用该环境凭据自检」）

写入范围
  --only <id,id>             只处理指定目标
  --skills meta|full|none    技能投放粒度（默认 meta；full 另投逐工具技能，通常不需要）
  --opencode-schema auto|v1|v2  opencode 的 mcp 结构版本（auto = 探测已有配置）
  --node <path>              写进配置的 node 可执行文件（缺省自动挑最耐久的那个）

其它
  --dry-run                  只预览，不写任何文件
  --check                    写完做连通性自检（真实 MCP 握手 + tools/list）
  --uninstall                移除本脚本写入的全部内容（含凭据文件与技能目录）
  -h, --help                 显示本帮助

可选目标 id：${TARGETS.map((t) => t.id).join(' · ')}
`

/* ================================ 小工具 ================================ */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const expand = (p) => (p.startsWith('~/') ? path.join(AGENT_HOME, p.slice(2)) : p)
/** 展示用短路径：仓库内显示仓库相对路径（仓库本身也在用户目录下，所以必须先判仓库） */
const rel = (p) =>
  p.startsWith(REPO_ROOT) ? `${path.basename(REPO_ROOT)}/${p.slice(REPO_ROOT.length + 1)}` : p.startsWith(AGENT_HOME) ? `~${p.slice(AGENT_HOME.length)}` : p

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 写出前先备份原文件（只留最近一份，避免备份堆积成噪声） */
function backup(file) {
  if (!existsSync(file)) return null
  const bak = `${file}.bak-${MARK}`
  copyFileSync(file, bak)
  return bak
}

/** 仅在内容真的变了时才落盘（幂等的关键：第二次运行不产生任何写入与备份） */
function writeIfChanged(file, next) {
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (prev === next) return { changed: false, file }
  if (!DRY_RUN) {
    mkdirSync(path.dirname(file), { recursive: true })
    if (prev !== null) backup(file)
    writeFileSync(file, next, 'utf8')
  }
  return { changed: true, file }
}

/** 本轮删除失败的项目（沙箱/权限可能拒绝），收尾时如实汇报，不静默吞掉 */
const removalFailures = []

/**
 * 删除文件或目录。**失败不中止流程** —— 一个删不掉的凭据文件不该让整轮 `--uninstall` 半途而废，
 * 更不能因为抛异常而让用户以为「已经清干净了」。
 */
function tryRemove(target, label) {
  try {
    if (!DRY_RUN) rmSync(target, { recursive: true, force: true })
    return true
  } catch (e) {
    removalFailures.push(`${label}（${rel(target)}）：${e?.message ?? e}`)
    return false
  }
}

/* ============================ 托管块（标记式合并） ============================ */

/**
 * 用带标记的块包住「我们写的内容」。
 * 三种注释风格：`html`（Markdown）、`hash`（TOML/YAML/Shell）。
 * JSON 不用这套（JSON 没有注释），走键合并。
 */
function markers(style) {
  return style === 'hash'
    ? { open: `# >>> ${MARK} >>>`, close: `# <<< ${MARK} <<<` }
    : { open: `<!-- >>> ${MARK} >>> -->`, close: `<!-- <<< ${MARK} <<< -->` }
}

/** 把托管块替换为新内容；没有旧块就追加到末尾。 */
function upsertManagedBlock(text, body, style) {
  const { open, close } = markers(style)
  const block = `${open}\n${body.replace(/\n+$/, '')}\n${close}\n`
  const start = text.indexOf(open)
  if (start < 0) {
    const sep = text.length === 0 || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
    return text + sep + block
  }
  const endIdx = text.indexOf(close, start)
  // 只有开标记没有闭标记 = 上次写到一半被打断，从开标记一路替换到文件尾
  const end = endIdx < 0 ? text.length : endIdx + close.length + 1
  return text.slice(0, start) + block + text.slice(end)
}

/** 摘掉托管块（--uninstall 用） */
function stripManagedBlock(text, style) {
  const { open, close } = markers(style)
  const start = text.indexOf(open)
  if (start < 0) return text
  const endIdx = text.indexOf(close, start)
  const end = endIdx < 0 ? text.length : endIdx + close.length + 1
  return (text.slice(0, start) + text.slice(end)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n')
}

/* ============================ MCP 写入器（每格式一个） ============================ */

/**
 * 挑一个**耐久的** node 可执行文件路径写进各工具配置。
 *
 * 为什么不用 `process.execPath`：它可能是包管理器/宿主注入的**带版本号**路径
 * （如 `~/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`），
 * 运行时一升级这个目录就没了，配置里留着一堆死路径。
 * 优先选「不带版本号、由用户维护」的入口，实在没有再退回 execPath。
 */
function pickNodePath() {
  const candidates = [
    path.join(AGENT_HOME, '.local/bin/node'), // 用户自维护的稳定入口（通常是指向某处的符号链接）
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return process.execPath
}

/** 由 main() 注入（--node 可覆盖）；缺省时惰性挑选 */
let NODE_BIN = ''

/**
 * 通用的 stdio 服务器定义（JSON 系工具都用这个形状）。
 * `type: 'stdio'` 只有部分工具（CodeBuddy）的文档明确要求，故按 target 可选注入 ——
 * 统一加给所有工具属于「顺手改别人的配置」，一旦哪家不认这个键就是整条 MCP 加载失败。
 */
function stdioServerDef({ type } = {}) {
  return {
    ...(type ? { type } : {}),
    command: NODE_BIN || pickNodePath(),
    args: [SHIM],
    env: { WORKHUB_RELAY_CRED_FILE: activeCredFile },
  }
}

/** Claude Code / Cursor / Gemini / WorkBuddy / CodeBuddy：`{ "mcpServers": { "<name>": {...} } }` */
function writeMcpJsonServers(file, { uninstall, type }) {
  const obj = readJson(file)
  // 文件存在但不是合法 JSON：不动它（可能是 JSONC 或用户手写坏了），显式报错交给用户处理
  if (obj === null && existsSync(file)) {
    const raw = readFileSync(file, 'utf8').trim()
    if (raw) throw new Error(`${rel(file)} 不是合法 JSON（含注释？），请手动添加，或先修复该文件`)
  }
  const next = obj && typeof obj === 'object' ? obj : {}
  next.mcpServers = next.mcpServers && typeof next.mcpServers === 'object' ? next.mcpServers : {}
  if (uninstall) delete next.mcpServers[SERVER_NAME]
  else next.mcpServers[SERVER_NAME] = stdioServerDef({ type })
  if (Object.keys(next.mcpServers).length === 0) delete next.mcpServers
  // uninstall 后整个对象空了 = 这个文件当初就是为本脚本创建的 → 一并删掉，不留一个 `{}` 空壳
  if (uninstall && Object.keys(next).length === 0) {
    tryRemove(file, '删除空配置文件')
    return { changed: existsSync(file), file }
  }
  return writeIfChanged(file, `${JSON.stringify(next, null, 2)}\n`)
}

/** opencode：项目根 `opencode.json` 的 `mcp` 键。V1 直接挂名字，V2 挂在 `mcp.servers` 下 */
function writeMcpOpencode(file, { uninstall, opencodeSchema }) {
  const obj = readJson(file) ?? {}
  const next = typeof obj === 'object' && obj !== null ? obj : {}
  next.$schema = next.$schema ?? 'https://opencode.ai/config.json'
  if (opencodeSchema === 'v2') {
    next.mcp = next.mcp && typeof next.mcp === 'object' ? next.mcp : {}
    next.mcp.servers = next.mcp.servers && typeof next.mcp.servers === 'object' ? next.mcp.servers : {}
    if (uninstall) delete next.mcp.servers[SERVER_NAME]
    else next.mcp.servers[SERVER_NAME] = { type: 'local', ...stdioServerDef(), enabled: true }
    if (Object.keys(next.mcp.servers).length === 0) delete next.mcp.servers
    if (Object.keys(next.mcp).length === 0) delete next.mcp
  } else {
    next.mcp = next.mcp && typeof next.mcp === 'object' ? next.mcp : {}
    if (uninstall) delete next.mcp[SERVER_NAME]
    else next.mcp[SERVER_NAME] = { type: 'local', ...stdioServerDef(), enabled: true }
    if (Object.keys(next.mcp).length === 0) delete next.mcp
  }
  // uninstall 后只剩 `$schema` = 这个文件当初只有我们的条目 → 整文件删掉，不留空壳
  if (uninstall && Object.keys(next).every((k) => k === '$schema')) {
    tryRemove(file, '删除空配置文件')
    return { changed: existsSync(file), file }
  }
  return writeIfChanged(file, `${JSON.stringify(next, null, 2)}\n`)
}

/** Codex：`~/.codex/config.toml` 的 `[mcp_servers.<name>]`；TOML 值用 JSON 转义（两者基础字符串转义一致） */
function renderCodexBlock() {
  const def = stdioServerDef()
  const args = def.args.map((a) => JSON.stringify(a)).join(', ')
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${JSON.stringify(def.command)}`,
    `args = [${args}]`,
    `[mcp_servers.${SERVER_NAME}.env]`,
    `WORKHUB_RELAY_CRED_FILE = ${JSON.stringify(activeCredFile)}`,
  ].join('\n')
}

/** Hermes：`~/.hermes/config.yaml` 的 `mcp_servers:`（YAML）。注意键名是 `mcp_servers`，**不是** `mcpServers` */
function renderHermesEntry(indent) {
  const def = stdioServerDef()
  const pad = ' '.repeat(indent)
  return [
    `${pad}${SERVER_NAME}:`,
    `${pad}  command: ${JSON.stringify(def.command)}`,
    `${pad}  args:`,
    ...def.args.map((a) => `${pad}    - ${JSON.stringify(a)}`),
      `${pad}  env:`,
      `${pad}    WORKHUB_RELAY_CRED_FILE: ${JSON.stringify(activeCredFile)}`,
  ].join('\n')
}

/**
 * 把一个条目插进 YAML 顶层的 `mcp_servers:` 段落里，**保留该段落下的其它服务器**。
 *
 * 为什么不用 YAML 库：本项目有「零新增运行时依赖」的硬口径（方案 §A1），
 * 而这里只需处理一种极窄的形状（顶层 map + 二级 map）。遇到无法安全解析的形状
 * （行内 flow 风格等）就**显式报错**让用户手动处理 —— 宁可失败，也不要写坏用户的配置文件。
 */
function upsertYamlMcpServers(text, { uninstall }) {
  /**
   * 收尾统一：恰好一个末尾换行。
   * 这一步不是洁癖 —— 少了它就不再幂等：首次写是「追加一整段」（带换行），
   * 第二次走「段落内替换」分支（末尾不带换行），两者差一个字节，
   * 于是每次运行都报「有改动」，`--dry-run` 也就永远说不准。
   */
  const finalize = (arr) => `${arr.join('\n').replace(/\n+$/, '')}\n`

  const lines = text.split('\n')
  const topIdx = lines.findIndex((l) => /^mcp_servers:/.test(l))

  if (topIdx < 0) {
    if (uninstall) return text
    const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n'
    return finalize([...lines, ...(sep ? [''] : []), 'mcp_servers:', ...renderHermesEntry(2).split('\n')])
  }

  const inline = lines[topIdx].slice('mcp_servers:'.length).trim()
  if (inline && inline !== '{}') {
    throw new Error(
      `~/.hermes/config.yaml 的 mcp_servers 用了行内写法（${inline.slice(0, 40)}），` +
        '本脚本不做 YAML 深度解析，请改为块状写法，或手动追加 workhub 条目',
    )
  }

  // 段落范围：从 mcp_servers: 的下一行到「下一个顶格非注释非空行」
  let end = lines.length
  for (let i = topIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '' || /^\s/.test(l) || l.trimStart().startsWith('#')) continue
    end = i
    break
  }

  // 段落内定位我们的条目：二级键（缩进 2）`workhub:` → 下一个缩进 ≤2 的键为止
  const body = lines.slice(topIdx + 1, end)
  let start = -1
  let stop = body.length
  for (let i = 0; i < body.length; i++) {
    const m = /^(\s*)(\S[^:]*):/.exec(body[i])
    if (!m) continue
    const indent = m[1].length
    if (start >= 0 && indent <= 2) {
      stop = i
      break
    }
    if (start < 0 && indent === 2 && m[2].trim() === SERVER_NAME) start = i
  }

  const kept = start >= 0 ? [...body.slice(0, start), ...body.slice(stop)] : body
  const merged = uninstall ? kept : [...renderHermesEntry(2).split('\n'), ...kept]

  // 只在**本段内**收敛空行与首尾空白 —— 绝不碰文件其它部分
  // （早先对整份文件做空行收敛，会顺手改掉用户自己的排版，且要跑两次才收敛）
  const tidy = merged.filter((l, i) => !(l.trim() === '' && (i === 0 || merged[i - 1].trim() === '')))
  while (tidy.length && tidy[tidy.length - 1].trim() === '') tidy.pop()

  if (uninstall && tidy.length === 0) {
    // 段落已空：连 `mcp_servers:` 这一行一起摘掉，不留空壳
    const rest = lines.slice(end)
    while (rest.length && rest[0].trim() === '') rest.shift()
    const head = lines.slice(0, topIdx)
    while (head.length && head[head.length - 1].trim() === '') head.pop()
    return finalize([...head, ...(head.length && rest.length ? [''] : []), ...rest])
  }
  return finalize([...lines.slice(0, topIdx), 'mcp_servers:', ...tidy, ...lines.slice(end)])
}

/* ================================ 目标表 ================================ */
/**
 * 每个目标 = 一个 Agent 工具。新增工具只需在此加一行：
 *   detect —— 命中任一即视为「已安装」
 *   mcp    —— 写在哪、用什么格式
 *   rules  —— 写不写规则壳（`native` = 该工具本就读 AGENTS.md，无需额外文件）
 *   skills —— 技能目录（null = 该工具无技能机制）
 *   note   —— 写进汇总表、给用户看的注意事项
 */
const TARGETS = [
  {
    id: 'workbuddy',
    label: 'WorkBuddy',
    detect: { dirs: ['~/.workbuddy'], bins: ['workbuddy'] },
    mcp: { path: '~/.workbuddy/mcp.json', write: writeMcpJsonServers, scope: 'user' },
    rules: { path: 'AGENTS.md', mode: 'native' },
    skills: { dir: '.workbuddy/skills' },
    note: '用户级配置（WorkBuddy 的 MCP 只读 ~/.workbuddy/mcp.json）',
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    detect: { dirs: ['~/.codebuddy'], bins: ['codebuddy'] },
    // `type: 'stdio'` 是 CodeBuddy 官方示例的写法，其余 JSON 系目标不带这个键
    mcp: { path: '~/.codebuddy/mcp.json', write: writeMcpJsonServers, scope: 'user', type: 'stdio' },
    // CodeBuddy 自己会扫描仓库根的 AGENTS.md（并据此生成 project guidance），无需额外规则壳
    rules: { path: 'AGENTS.md', mode: 'native' },
    skills: { dir: '.codebuddy/skills' },
    note: '用户级配置 ~/.codebuddy/mcp.json；AGENTS.md 由 CodeBuddy 原生读取，加完可点 MCP 面板的 Try to Run 验证',
  },
  {
    id: 'codex',
    label: 'Codex',
    detect: { dirs: ['~/.codex'], bins: ['codex'] },
    mcp: { path: '~/.codex/config.toml', format: 'codex-toml', scope: 'user' },
    rules: { path: 'AGENTS.md', mode: 'native' },
    skills: null,
    note: 'MCP 只能写用户级 config.toml；AGENTS.md 由 Codex 原生读取',
  },
  {
    id: 'hermes',
    label: 'Hermes',
    detect: { dirs: ['~/.hermes'], bins: ['hermes'] },
    mcp: { path: '~/.hermes/config.yaml', format: 'hermes-yaml', scope: 'user' },
    rules: { path: 'AGENTS.md', mode: 'native' },
    skills: { dir: '.agents/skills' },
    note: 'YAML 键名是 mcp_servers（非 mcpServers）；技能目录 .agents/skills 需 Hermes 侧 skills.external_dirs 覆盖',
  },
  {
    id: 'opencode',
    label: 'opencode',
    detect: { dirs: ['~/.config/opencode', '~/.local/share/opencode'], bins: ['opencode'] },
    mcp: { path: 'opencode.json', format: 'opencode-json', scope: 'project' },
    rules: { path: 'AGENTS.md', mode: 'native' },
    skills: { dir: '.opencode/skills' },
    note: '项目级 opencode.json（可入库，故不含 token）；V1/V2 的 mcp 结构不同，可用 --opencode-schema 切换',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    detect: { dirs: ['~/.claude'], bins: ['claude'] },
    mcp: { path: '.mcp.json', write: writeMcpJsonServers, scope: 'project' },
    rules: { path: 'CLAUDE.md', mode: 'pointer' },
    skills: { dir: '.claude/skills' },
    note: '项目级 .mcp.json；规则写薄壳 CLAUDE.md 指向 AGENTS.md',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    detect: { dirs: ['~/.gemini'], bins: ['gemini'] },
    mcp: { path: '~/.gemini/settings.json', write: writeMcpJsonServers, scope: 'user' },
    rules: { path: 'GEMINI.md', mode: 'pointer' },
    skills: null,
    note: '用户级 settings.json；规则写薄壳 GEMINI.md 指向 AGENTS.md',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    detect: { dirs: ['~/.cursor'], bins: ['cursor-agent'] },
    mcp: { path: '.cursor/mcp.json', write: writeMcpJsonServers, scope: 'project' },
    rules: { path: '.cursor/rules/workhub.mdc', mode: 'pointer' },
    skills: null,
    note: '项目级 .cursor/mcp.json；规则写 .cursor/rules 的 pointer 壳',
  },
]

/** 把 target 表里的路径解析成绝对路径：`~/…` 展开到家，相对路径落到项目根（不是 cwd） */
const resolveTargetPath = (p) => (path.isAbsolute(p) ? p : p.startsWith('~/') ? expand(p) : path.join(PROJECT_ROOT, p))

/* ================================ 探测 ================================ */

function isInstalled(target) {
  const hitDir = (target.detect.dirs ?? []).some((d) => existsSync(expand(d)))
  const hitBin = (target.detect.bins ?? []).some((b) => {
    const r = spawnSync('command', ['-v', b], { shell: true, encoding: 'utf8' })
    return r.status === 0 && Boolean((r.stdout ?? '').trim())
  })
  return { installed: hitDir || hitBin, hitDir, hitBin }
}

/* ================================ 规则壳 ================================ */

const POINTER_BODY = `本项目的完整规则在 **\`AGENTS.md\`**（仓库根目录），请以它为准。

为避免多份规则漂移，这里**刻意不复述内容**：技术栈、目录地图、常用命令、工程纪律（事件永在事务之后 /
单一事实源 / 幽灵记录一律可操作错误 / 读工具限幅）、提交规范（同 commit 更新 PROGRESS.md + 追加 Changelog）、
禁区与协作节奏，全部只维护在 AGENTS.md 一处。

改动规则请改 AGENTS.md，不要再往本文件里加内容。`

/* ================================ skills ================================ */

/** 元技能正文：只写「MCP schema 表达不了」的那部分 */
function renderMetaSkill() {
  // 给仓库相对路径，而不是机器相关的绝对路径 —— 技能文件是给人/Agent 读的说明，不应带宿主信息
  const toolListPath = path.relative(REPO_ROOT, SKILLS_SRC) + '/README.md'
  return `---
name: ${SKILL_NAME}
description: 通过 MCP 操作「寻鸽工作台」的个人数据。用于记账、建档、跟进等真实落库操作前，先确认中风险确认流程与实体消解纪律。
---

# 寻鸽工作台 · Agent 桥

本项目的业务工具通过 MCP 暴露。工具的**名称 / 参数 / schema** 由 MCP 的 \`tools/list\` 自动下发，
不需要在这里复述；完整人读版见 \`${toolListPath}\`。

这份技能只讲 **MCP schema 里表达不了、但不知道就会做错**的四件事。

## 1. 前置条件：独立凭据与服务端可用

Agent 使用拥有者在「设置 → Agent 接入」签发并单独命名的凭据。Relay 会逐请求校验凭据、能力、部署域和恢复世代；
调用失败时先检查站点服务状态与后台授权状态，不要把旧共享桥或浏览器会话当成此凭据的替代品。

## 2. 中风险操作：必须走「预览 → 转述 → 取票 → 重试」四步

记账、改客户等中风险工具**第一次调用不会执行**，只返回预览材料（\`preview: true\`）。

正确流程：

1. 以目标参数调用工具 → 拿到预览；
2. **把预览内容转述给用户并取得确认**（不要自己替用户拍板）；
3. 调用 \`confirm_preview\`，参数为 \`{ tool, args }\`，且 \`args\` 必须与第 1 步**逐字段一致**；
4. 拿返回的 \`confirmToken\`，以**同样的参数**重试原工具。

票据是**一次性**的、5 分钟过期，并且**绑定了参数指纹** —— 用预览 A 拿的票去执行 B 会被直接拒绝
（这是防越权的设计，不是 bug）。参数改了就必须重新预览。

## 3. 实体消解：不许猜 id

凡是引用「客户 / 项目 / 待办 / 账本 / 笔记 / 文件夹」的地方：

1. 先调 \`resolveEntity\` 把用户的口语说法（「王五」「深蓝科技」）解析成候选；
2. **候选不唯一时必须反问用户**，不要挑第一个；
3. 候选唯一才把 id 传进写工具。

对不存在 / 已删的记录，工具会返回**可操作错误**而不是静默成功 —— 这是有意的：
幽灵记录上「成功」是最危险的一类假阳性。

## 4. 读工具的限幅与截断

列表类读工具都带**条数上限**，超限时返回 \`truncated: true\` 并截断，**不会**静默返回全量。
看到 \`truncated\` 就说明结果不完整，需要缩小范围（加过滤条件）而不是当成全部。

笔记类投影**不含正文**（只有 \`markdownLength\`）—— 全量拉正文会瞬间撑爆上下文。
需要正文时请用户把内容贴给你。

## 5. 删改类操作的回报

\`*_delete*\` 与级联删除工具会返回 \`sideEffects\`（受影响记录数）。
请**把影响面转述给用户**再收尾 —— 用户需要知道「删这一条顺手清掉了什么」。
`
}

/** 把 docs/skills/<tool>.md 转成 agentskills.io 的 SKILL.md（补 frontmatter） */
function renderToolSkill(name, description, body) {
  // 技能名需符合 `[a-z0-9-]`：工具名有下划线和大写，这里规范化，正文里保留真实工具名
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const desc = description.replace(/\s+/g, ' ').replace(/"/g, '\\"').trim()
  const stripped = body.replace(/^#\s+`?[^`\n]+`?\n+/, '') // 去掉原标题（标题由 frontmatter 承载）
  return {
    slug,
    content: `---\nname: ${slug}\ndescription: "MCP 工具 ${name}：${desc}"\n---\n\n# \`${name}\`\n\n${stripped.trim()}\n`,
  }
}

function collectToolSkills() {
  const meta = readJson(path.join(SKILLS_SRC, 'mcp-tools.json'))
  if (!meta?.tools) throw new Error(`读不到 ${rel(SKILLS_SRC)}/mcp-tools.json，请先跑 \`npm run gen:skills\``)
  const out = []
  for (const t of meta.tools) {
    const f = path.join(SKILLS_SRC, `${t.name}.md`)
    if (!existsSync(f)) continue
    out.push(renderToolSkill(t.name, t.description ?? '', readFileSync(f, 'utf8')))
  }
  return out
}

/* ============================ 一条指令（给 Agent 的可复制文本） ============================ */

/** 凭据里的 wss:// 反推站点地址：只用于提示「去哪个页面启用桥」，不参与连接 */
function siteFromCred(cred) {
  const u = cred?.url ?? ''
  if (!u) return ''
  return u.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/relay\/?$/, '')
}

/** relay 的 ws(s) 地址 → 同路径的 http(s) 基址（设备授权走普通 HTTP） */
export function httpBaseFromRelayUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/^ws(s?):/i, 'http$1:')
    .replace(/\/+$/, '')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 尽力打开系统浏览器；打不开不算失败（URL 已经打印在终端） */
function openInBrowser(url) {
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    /* 无图形环境：用户手动打开打印出来的地址 */
  }
}

/**
 * 设备授权（「一条命令 + 浏览器点授权」）。
 *
 * 与配对码的区别：不需要用户去翻容器日志，也不要求本机已有 token。
 * CLI 只拿高熵 device_code 轮询；用户在浏览器里用**站点账号**确认授权；
 * 批准后 CLI 才收到长期 token 并写入凭据文件。token 不出现在终端输出里。
 */
export async function deviceLogin(relayUrl) {
  if (!relayUrl) throw new Error('--login 需要 --url <wss://站点/relay>')
  const base = httpBaseFromRelayUrl(relayUrl)
  if (!/^https?:\/\//.test(base)) throw new Error(`--url 必须是 ws(s):// 地址，收到：${relayUrl}`)

  const codeRes = await fetch(`${base}/device/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'workhub-agent-setup' }),
    signal: AbortSignal.timeout(10_000),
  })
  const codeJson = await codeRes.json().catch(() => ({}))
  if (!codeRes.ok || !codeJson.device_code) {
    throw new Error(
      `设备授权码签发失败（HTTP ${codeRes.status}）${codeJson.error ? `：${codeJson.error}` : ''}`,
    )
  }

  const interval = Math.max(1, Number(codeJson.interval) || 5)
  const expiresIn = Math.max(60, Number(codeJson.expires_in) || 600)
  const deadline = Date.now() + expiresIn * 1000
  const verifyUrl = codeJson.verification_uri_complete || codeJson.verification_uri

  process.stdout.write(`\n请在浏览器中确认授权（用你的站点账号登录后点「授权」）：\n`)
  process.stdout.write(`  ${verifyUrl}\n`)
  process.stdout.write(`  授权码：${codeJson.user_code}\n\n`)
  openInBrowser(verifyUrl)

  while (Date.now() < deadline) {
    await sleep(interval * 1000)
    const res = await fetch(`${base}/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: codeJson.device_code }),
      signal: AbortSignal.timeout(10_000),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.access_token) return { url: relayUrl, token: j.access_token }
    if (j.error === 'authorization_pending') continue
    if (j.error === 'access_denied') throw new Error('授权已被拒绝（可在授权页重新运行命令后再试）')
    if (j.error === 'expired_token') throw new Error('授权码已过期，请重新运行命令')
    throw new Error(`等待授权失败（HTTP ${res.status}）${j.error ? `：${j.error}` : ''}`)
  }
  throw new Error('等待授权超时，请重新运行命令')
}

/**
 * 输出不含短码和长期凭据的接入说明。配对码只能由拥有者在后台按名称签发，
 * 不能再由持有旧共享凭据的 Agent 代为扩发。
 */
function renderPrompt({ site = 'https://<你的站点>' } = {}) {
  const relay = `${site}/relay`
  const mcpUrl = `${site}/relay/mcp`
  return [
    '【接入寻鸽工作台】',
    '拥有者先登录站点，进入「设置 → Agent 接入」，填写设备或 Agent 名称并生成一次性配对码。',
    '在要连接的设备上运行下方命令，再在终端隐藏输入处粘贴配对码：',
    `  npm run agent:setup -- --url ${relay} --pair`,
    '脚本只把独立 token 保存到该设备的本地凭据文件，并更新本机已检测到的 MCP 客户端配置。',
    '',
    `标准 MCP HTTP 地址：${mcpUrl}`,
    '脚本未识别的客户端不会被自动修改：请在该设备上安全兑换并保存 token，再按该客户端文档配置 Authorization: Bearer。',
    '确认连接后，在客户端重新加载 MCP 并调用 tools/list 检查当前工具清单。',
    '',
    '中风险写操作先回预览，取得用户确认后再调用 confirm_preview。',
  ].join('\n')
}

/* ================================ 主流程 ================================ */

let DRY_RUN = false

function parseArgs(argv, env = process.env) {
  const get = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
  }
  /**
   * npm 会把脚本入口后的**裸** `--url` 当成自己的配置项取走
   * （正确写法是 `npm run agent:setup -- --url …`）。此时脚本一个参数都收不到，
   * 于是静默复用旧凭据 —— 现象是「它没识别出我给的地址」，实际是根本没传进来。
   * 这里把 npm 转手的值取回来，并让调用方**显式告警**（不许静默采用）。
   */
  const isWsUrl = (s) => /^wss?:\/\//i.test(s)
  const fromNpm = (name) => env[`npm_config_${name}`] || ''
  const cliUrl = get('--url', '')
  // npm 会把 `--url` 记成 `url=true` 这种布尔配置，同时把真地址当**位置参数**传给脚本。
  // 所以两边都要认，但都要形似：地址必须 wss?:// 开头。
  const npmUrl = cliUrl || !isWsUrl(fromNpm('url')) ? '' : fromNpm('url')
  const positionalUrl = cliUrl || npmUrl ? '' : argv.find((a) => isWsUrl(a)) || ''
  const url = cliUrl || npmUrl || positionalUrl
  /**
   * npm 会把**已知**的布尔 flag（`--dry-run` / `--check` …）也当自己的配置项取走：
   * 脚本一个都收不到，于是「预览」会变成**真写**（本轮实测：`npm run agent:setup --url … --dry-run`
   * 少了 `--`，结果 dry-run 失效、凭据地址被真的改掉）。所有布尔开关都必须认 npm 转手的那份。
   */
  const npmFlag = (name) => ['true', '1'].includes(env[`npm_config_${name.replace(/^--/, '').replace(/-/g, '_')}`])
  const flag = (name) => argv.includes(name) || npmFlag(name)
  if (argv.includes('--token') || fromNpm('token')) {
    throw new Error('不接受命令行 token。请使用后台配对码 --pair；旧凭据请放入受保护的凭据文件或 WORKHUB_RELAY_TOKEN 环境变量。')
  }
  return {
    dryRun: flag('--dry-run'),
    check: flag('--check'),
    login: flag('--login'),
    pair: flag('--pair'),
    uninstall: flag('--uninstall'),
    help: flag('--help') || flag('-h'),
    printPrompt: flag('--print-prompt'),
    only: (get('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
    transport: get('--transport', ''),
    url,
    token: '',
    /** 有值 = 地址/凭证不是 `--url`/`--token` 传进来的，是 npm 转手的（多半是 npm 吞了裸参数） */
    swallowedByNpm: url !== cliUrl,
    port: get('--port', '9001'),
    env: get('--env', ''),
    credentialId: get('--credential-id', ''),
    skills: get('--skills', 'meta'),
    opencodeSchema: get('--opencode-schema', 'auto'),
    node: get('--node', ''),
  }
}

/** 解析出要写进凭据文件的 {url, token}；返回 null 表示本次不需要写凭据 */
function resolveCredentialForWrite(opts) {
  const existing = readJson(activeCredFile) ?? {}
  const suppliedToken = opts.token || process.env.WORKHUB_RELAY_TOKEN || ''
  // 选择独立凭据编号时，文件中的 URL+token 是一个不可拆开的身份。
  // 旧 WORKHUB_RELAY_TOKEN 只服务未选择编号的 legacy/default 流程，不能在重配时
  // 悄悄把独立身份替换成共享身份；缺失/损坏文件也不能被环境变量“修复”为成功。
  if (opts.credentialId && !opts.pair) {
    let selected
    try {
      selected = JSON.parse(readFileSync(activeCredFile, 'utf8'))
    } catch {
      throw new Error(`无法读取已选择的独立凭据文件 ${activeCredFile}；不会回退到共享环境变量。`)
    }
    if (
      !selected || typeof selected.url !== 'string' || !selected.url.trim() ||
      typeof selected.token !== 'string' || !selected.token.trim() ||
      !/^wss?:\/\//i.test(selected.url)
    ) {
      throw new Error(`已选择的独立凭据文件 ${activeCredFile} 缺少有效 URL 或 token；不会回退到共享环境变量。`)
    }
    if (opts.url && opts.url.replace(/\/+$/, '') !== selected.url.replace(/\/+$/, '')) {
      throw new Error('--credential-id 的站点地址已绑定在凭据文件中；请使用该文件对应的地址。')
    }
    return { url: selected.url, token: selected.token }
  }
  if (opts.transport === 'local' || opts.url.startsWith('ws://')) {
    const url = opts.url || `ws://127.0.0.1:${opts.port}/relay`
    return { url, token: suppliedToken || existing.token || '' }
  }
  if (opts.url) return { url: opts.url, token: suppliedToken || existing.token || '' }
  if (suppliedToken && existing.url) return { url: existing.url, token: suppliedToken }
  // 什么都没给：复用已有凭据（这就是「一条命令」能重复跑的原因）
  if (existing.url) return { url: existing.url, token: suppliedToken || existing.token || '' }
  return null
}

function writeCredential(cred) {
  const missing = []
  if (!cred.url) missing.push('url')
  if (!cred.token) missing.push('token（请先完成一次性配对或设备授权）')
  const payload = { url: cred.url, token: cred.token, note: '由 npm run agent:setup 写入；token 轮换后请重跑本命令' }
  const next = `${JSON.stringify(payload, null, 2)}\n`
  let previous = null
  try {
    previous = readFileSync(activeCredFile, 'utf8')
  } catch {
    /* 凭据文件尚不存在 */
  }
  if (previous === next) return { changed: false, file: activeCredFile, missing }
  if (!DRY_RUN) {
    const dir = path.dirname(activeCredFile)
    const privateRoot = path.join(AGENT_HOME, '.workhub')
    if (dir === privateRoot || dir.startsWith(privateRoot + path.sep)) {
      mkdirSync(privateRoot, { recursive: true, mode: 0o700 })
      chmodSync(privateRoot, 0o700)
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    const temp = `${activeCredFile}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`
    try {
      writeFileSync(temp, next, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      chmodSync(temp, 0o600)
      renameSync(temp, activeCredFile)
      chmodSync(activeCredFile, 0o600)
    } catch (error) {
      try { unlinkSync(temp) } catch { /* temp 已被 rename 或清理 */ }
      throw error
    }
  }
  return { changed: true, file: activeCredFile, missing }
}

/**
 * 连通性自检：显式把本次解析出的地址与 token 传给 shim ——
 * 否则 `--url/--token` 覆盖项会被自检忽略，验的就不再是「刚才写下去的那份凭据」。
 */
function runCheck(_resolvedCred) {
  process.stdout.write(c.bold('连通性自检\n'))
  const args = [SHIM, '--verify']
  const env = { ...process.env, WORKHUB_RELAY_CRED_FILE: activeCredFile }
  // 自检从权限受限的凭据文件读取，绝不把 bearer token 放进子进程 argv。
  // 保留继承环境，让 shim 在显式文件路径下自行证明 URL+token 成对优先且不回退。
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env })
  process.exitCode = r.status ?? 1
}

/** 从终端隐藏读入一次性码；管道模式不回显，也不把码放入进程参数。 */
export function readPairCode(input = process.stdin, output = process.stderr) {
  output.write('粘贴后台生成的一次性配对码（输入隐藏）：')
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return new Promise((resolve, reject) => {
      let value = ''
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        input.removeListener('data', onData)
        input.removeListener('end', onEnd)
        output.write('\n')
        if (error) reject(error)
        else resolve(value.split(/\r?\n/, 1)[0].trim())
      }
      const onData = (chunk) => {
        value += String(chunk)
        if (value.length > 256) finish(new Error('配对码输入过长'))
        else if (/[\r\n]/.test(value)) finish()
      }
      const onEnd = () => finish()
      input.setEncoding?.('utf8')
      input.on('data', onData)
      input.once('end', onEnd)
      input.resume()
    })
  }
  return new Promise((resolve, reject) => {
    let value = ''
    const wasRaw = input.isRaw
    const finish = (error) => {
      input.removeListener('data', onData)
      input.setRawMode(wasRaw)
      input.pause()
      output.write('\n')
      if (error) reject(error)
      else resolve(value.trim())
    }
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === '\u0003') return finish(new Error('已取消配对'))
        if (char === '\r' || char === '\n') return finish()
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else if (/[\x20-\x7e]/.test(char) && value.length < 128) value += char
      }
    }
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}

/** 在 Relay 端兑换一次性码。网络错误或非确定响应都标记为结果未知。 */
export async function redeemPairCode(relayUrl, code) {
  const base = httpBaseFromRelayUrl(relayUrl)
  if (!/^https?:\/\//i.test(base)) throw new Error('配对需要有效的 ws(s)://relay 地址')
  const url = `${base}/agent/pair/redeem`
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: String(code).trim() }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    failure.pairOutcomeUnknown = true
    throw failure
  }
  const body = await response.json().catch(() => ({}))
  if (response.status === 401) throw new Error('配对码无效、已过期或已兑换。')
  if (response.status === 429) throw new Error('配对尝试过于频繁，请稍后再试；该请求未签发凭据。')
  if (!response.ok || typeof body?.token !== 'string' || !body.token) {
    const error = new Error(`配对服务返回 HTTP ${response.status || '异常'}。`)
    error.pairOutcomeUnknown = response.ok || response.status >= 500 || response.status === 0
    throw error
  }
  if (typeof body?.credentialId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.credentialId)) {
    const error = new Error('配对服务响应缺少有效的凭据编号。')
    error.pairOutcomeUnknown = true
    throw error
  }
  return { url: relayUrl, token: body.token, credentialId: body.credentialId, name: String(body.name || '') }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  DRY_RUN = opts.dryRun
  NODE_BIN = opts.node ? path.resolve(opts.node) : ''

  if (opts.help) {
    process.stdout.write(usage())
    return
  }

  applyEnv(opts.env)
  if (opts.credentialId) activeCredFile = credentialPathForId(opts.credentialId)

  // 只打印接入说明，不通过旧共享 token 接口替用户签发配对码。
  if (opts.printPrompt) {
    const cred = readJson(activeCredFile) ?? {}
    const targetUrl = opts.url || cred.url || ''
    const site = targetUrl ? siteFromCred({ url: targetUrl }) : 'https://<你的站点>'
    process.stdout.write(`${renderPrompt({ site })}\n`)
    return
  }

  if (opts.pair && (opts.login || opts.uninstall || opts.credentialId)) {
    throw new Error('--pair 不能与 --login、--uninstall 或 --credential-id 同时使用')
  }

  let pairCodeConsumed = false
  if (opts.pair) {
    if (DRY_RUN) throw new Error('--pair 会消费一次性配对码，不能与 --dry-run 同时使用')
    const existing = readJson(activeCredFile) ?? {}
    const targetUrl = opts.url || existing.url || ''
    if (!targetUrl) throw new Error('--pair 需要 --url <ws(s)://站点/relay>')
    const code = await readPairCode()
    if (!code) throw new Error('没有读到配对码；请重新运行命令并输入后台显示的短码。')
    let paired
    try {
      paired = await redeemPairCode(targetUrl, code)
      pairCodeConsumed = true
    } catch (error) {
      if (error?.pairOutcomeUnknown) {
        throw new Error('配对结果未知，短码可能已被服务器兑换。请在后台检查该接入；若显示已兑换或无法确认，请撤销此接入后重新生成配对码。')
      }
      throw error
    }
    activeCredFile = credentialPathForId(paired.credentialId)
    opts.credentialId = paired.credentialId
    opts.url = paired.url
    opts.token = paired.token
  }

  /**
   * --login：兼容设备授权，批准后只在进程内持有 token，再安全写入凭据文件。
   * 地址优先用 --url；没给就复用已有凭据里的地址（复用会导致「换站点却还在连旧站」的歧义，
   * 所以只在不带 --url 时兜底，并在输出里明确写出实际目标）。
   */
  if (opts.login) {
    const existing = readJson(activeCredFile) ?? {}
    const targetUrl = opts.url || existing.url || ''
    if (!targetUrl) {
      process.stdout.write(
        c.red('❌ --login 需要站点地址。\n') +
          '   例：npm run agent:setup -- --url wss://team.fpigeon.fun/relay --login\n\n',
      )
      process.exitCode = 2
      return
    }
    const cred = await deviceLogin(targetUrl)
    opts.url = cred.url
    opts.token = cred.token
    opts.swallowedByNpm = false
  }

  const prefix = DRY_RUN ? c.yellow('[dry-run] ') : ''
  process.stdout.write(`\n${prefix}${c.bold('寻鸽工作台 · Agent 一键接入')}\n`)
  process.stdout.write(`${prefix}仓库：${REPO_ROOT}\n\n`)

  // 参数被 npm 转手 = 用户漏写了 `--`。必须说出来：静默采用会让人以为「命令没识别出地址」
  if (opts.swallowedByNpm) {
    process.stdout.write(
      c.yellow('⚠️  --url 是 npm 转手进来的：你的命令少了 `--` 分隔符。\n') +
        '   已按 npm_config_* 采用；正确写法是 `npm run agent:setup -- --url … --pair`。\n\n',
    )
  }

  /* ---- 1. 凭据 ---- */
  const changes = []
  /** @type {{url:string, token:string} | null} */
  let resolvedCred = null
  if (opts.uninstall) {
    if (existsSync(activeCredFile)) {
      if (tryRemove(activeCredFile, '删除凭据文件')) changes.push(`删除凭据文件 ${rel(activeCredFile)}`)
    }
  } else {
    const cred = resolveCredentialForWrite(opts)
    if (!cred) {
      process.stdout.write(
        c.red('❌ 不知道 relay 地址。\n') +
          `   本地：  npm run agent:setup -- --transport local --port <端口>\n` +
          `   远程：  npm run agent:setup -- --url wss://<站点>/relay --pair\n` +
          `   （先由拥有者在后台生成命名配对码；token 不放在命令行）\n\n`,
      )
      process.exitCode = 2
      return
    }
    resolvedCred = cred
    let r
    try {
      r = writeCredential(cred)
    } catch (error) {
      if (pairCodeConsumed) {
        throw new Error(`服务器已兑换配对码，但凭据文件写入失败。请检查 ${activeCredFile} 是否已安全保存；若无法连接，请在后台撤销这条可能已签发的接入，再生成新码。`)
      }
      throw error
    }
    if (r.changed) changes.push(`写入凭据 ${rel(activeCredFile)} → ${cred.url}`)
    if (pairCodeConsumed) {
      process.stdout.write(`${prefix}配对码已由服务器兑换；凭据编号 ${opts.credentialId}，本机文件 ${rel(activeCredFile)}。这不代表 Agent 已连接。\n`)
    }
    if (r.missing.length) {
      process.stdout.write(
        c.yellow(`⚠️  凭据缺少 ${r.missing.join(' / ')}，Agent 侧会连不上。\n`) +
          `   填好后重跑，或直接编辑 ${rel(activeCredFile)}。\n\n`,
      )
    }
  }

  /* ---- 2. 逐目标写入 ---- */
  // `--env` 模式只维护该环境的凭据，**不动各 Agent 的 MCP 配置**：
  // MCP 条目只有一套（server 名固定 workhub），改它等于把默认接入点从正式站切走 ——
  // 而「不覆盖正式站配置」正是 --env 存在的理由。要真在测试站长期使用，
  // 再手工给对应工具的 MCP 条目加 `WORKHUB_RELAY_CRED_FILE=<relay.<env>.json>`。
  if (opts.env) {
    process.stdout.write(
      `${prefix}${c.bold(`环境凭据：${opts.env}`)}\n` +
        `${prefix}  · ${rel(activeCredFile)}${resolvedCred ? ` → ${resolvedCred.url}` : ''}\n` +
        `${prefix}  · MCP 配置未改动（默认接入点仍是正式站）\n` +
        `${prefix}  · 自检：npm run agent:setup -- --env ${opts.env} --check\n\n`,
    )
    if (opts.check) runCheck(resolvedCred)
    return
  }

  const rows = []
  for (const t of TARGETS) {
    if (opts.only.length && !opts.only.includes(t.id)) continue
    const { installed, hitDir, hitBin } = isInstalled(t)
    if (!installed && !opts.only.length) {
      rows.push({ tool: t.label, status: c.dim('未安装（跳过）'), detail: '' })
      continue
    }
    if (!installed) {
      rows.push({ tool: t.label, status: c.yellow('强制写入'), detail: '未探测到安装痕迹' })
    }

    const perTarget = []
    try {
      // MCP
      const mcpPath = resolveTargetPath(t.mcp.path)
      let r
      if (t.mcp.format === 'codex-toml') {
        const prev = existsSync(mcpPath) ? readFileSync(mcpPath, 'utf8') : ''
        // 注意必须分叉：卸载走 strip，否则 upsert 会把托管块**原样写回去**，
        // `--uninstall` 看上去成功、实际什么都没清掉（这条分支曾经就是这么错的）
        r = writeIfChanged(mcpPath, opts.uninstall ? stripManagedBlock(prev, 'hash') : upsertManagedBlock(prev, renderCodexBlock(), 'hash'))
      } else if (t.mcp.format === 'hermes-yaml') {
        const prev = existsSync(mcpPath) ? readFileSync(mcpPath, 'utf8') : ''
        r = writeIfChanged(mcpPath, upsertYamlMcpServers(prev, { uninstall: opts.uninstall }))
      } else if (t.mcp.format === 'opencode-json') {
        const schema = opts.opencodeSchema === 'auto' ? detectOpencodeSchema() : opts.opencodeSchema
        r = writeMcpOpencode(mcpPath, { uninstall: opts.uninstall, opencodeSchema: schema })
        if (r.changed) perTarget.push(`schema=${schema}`)
      } else {
        r = t.mcp.write(mcpPath, { uninstall: opts.uninstall, type: t.mcp.type })
      }
      if (r.changed) perTarget.push(`MCP → ${rel(mcpPath)}`)

      // 规则
      if (t.rules) {
        const rulesPath = resolveTargetPath(t.rules.path)
        if (t.rules.mode === 'pointer') {
          const prev = existsSync(rulesPath) ? readFileSync(rulesPath, 'utf8') : ''
          if (opts.uninstall) {
            const stripped = stripManagedBlock(prev, 'html')
            // 摘掉托管块后什么都不剩 = 这个文件当初就是为本脚本创建的 → 删掉，不留空壳
            if (stripped.trim() === '') {
              if (tryRemove(rulesPath, '删除空规则壳')) perTarget.push(`规则壳 → ${rel(rulesPath)}`)
            } else {
              const rr = writeIfChanged(rulesPath, stripped)
              if (rr.changed) perTarget.push(`规则壳 → ${rel(rulesPath)}`)
            }
          } else {
            const rr = writeIfChanged(rulesPath, upsertManagedBlock(prev, POINTER_BODY, 'html'))
            if (rr.changed) perTarget.push(`规则壳 → ${rel(rulesPath)}`)
          }
        }
      }

      // skills
      if (t.skills && !opts.uninstall && opts.skills !== 'none') {
        const dir = path.join(PROJECT_ROOT, t.skills.dir, SKILL_NAME)
        const sr = writeIfChanged(path.join(dir, 'SKILL.md'), renderMetaSkill())
        if (sr.changed) perTarget.push(`技能 → ${rel(dir)}`)
        if (opts.skills === 'full') {
          let n = 0
          for (const s of collectToolSkills()) {
            if (writeIfChanged(path.join(PROJECT_ROOT, t.skills.dir, s.slug, 'SKILL.md'), s.content).changed) n++
          }
          if (n) perTarget.push(`逐工具技能 ×${n}`)
        }
      }
    } catch (e) {
      rows.push({ tool: t.label, status: c.red('失败'), detail: e.message })
      process.exitCode = 1
      continue
    }

    if (!installed && !opts.only.length) continue
    const why = hitDir ? `配置目录` : hitBin ? `PATH` : '强制'
    rows.push({
      tool: t.label,
      status: perTarget.length ? c.green(opts.uninstall ? '已移除' : '已配置') : c.dim('已就绪'),
      detail: perTarget.length ? perTarget.join(' · ') : `无需改动（探测依据：${why}）`,
    })
    for (const p of perTarget) changes.push(`${t.label}：${p}`)
  }

  /* ---- 3. 清理 skills 与备份（uninstall） ---- */
  if (opts.uninstall) {
    for (const t of TARGETS) {
      if (!t.skills) continue
      const dir = path.join(PROJECT_ROOT, t.skills.dir)
      if (!existsSync(dir)) continue
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (!statSync(full).isDirectory()) continue
        if (name !== SKILL_NAME && opts.skills !== 'full') continue
        if (tryRemove(full, '删除技能')) changes.push(`删除技能 ${rel(full)}`)
      }
    }
    // 卸载后备份已无意义（内容已还原），顺手清掉 —— 否则用户 HOME 与仓库里会留一地 .bak
    for (const t of TARGETS) {
      if (opts.only.length && !opts.only.includes(t.id)) continue
      for (const p of [t.mcp?.path, t.rules?.path]) {
        if (!p) continue
        const bak = `${resolveTargetPath(p)}.bak-${MARK}`
        if (existsSync(bak) && tryRemove(bak, '清理备份')) changes.push(`清理备份 ${rel(bak)}`)
      }
    }
  }

  /* ---- 4. 汇总 ---- */
  const width = Math.max(...rows.map((r) => r.tool.length))
  process.stdout.write(`${prefix}${c.bold('处理结果')}\n`)
  for (const r of rows) {
    process.stdout.write(`${prefix}  ${r.tool.padEnd(width)}  ${r.status}  ${c.dim(r.detail)}\n`)
  }

  process.stdout.write(`\n${prefix}${c.bold(changes.length ? '改动明细' : '无改动')}\n`)
  for (const ch of changes) process.stdout.write(`${prefix}  · ${ch}\n`)

  // 删不掉的要如实说出来：否则用户以为已经清干净了
  if (removalFailures.length) {
    process.stdout.write(`\n${prefix}${c.red('⚠️  以下项目未能删除（权限或沙箱限制），请手动处理：')}\n`)
    for (const f of removalFailures) process.stdout.write(`${prefix}  · ${f}\n`)
    process.exitCode = 1
  }

  // 规则单一事实源：native 目标直接读仓库根的 AGENTS.md，它不在 = 接入等于没接
  if (!opts.uninstall) {
    const agentsMd = path.join(PROJECT_ROOT, 'AGENTS.md')
    if (!existsSync(agentsMd)) {
      process.stdout.write(`${prefix}${c.red('❌ 缺少 AGENTS.md')}（规则单一事实源），请先补上再重跑\n`)
      process.exitCode = 1
    }
    const notes = TARGETS.filter((t) => t.note && rows.some((r) => r.tool === t.label && /已配置|已就绪/.test(r.status)))
    if (notes.length) {
      process.stdout.write(`\n${prefix}${c.bold('注意事项')}\n`)
      for (const t of notes) process.stdout.write(`${prefix}  ${t.label}：${c.dim(t.note)}\n`)
    }
  }

  if (!opts.uninstall) {
    process.stdout.write(
      `\n${prefix}${c.bold('下一步')}\n` +
        `${prefix}  1. 若尚未配对，请拥有者在「设置 → Agent 接入」生成命名配对码，再运行 --pair。\n` +
        `${prefix}  2. 重启你的 Agent 工具，让它重新读取配置。\n` +
        `${prefix}  3. 自检：npm run agent:setup -- --check\n`,
    )
  }
  if (DRY_RUN) process.stdout.write(`\n${prefix}以上均为预览，未写入任何文件。\n`)
  process.stdout.write('\n')

  /* ---- 5. 可选自检 ---- */
  if (opts.check) runCheck(resolvedCred)
}

/** opencode 的 mcp 结构在 V1/V2 间变了：从已有配置里找线索，找不到就按 V1（长期文档口径） */
function detectOpencodeSchema() {
  const candidates = [
    path.join(PROJECT_ROOT, 'opencode.json'),
    path.join(PROJECT_ROOT, 'opencode.jsonc'),
    path.join(AGENT_HOME, '.config/opencode/opencode.json'),
    path.join(AGENT_HOME, '.config/opencode/opencode.jsonc'),
  ]
  for (const f of candidates) {
    if (!existsSync(f)) continue
    const raw = readFileSync(f, 'utf8')
    if (/"servers"\s*:/.test(raw)) return 'v2'
    if (/"mcp"\s*:/.test(raw)) return 'v1'
  }
  return 'v1'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // main 是 async（签发配对码要发一次 HTTPS 请求）：错误必须落到进程退出码，不能变成未处理的 rejection
  main().catch((e) => {
    process.stderr.write(`\n❌ ${e?.message ?? e}\n`)
    process.exitCode = 1
  })
}

/* 供测试直接取用的纯函数（渲染与合并都不落盘，因此可以放心在断言里反复调用） */
export {
  TARGETS,
  PROJECT_ROOT,
  REPO_ROOT,
  SKILL_NAME,
  upsertManagedBlock,
  stripManagedBlock,
  upsertYamlMcpServers,
  renderCodexBlock,
  renderHermesEntry,
  renderMetaSkill,
  renderPrompt,
  siteFromCred,
  renderToolSkill,
  collectToolSkills,
  pickNodePath,
  parseArgs,
}

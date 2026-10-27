/**
 * `scripts/agent-setup.mjs` 的类型声明（供测试 import；脚本本身是纯 ESM .mjs）。
 *
 * 与 `vite-relay-plugin.d.mts` 同款做法：仓库的构建脚本不参与 `tsc -b` 的
 * `include: ["src"]`，但测试要从 src 里 import 它们的纯函数，所以补一份声明。
 * 这里**只声明测试用得到的导出**，不追求覆盖脚本全部内部实现。
 */

/** 凭据文件绝对路径（~/.workhub/relay.json） */
export declare const CRED_FILE: string
/** 项目级写入根目录（默认仓库根，`WORKHUB_PROJECT_ROOT` 可覆盖） */
export declare const PROJECT_ROOT: string
/** 仓库根目录 */
export declare const REPO_ROOT: string
/** 桥在 MCP 配置里的服务器名 */
export declare const SERVER_NAME: string
/** 随脚本投放的技能名 */
export declare const SKILL_NAME: string

export interface AgentTarget {
  id: string
  label: string
  detect: { dirs?: string[]; bins?: string[] }
  mcp: { path: string; format?: string; write?: unknown; scope: string; type?: 'stdio' }
  rules: { path: string; mode: 'native' | 'pointer' } | null
  skills: { dir: string } | null
  note?: string
}

export declare const TARGETS: readonly AgentTarget[]

export type CommentStyle = 'html' | 'hash'

/** 把托管块替换为新内容；无旧块则追加。用户块外的内容原样保留 */
export declare function upsertManagedBlock(text: string, body: string, style: CommentStyle): string

/** 摘掉托管块（--uninstall 用） */
export declare function stripManagedBlock(text: string, style: CommentStyle): string

/** 合并/移除 Hermes config.yaml 的 `mcp_servers.workhub`，保留该段落下的其它服务器 */
export declare function upsertYamlMcpServers(text: string, opts: { uninstall: boolean }): string

/** 渲染 Codex 的 `[mcp_servers.workhub]` 托管块 */
export declare function renderCodexBlock(): string

/** 渲染 Hermes 的 `workhub:` 条目（YAML） */
export declare function renderHermesEntry(indent: number): string

/** 渲染「怎么用这座桥」的元技能（含 SKILL.md frontmatter） */
export declare function renderMetaSkill(): string

/** 把 docs/skills/<tool>.md 转成 agentskills.io 的 SKILL.md；slug 已规范化为 [a-z0-9-] */
export declare function renderToolSkill(
  name: string,
  description: string,
  body: string,
): { slug: string; content: string }

/** 从 docs/skills/mcp-tools.json 收集全部逐工具技能 */
export declare function collectToolSkills(): { slug: string; content: string }[]

/** 挑一个耐久的 node 可执行文件路径 */
export declare function pickNodePath(): string

export interface CliOptions {
  dryRun: boolean
  check: boolean
  uninstall: boolean
  help: boolean
  printPrompt: boolean
  only: string[]
  transport: string
  url: string
  token: string
  /** 地址/凭证是 npm 转手进来的（用户漏写了 `--`）—— 调用方须显式告警 */
  swallowedByNpm: boolean
  port: string
  skills: string
  opencodeSchema: string
  node: string
}

/** `env` 可注入（测试用）：npm 会把裸 `--url` / `--dry-run` 吞成 `npm_config_*` */
export declare function parseArgs(argv: string[], env?: Record<string, string | undefined>): CliOptions

/** 渲染「一条指令」：远程 Agent 直连服务器，只带一次性配对码，**不含长期 token / 本机路径** */
export declare function renderPrompt(opts?: { code?: string; site?: string }): string

/** 由凭据里的 wss:// 反推站点地址（仅用于提示「去哪个页面启用桥」） */
export declare function siteFromCred(cred: { url?: string } | null | undefined): string

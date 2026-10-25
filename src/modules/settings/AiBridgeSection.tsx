import { useState, useEffect } from 'react'
import { Card, Button } from '@/design-system/ui'
import { Icon } from '@/design-system/Icon'
import type { Settings, AiDomain } from '@/db/types'
import { agentBridge, resolveBridgeBase, type BridgeStatus } from '@/agent/bridge'

/**
 * AI Agent 桥配置区（能力白名单 + 接入凭据） —— 方案 §四.2 / §四.3（P1 第 4 步配套）
 *
 * 为什么必须在这里：外部 Agent 形态下，「能力白名单」与「接入 token」是硬边界而非可选项——
 * 没有它们，relay 与桥无法安全启用（无 token 谁都能连、无白名单等于全量暴露 18 张表）。
 *
 * 边界：本区只读写 settings `ai` 段（本地 singleton，**不进同步队列**）；
 * 不 import 任何 repositories 写函数，不直接操作数据。
 */

const DOMAIN_LABELS: Record<AiDomain, { label: string; desc: string }> = {
  fin: { label: '财务', desc: '记账、建账本' },
  crm: { label: 'CRM', desc: '建客户、沟通日志、客户关系' },
  todo: { label: '待办', desc: '建 / 改 / 删待办、完成待办' },
  project: { label: '项目', desc: '建项目、改项目（含归档 / 搁置）' },
  habit: { label: '习惯', desc: '打卡 / 取消打卡' },
  note: { label: '笔记', desc: '建 / 改笔记、建文件夹' },
  link: { label: '关联', desc: '原子间建联 / 解联（客户关系、流水关联等）' },
  read: { label: '读取', desc: '实体消解、搜索、列表查询' },
}

const DOMAIN_ORDER: AiDomain[] = ['fin', 'crm', 'todo', 'project', 'habit', 'note', 'read']

function genToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function AiBridgeSection({
  settings,
  save,
}: {
  settings: Settings
  save: (patch: Partial<Omit<Settings, 'key'>>) => void
}) {
  const ai = settings.ai
  const domains: Partial<Record<AiDomain, boolean>> = ai.domains ?? {}
  const [status, setStatus] = useState<BridgeStatus>(() => agentBridge.getStatus())
  const [copied, setCopied] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [copiedConfig, setCopiedConfig] = useState(false)
  /** 桥实际连出的 relay 基址（留空 = 当前站点同源 /relay，与实际连接口径同源，不另算一份） */
  const bridgeBase = resolveBridgeBase(ai.bridgeUrl)

  useEffect(() => agentBridge.onStatus(setStatus), [])

  /**
   * 给外部 Agent 的「一条命令」接入（Issue #154）。
   *
   * 为什么放在设置页：用户直觉是「丢个地址给 Agent 就能用」，而标准 MCP 只有 stdio /
   * Streamable HTTP 两种传输、**没有「连裸 ws://」这条**，直连 ws 的客户端极少。
   * 所以这里直接产出可粘贴的命令与配置：Agent 侧用项目自带的 stdio 桥
   * （`relay/mcp-stdio-shim.mjs`）把 JSON-RPC 帧搬到 relay 上。
   *
   * 优先给 `npm run agent:setup`：它自动写入各 Agent 工具（Codex / Hermes / opencode /
   * Claude Code / Cursor …）的配置，并把凭据**集中存到 `~/.workhub/relay.json`** ——
   * token 因此不落进任何可入库的配置文件。手抄下面那份 JSON 是备选路径，
   * 注意它含明文 token，别提交到仓库。
   */
  const agentSetupCmd = `npm run agent:setup -- --url ${bridgeBase} --token ${ai.bridgeToken ?? ''}`
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        workhub: {
          command: 'node',
          args: [
            '<项目路径>/relay/mcp-stdio-shim.mjs',
            '--url',
            bridgeBase,
            '--token',
            ai.bridgeToken ?? '',
          ],
        },
      },
    },
    null,
    2,
  )

  const setDomain = (d: AiDomain, on: boolean) => save({ ai: { ...ai, domains: { ...domains, [d]: on } } })

  const toggleBridge = (on: boolean) => {
    // 启用即保证有 token（无 token 桥连不上 relay，配了也没用）
    const token = ai.bridgeToken || (on ? genToken() : ai.bridgeToken)
    save({ ai: { ...ai, bridgeEnabled: on, bridgeToken: token } })
    if (on && token) {
      agentBridge.connect({ url: ai.bridgeUrl ?? '', token })
    } else {
      agentBridge.disconnect()
    }
  }

  const resetToken = () => {
    const token = genToken()
    save({ ai: { ...ai, bridgeToken: token } })
    // 地址留空 → 桥自动用当前站点同源 /relay（内嵌形态）；显式填了地址仍按填的走。
    if (ai.bridgeEnabled) agentBridge.connect({ url: ai.bridgeUrl ?? '', token })
  }

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(ai.bridgeToken ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  const stateText: Record<BridgeStatus['state'], string> = {
    disabled: '未启用',
    connecting: '连接中…',
    connected: '已连接 relay',
    error: '连接失败',
  }
  const stateColor: Record<BridgeStatus['state'], string> = {
    disabled: 'text-outline',
    connecting: 'text-warning',
    connected: 'text-success',
    error: 'text-error',
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="smart_toy" size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-[1.0357rem] font-semibold">AI Agent 桥</h3>
            <p className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
              让外部 Agent（Claude Desktop / Cursor / CLI 等）经 relay 用标准 MCP 调用本应用的记账、CRM 等能力。
              relay 已内嵌在本项目（与站点同源），无需单独启动。
            </p>
          </div>
          <span className={`text-[0.8571rem] font-medium ${stateColor[status.state]}`}>{stateText[status.state]}</span>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/60 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[0.9286rem] font-medium">启用 AI 桥</div>
            <div className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
              关闭时桥不启动，Agent 无法连接；开启后本页会主动连出 relay（不开放入站端口）
            </div>
          </div>
          <button
            role="switch"
            aria-checked={ai.bridgeEnabled}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${ai.bridgeEnabled ? 'bg-primary' : 'bg-outline-variant'}`}
            onClick={() => toggleBridge(!ai.bridgeEnabled)}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${ai.bridgeEnabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        {ai.bridgeEnabled && (
          <div className="mt-3 space-y-3">
            <div>
              <div className="mb-1 text-[0.8214rem] font-medium text-on-surface-variant">relay 地址（留空即可）</div>
              <input
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.8571rem]"
                value={ai.bridgeUrl ?? ''}
                onChange={(e) => save({ ai: { ...ai, bridgeUrl: e.target.value } })}
                placeholder="留空 = 使用当前站点（同源 /relay）"
              />
              <p className="mt-1 text-[0.7857rem] text-outline">
                留空即用当前站点的 <code>/relay</code>（dev/生产都已内嵌，无需单独启动 relay）；
                仅当你把 relay 跑在别处时才需要填，如 <code>ws://127.0.0.1:8787</code>。
              </p>
            </div>
            <div>
              <div className="mb-1 text-[0.8214rem] font-medium text-on-surface-variant">
                接入 token（仅存本地，不进同步）
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.8571rem]"
                  value={ai.bridgeToken ?? ''}
                  placeholder="启用后自动生成"
                />
                <Button size="sm" variant="ghost" icon="content_copy" onClick={copyToken}>
                  {copied ? '已复制' : '复制'}
                </Button>
                <Button size="sm" variant="ghost" icon="autorenew" onClick={resetToken}>
                  重置
                </Button>
              </div>
              <p className="mt-1 text-[0.7857rem] text-outline">
                注入 token 由项目在启动时生成/指定（`npm run dev` 或 `npm run serve` 的控制台会打印；
                也可用 <code>WORKHUB_RELAY_TOKEN</code> 固定），把同一 token 交给 Agent 即可。
              </p>
            </div>
            {status.error && <p className="text-[0.8214rem] text-error">{status.error}</p>}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-[0.8214rem] font-medium text-on-surface-variant">
                  Agent 侧接入（复制即用）
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="content_copy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(agentSetupCmd)
                      setCopiedCmd(true)
                      setTimeout(() => setCopiedCmd(false), 1500)
                    } catch {
                      /* 剪贴板不可用时静默 */
                    }
                  }}
                >
                  {copiedCmd ? '已复制' : '复制命令'}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.7857rem] leading-relaxed">
                {agentSetupCmd}
              </pre>
              <p className="mt-1 text-[0.7857rem] text-outline">
                推荐用这条命令：它自动写入各 Agent 工具（Codex / Hermes / opencode / Claude Code /
                Cursor …）的配置，并把凭据集中存到 <code>~/.workhub/relay.json</code> ——
                token 因此不落进任何可入库的配置文件。跑完<b>重启 Agent 工具</b>即可。详见{' '}
                <code>docs/一键接入-Agent说明.md</code>。
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-[0.7857rem] text-on-surface-variant">
                  手动配置（不想跑脚本时）·{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={async (e) => {
                      e.preventDefault()
                      try {
                        await navigator.clipboard.writeText(mcpConfig)
                        setCopiedConfig(true)
                        setTimeout(() => setCopiedConfig(false), 1500)
                      } catch {
                        /* 剪贴板不可用时静默 */
                      }
                    }}
                  >
                    {copiedConfig ? '已复制' : '复制 JSON'}
                  </button>
                </summary>
                <pre className="mt-1 overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-[0.7857rem] leading-relaxed">
                  {mcpConfig}
                </pre>
                <p className="mt-1 text-[0.7857rem] text-outline">
                  标准 MCP 只有 stdio / Streamable HTTP 两种传输，<b>没有「连裸 ws://」这条</b>，
                  所以 Agent 侧要用本项目的 stdio 桥（
                  <code>relay/mcp-stdio-shim.mjs</code>）把 JSON-RPC 帧搬到 relay：把{' '}
                  <code>&lt;项目路径&gt;</code> 换成实际路径后粘进 Agent 的 MCP 配置。
                  该配置含明文 token，<b>不要提交到仓库</b>。
                </p>
              </details>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="verified_user" size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-[1.0357rem] font-semibold">能力白名单</h3>
            <p className="mt-0.5 text-[0.8214rem] text-on-surface-variant">
              关闭的域，Agent 的工具清单里**直接不出现**（不是调用时才拒绝）——任何 Agent 一视同仁
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {DOMAIN_ORDER.map((d) => {
            const on = domains[d] ?? true
            const meta = DOMAIN_LABELS[d]
            return (
              <label
                key={d}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-outline-variant/60 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-[0.9286rem] font-medium">{meta.label}</div>
                  <div className="mt-0.5 truncate text-[0.7857rem] text-on-surface-variant">{meta.desc}</div>
                </div>
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={on} onChange={(e) => setDomain(d, e.target.checked)} />
              </label>
            )
          })}
        </div>
        <p className="mt-3 text-[0.7857rem] text-outline">
          说明：中风险操作（记账、建客户、沟通日志等）即便在白名单内，Agent 也须先向你转述参数并取得确认，才能携带一次性 confirmToken 执行。
        </p>
      </Card>
    </div>
  )
}

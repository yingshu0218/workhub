import { TOOL_RISK } from './schema'

/**
 * 中/高风险写工具的「preview → 用户确认 → 取票 → 执行」编排（agentOps 服务端化 P3）
 *
 * 浏览器桥（bridge.ts）与服务端执行器（serverReads.ts 的 callTool）**共用同一形状**：
 * - needsPreview：medium/high 且未携带 confirmToken → 必须先返回预览（闸门判定唯一入口）；
 * - previewEnvelope：预览材料（Agent 据此向用户转述；relay 缓存 (tool,args) 供取票绑定）。
 *
 * 票据签发/核销始终在 relay（confirm_preview 工具 + confirmStore），本模块不碰票据——
 * 两端拿到的 meta.confirmToken 都已被 relay 核销过有效性，这里只判「有没有带票」。
 *
 * §四.4 语义：medium = 向用户转述并取得确认；high = 额外强调不可逆（irreversible 标记
 * + 删除后不可恢复文案）。
 */

export type RiskLevel = 'low' | 'medium' | 'high'

/** 中/高风险且未带票 → 必须先 preview（low 工具直执行；带票的 medium/high 已过闸） */
export function needsPreview(name: string, meta?: { confirmToken?: string }): boolean {
  const risk = TOOL_RISK[name]
  return (risk === 'medium' || risk === 'high') && !meta?.confirmToken
}

/** 预览材料信封（与浏览器桥既有形状逐字段一致；relay 以 data.preview === true 识别并缓存 (tool,args)） */
export function previewEnvelope(
  name: string,
  args: unknown,
): {
  preview: true
  tool: string
  risk: RiskLevel
  args: unknown
  confirmHint: { tool: string; args: { tool: string; args: unknown }; note: string }
  note: string
  irreversible?: true
} {
  const risk = TOOL_RISK[name] ?? 'medium'
  return {
    preview: true,
    tool: name,
    risk,
    args,
    // 确认票据的请求入口：Agent 拿到用户确认后调 confirm_preview 取票再重试本工具。
    // 没有这一句，preview → 确认 → execute 三步在非 --dev 下**物理上走不通**
    // （票据只能由 relay 签发，而 Agent 不知道去哪儿取），确认闸门就成了死循环。
    confirmHint: {
      tool: 'confirm_preview',
      args: { tool: name, args },
      note: '用户确认后调用 confirm_preview 取得一次性 confirmToken，再以同一参数重试本工具。',
    },
    note:
      risk === 'high'
        ? '这是**不可逆**的高风险操作。务必先向用户逐字转述以上参数与影响（删除后数据不可恢复），取得明确确认后调用 confirm_preview 取得 confirmToken，再重试本工具。'
        : '这是中风险操作。请向用户转述以上参数并取得确认；用户确认后调用 confirm_preview 取得 confirmToken，再重试本工具。',
    ...(risk === 'high' ? { irreversible: true as const } : {}),
  }
}

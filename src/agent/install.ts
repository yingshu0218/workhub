import { settingsRepo } from '@/repositories/localAdmin'
import { agentBridge } from './bridge'

/**
 * 按 settings `ai` 段启动应用内 Agent 桥（方案 §四.2 / §9.6）。
 *
 * 边界：
 * - 默认关（`bridgeEnabled:false`）→ 不连接、不监听任何端点；
 * - token 仅存本地 settings（不进同步队列），缺省不自动连接（无 token 无法通过 relay 校验）；
 * - 本函数只负责「按配置连/断」，不 import 任何 repositories 写函数。
 */
export async function installAgentBridge(): Promise<() => void> {
  const settings = await settingsRepo.get()
  const ai = settings.ai
  if (!ai?.bridgeEnabled || !ai.bridgeToken) {
    agentBridge.disconnect()
    return () => {}
  }
  // 留空 → 同源 /relay（内嵌）；显式填地址 → 按填的走。resolveBridgeBase 负责推导。
  agentBridge.connect({ url: ai.bridgeUrl ?? '', token: ai.bridgeToken })
  return () => agentBridge.disconnect()
}

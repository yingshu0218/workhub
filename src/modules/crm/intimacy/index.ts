import type {
  Customer,
  IntimacyLevel,
  ModuleConfigIntimacy,
  RelationCategory,
} from '@/db/types'
import { isTodoOpen, isTodoDone } from '@/modules/todo/domain'
import type { CanvasGraph } from '../hooks'

/**
 * 亲密度纯函数（Issue #34 收敛稿）：无 React / Dexie 副作用，单测可覆盖。
 * 优先级：手动 intimacy.level 最优先（锁定，算法不参与）；未设置 → 算法兜底。
 * 硬约束（不开放配置）：算法最多推到 T2，永不自动给 T1；永不给出 I6/I7（负向意愿只能人工降级）。
 */

/** 黑名单 = 手动亲密度为 I7（唯一判定口径，各消费点统一调用，避免散布） */
export function isCustomerBlacklisted(customer: Pick<Customer, 'intimacy'> | undefined): boolean {
  return customer?.intimacy?.level === 'I7'
}

/** 黑名单屏蔽开关命中（开关矩阵来自 moduleConfigs，默认只开图谱隐藏） */
export function isBlacklistHidden(
  customer: Pick<Customer, 'intimacy'> | undefined,
  cfg: ModuleConfigIntimacy,
  scene: keyof ModuleConfigIntimacy['blacklist'],
): boolean {
  return isCustomerBlacklisted(customer) && cfg.blacklist[scene]
}

/**
 * 算法亲密度（0-100）：4 因子归一化加权——联系频率 30 / 金钱往来 30 / 事项 20 / 关联项目 20（可配置）。
 * 归一化口径（0-100 截断，对数化防大客户通吃）：
 * - contact：近 90 天沟通次数，log 缩放（≥16 次满档）
 * - finance：双向金额流水的对数（≥¥100w 满档）
 * - todo：活跃（未完成）待办数 + 完成率加成（≥8 项满档）
 * - project：名下项目数（active 双倍权重，≥4 个满档）
 */
export function computeIntimacyScore(
  input: {
    interactionCount90d: number
    financeAmount: number
    activeTodos: number
    doneTodos: number
    projects: number
    activeProjects: number
    lastContactAt: number
  },
  weights: ModuleConfigIntimacy['algorithm']['weights'],
): number {
  // 联系频率：log2 桶 + 90 天未联系衰减（超期后每 30 天再衰减 20%）
  const daysSinceContact = Math.max(0, (Date.now() - input.lastContactAt) / 86_400_000)
  const contactRaw = Math.min(100, Math.log2(input.interactionCount90d + 1) * 25)
  const decay = daysSinceContact > 90 ? Math.max(0.2, 1 - ((daysSinceContact - 90) / 30) * 0.2) : 1
  const contact = contactRaw * decay

  // 金钱往来：金额对数（1k→25 / 1w→50 / 10w→75 / 100w→100）
  const finance = input.financeAmount > 0
    ? Math.min(100, (Math.log10(input.financeAmount) - 2) * 25)
    : 0

  // 事项：活跃待办为主 + 已完成加成（完成率信号）
  const todo = Math.min(100, input.activeTodos * 12 + Math.min(input.doneTodos, 6) * 3)

  // 关联项目：active 双倍权重
  const project = Math.min(100, (input.activeProjects * 2 + (input.projects - input.activeProjects)) * 25)

  const totalW = weights.contact + weights.finance + weights.todo + weights.project
  // 权重和为 0：配置异常兜底，回退等权（设置页已拦截全 0，这里再挡一层防除 0）
  if (totalW <= 0) return Math.round((contact + finance + todo + project) / 4)
  const score =
    (contact * weights.contact +
      finance * weights.finance +
      todo * weights.todo +
      project * weights.project) /
    totalW
  return Math.round(Math.max(0, Math.min(100, score)))
}

/** 算法分 → T 档（阈值来自配置；单调约束失效时回退默认档位防切档错乱） */
export function scoreToLevel(
  score: number,
  thresholds: ModuleConfigIntimacy['algorithm']['thresholds'],
): IntimacyLevel {
  const t2 = Math.max(thresholds.t2, thresholds.t3 + 1, thresholds.t4 + 2, 1)
  if (score >= t2) return 'T2'
  if (score >= thresholds.t3) return 'T3'
  if (score >= thresholds.t4) return 'T4'
  return 'T5'
}

/** 单客户亲密度档位解析：手动优先 → 算法兜底（enabled=false 时未设置客户落 T5 基线） */
export function resolveIntimacyLevel(
  customer: Pick<Customer, 'intimacy'>,
  cfg: ModuleConfigIntimacy,
  scoreInput: Parameters<typeof computeIntimacyScore>[0] | null,
): { level: IntimacyLevel; source: 'manual' | 'algorithm' | 'default' } {
  if (customer.intimacy?.level) return { level: customer.intimacy.level, source: 'manual' }
  if (!cfg.algorithm.enabled || !scoreInput) return { level: 'T5', source: 'default' }
  const score = computeIntimacyScore(scoreInput, cfg.algorithm.weights)
  return { level: scoreToLevel(score, cfg.algorithm.thresholds), source: 'algorithm' }
}

/** 亲密度因子扫描入参（CanvasGraph 投影足够推导，零新查询） */
export function buildScoreInput(
  graph: CanvasGraph,
  customerId: string,
): Parameters<typeof computeIntimacyScore>[0] {
  const since = Date.now() - 90 * 86_400_000
  const customer = graph.customers.find((c) => c.id === customerId)
  return {
    interactionCount90d: graph.interactions.filter(
      (i) => i.customerId === customerId && i.at >= since,
    ).length,
    // 多关联（Issue #140）：数组包含语义（一条流水可挂多个客户，每个客户都计入金额/待办统计）
    financeAmount: graph.transactions
      .filter((t) => t.customerIds.includes(customerId))
      .reduce((sum, t) => sum + t.amount, 0),
    activeTodos: graph.todos.filter(
      (t) => t.customerIds.includes(customerId) && isTodoOpen(t),
    ).length,
    // 已完成口径（Issue #128）：作废条目不计入完成数（算法入参与 UI 同源，不漂移）
    doneTodos: graph.todos.filter(
      (t) => t.customerIds.includes(customerId) && isTodoDone(t),
    ).length,
    projects: graph.projects.filter((p) => p.customerId === customerId).length,
    activeProjects: graph.projects.filter(
      (p) => p.customerId === customerId && graph.projectStatuses[p.id] === 'active',
    ).length,
    lastContactAt: customer?.lastContactAt ?? 0,
  }
}

/** 亲密度聚合统计信息（边渲染/分类统计复用） */
export type RelationCategoryCount = Partial<Record<RelationCategory, number>>

// ── 配置层 re-export（barrel：消费方统一从 intimacy 导入） ──
export {
  getIntimacyConfig,
  useIntimacyConfig,
  saveIntimacyConfig,
  intimacyLevelName,
  newModuleConfigId,
} from './config'

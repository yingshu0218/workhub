import { storage } from '@/storage'
import {
  DEFAULT_INTIMACY_CONFIG,
  INTIMACY_CONFIG_ID,
  type Customer,
  type ModuleConfig,
  type ModuleConfigIntimacy,
} from '@/db/types'

/**
 * 亲密度配置的**纯读取层**（agentOps 服务端化 P2 自 config.ts 拆出）
 *
 * 拆出动机：`config.ts` 同时承载响应式 hooks（useIntimacyConfig → react +
 * queries/hooks → dexie-react-hooks）与写路径（repositories），而 agentOps 的读链路
 * （reads.ts / resolver.ts → 本文件）在服务端执行器 bundle 里**不能拖 react/Dexie**。
 * 纯函数（合并 + 直读）收口到这里：零 react、零 db（storage 走 StorageAdapter）。
 * `config.ts` 反向 import 本文件并保持旧导出位不破坏。
 */

/** 深合并缺省值：存量/远端记录缺段位时逐层兜底（payload 是 unknown，需运行时校验形状） */
export function mergeIntimacyPayload(raw: unknown): ModuleConfigIntimacy {
  const d = DEFAULT_INTIMACY_CONFIG
  const p = (raw ?? {}) as Partial<ModuleConfigIntimacy>
  const levels =
    Array.isArray(p.levels) && p.levels.length === d.levels.length
      ? p.levels.map((l, i) => ({
          key: d.levels[i]!.key,
          name: typeof l?.name === 'string' && l.name.trim() ? l.name : d.levels[i]!.name,
          desc: typeof l?.desc === 'string' ? l.desc : d.levels[i]!.desc,
        }))
      : d.levels
  const bl = (p.blacklist ?? {}) as Partial<ModuleConfigIntimacy['blacklist']>
  const alg = (p.algorithm ?? {}) as Partial<ModuleConfigIntimacy['algorithm']>
  const w = (alg.weights ?? {}) as Partial<ModuleConfigIntimacy['algorithm']['weights']>
  const th = (alg.thresholds ?? {}) as Partial<ModuleConfigIntimacy['algorithm']['thresholds']>
  return {
    levels,
    blacklist: {
      hideInSearch: bl.hideInSearch ?? d.blacklist.hideInSearch,
      excludeFromPicker: bl.excludeFromPicker ?? d.blacklist.excludeFromPicker,
      hideInTimeline: bl.hideInTimeline ?? d.blacklist.hideInTimeline,
    },
    algorithm: {
      enabled: alg.enabled ?? d.algorithm.enabled,
      weights: {
        contact: w.contact ?? d.algorithm.weights.contact,
        finance: w.finance ?? d.algorithm.weights.finance,
        todo: w.todo ?? d.algorithm.weights.todo,
        project: w.project ?? d.algorithm.weights.project,
      },
      thresholds: {
        t2: th.t2 ?? d.algorithm.thresholds.t2,
        t3: th.t3 ?? d.algorithm.thresholds.t3,
        t4: th.t4 ?? d.algorithm.thresholds.t4,
      },
    },
  }
}

/** 直读配置（非响应式场景：算法计算/过滤器等；经 StorageAdapter——服务端执行器同口径） */
export async function getIntimacyConfig(): Promise<ModuleConfigIntimacy> {
  const rec = (await storage.get<ModuleConfig>('moduleConfigs', INTIMACY_CONFIG_ID)) as
    | ModuleConfig
    | undefined
  if (rec?.deleted) return DEFAULT_INTIMACY_CONFIG
  return mergeIntimacyPayload(rec?.payload)
}

/** 黑名单 = 手动亲密度为 I7（唯一判定口径；自 intimacy/index.ts 收口，index re-export 保持兼容） */
export function isCustomerBlacklisted(customer: Pick<Customer, 'intimacy'> | undefined): boolean {
  return customer?.intimacy?.level === 'I7'
}

/**
 * 某场景下过滤掉被屏蔽的客户（客户列表 / 时间线 / 搜索索引 / Agent 读与消解等数组消费面用）。
 *
 * **开关关闭时原样返回入参引用**（不是拷贝）：上层 useMemo 依赖不变，下游 zero-copy。
 * 自 intimacy/index.ts 收口（agentOps 服务端化 P2）：index.ts 是 barrel 且 re-export
 * config.ts（react 链），服务端 bundle 不能经它；本文件零 react、零 db。
 */
export function filterBlacklisted<T extends Pick<Customer, 'intimacy'>>(
  customers: T[],
  cfg: ModuleConfigIntimacy,
  scene: keyof ModuleConfigIntimacy['blacklist'],
): T[] {
  if (!cfg.blacklist[scene]) return customers
  return customers.filter((c) => !isCustomerBlacklisted(c))
}
